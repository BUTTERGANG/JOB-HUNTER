#!/usr/bin/env node
/**
 * Daily job sweep: POST the app's scheduled-scrape endpoint.
 *
 * One job — kick the app's own endpoint, so the scrape, the ranking and the Discord
 * notification all run through the same code path the UI uses. Nothing is duplicated here.
 *
 * Why node and not a shell script: launchd cannot read an external volume through
 * `/bin/bash` (TCC refuses a removable volume to a "platform binary" and will not even
 * prompt), so a `.sh` living on the SSD dies at spawn with "Operation not permitted".
 * Exec'ing node directly is what works. See docs/decisions.md.
 *
 * Env:
 *   JOBHUNT_URL      full base URL (overrides discovery)
 *   JOBHUNT_TIMEOUT  seconds to wait for the scrape to finish (default 2700 = 45 min)
 */

import { execFileSync } from "node:child_process";

const URL_FROM_ENV = process.env.JOBHUNT_URL ?? "";
const TIMEOUT_SECONDS = Number(process.env.JOBHUNT_TIMEOUT ?? 2700);
const TAILSCALE_BIN = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const log = (...parts) => console.log(`[daily-scrape] ${new Date().toISOString()}`, ...parts);

/**
 * Find the app. It binds to the tailnet address, so localhost does NOT answer — using it
 * would make every run fail while looking like the app was down.
 */
function baseUrl() {
  if (URL_FROM_ENV) return URL_FROM_ENV.replace(/\/$/, "");

  // ifconfig first: the Tailscale CLI is unusable from a launchd agent (it tries to start
  // the GUI and prints the failure to stdout, which is not an address).
  try {
    const out = execFileSync("/sbin/ifconfig", { encoding: "utf8" });
    const match = out.match(/\b(100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/);
    if (match) return `http://${match[1]}:3002`;
  } catch {
    /* fall through */
  }

  try {
    const out = execFileSync(TAILSCALE_BIN, ["ip", "-4"], { encoding: "utf8" });
    const match = out.match(/\b(100\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    if (match) return `http://${match[1]}:3002`;
  } catch {
    /* fall through */
  }

  return "http://localhost:3002";
}

async function main() {
  const base = baseUrl();
  log(`starting a sweep via ${base}/api/scrape/scheduled`);

  // Start it, then poll. The endpoint returns immediately on purpose: doing the scrape and
  // ranking inline outlived the 300-second headers timeout that HTTP clients enforce by
  // default, so the caller saw "fetch failed" while the server finished the work anyway.
  let started;
  try {
    started = await fetch(`${base}/api/scrape/scheduled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    log(`FAILED to reach the app at ${base}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  if (!started.ok) {
    const body = await started.text();
    log(`could not start the sweep (HTTP ${started.status}): ${body.slice(0, 400)}`);
    process.exit(1);
  }
  log("sweep started; waiting for it to finish");

  const deadline = Date.now() + TIMEOUT_SECONDS * 1000;
  let run = null;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));

    let status;
    try {
      status = await fetch(`${base}/api/scrape/scheduled`, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // A transient blip while polling is not a failed sweep; the server keeps working.
      log(`status check failed (will keep waiting): ${error instanceof Error ? error.message : error}`);
      continue;
    }
    if (!status.ok) {
      log(`status check returned HTTP ${status.status}; will keep waiting`);
      continue;
    }

    const body = await status.json().catch(() => null);
    run = body?.run ?? null;
    if (!run) {
      log("no run reported yet; still waiting");
      continue;
    }

    if (run.status === "running") {
      log(`still running (${Math.round((Date.now() - Date.parse(run.startedAt)) / 1000)}s)`);
      continue;
    }

    if (run.status === "failed") {
      log(`sweep FAILED: ${run.error ?? "unknown error"}`);
      process.exit(1);
    }

    const n = run.notification ?? {};
    log(
      `done — ${run.count} listing(s) after dedupe; ` +
        (n.attempted
          ? n.sent
            ? `alert sent via ${n.via}${n.target ? ` to ${n.target}` : ""} (${n.highScoringCount} above threshold)`
            : `alert NOT sent: ${n.error ?? "unknown reason"}`
          : `no alert (${n.highScoringCount ?? 0} listings above the threshold)`)
    );

    if (n.attempted && !n.sent) process.exit(2);
    return;
  }

  log(`gave up waiting after ${TIMEOUT_SECONDS}s (the run may still be going)`);
  process.exit(3);
}

main().catch((error) => {
  log(`unexpected failure: ${error instanceof Error ? error.stack ?? error.message : error}`);
  process.exit(1);
});
