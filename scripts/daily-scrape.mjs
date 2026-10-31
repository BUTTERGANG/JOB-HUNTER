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
  log(`sweeping via ${base}/api/scrape/scheduled`);

  const started = Date.now();
  let response;
  try {
    response = await fetch(`${base}/api/scrape/scheduled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(TIMEOUT_SECONDS * 1000),
    });
  } catch (error) {
    // A timeout or connection failure must be loud: it is the difference between "no jobs
    // today" and "the sweep never ran", which otherwise look identical in the log.
    log(`FAILED to reach the app at ${base}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }

  const seconds = Math.round((Date.now() - started) / 1000);

  if (!response.ok) {
    log(`app returned HTTP ${response.status} after ${seconds}s: ${text.slice(0, 500)}`);
    process.exit(1);
  }

  const count = body?.count ?? 0;
  const notification = body?.notification ?? {};
  log(
    `done in ${seconds}s — ${count} listing(s) after dedupe; ` +
      `notification: ${notification.sent ? `sent via ${notification.via} to ${notification.target ?? "target"}` : `not sent (${notification.error ?? "nothing above the threshold"})`}`
  );

  if (notification?.attempted && !notification?.sent) {
    // The scrape worked but the alert did not. Exit non-zero so it is visible rather than
    // looking like a quiet day.
    log(`notification failed: ${notification.error ?? "unknown reason"}`);
    process.exit(2);
  }
}

main().catch((error) => {
  log(`unexpected failure: ${error instanceof Error ? error.stack ?? error.message : error}`);
  process.exit(1);
});
