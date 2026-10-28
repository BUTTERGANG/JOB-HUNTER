#!/usr/bin/env node
/**
 * Serve JobHunt on this machine's Tailscale address.
 *
 * This is deliberately a NODE script that launchd execs directly, not a shell script
 * run through /bin/bash. macOS TCC refuses to grant (or even prompt for) a removable
 * volume to a "platform binary" like /bin/bash:
 *
 *   /bin/bash: /Volumes/.../scripts/serve-tailnet.sh: Operation not permitted
 *   tccd: Platform binary prompting is 'Deny' because: is Platform Binary
 *
 * node is not a platform binary, so it is eligible for the removable-volume grant and
 * macOS can prompt for it. Run this file with the node binary directly:
 *
 *   /Users/massmac/.local/bin/node scripts/serve-tailnet.mjs
 *
 * Env:
 *   PORT=3002            port to bind
 *   SERVE_MODE=prod      prod (default, needs a prior `npm run build`) or dev
 *   BIND_HOST=auto       auto (tailnet IP) | 0.0.0.0 | 127.0.0.1 | an explicit IP
 *   WAIT_SECONDS=120     how long to wait for the Tailscale interface
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || "3002";
const SERVE_MODE = process.env.SERVE_MODE || "prod";
const BIND_HOST = process.env.BIND_HOST || "auto";
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS || 120);
const TAILSCALE_BIN = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const log = (...parts) => console.log(`[serve-tailnet] ${new Date().toISOString()}`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const IPV4_TAILNET = /\b(100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/;

/**
 * Find this machine's Tailscale address.
 *
 * ifconfig first, deliberately. The Tailscale CLI is not usable from a launchd agent:
 * it tries to start the GUI app and prints its failure to STDOUT —
 *
 *   "The Tailscale GUI failed to start: The operation couldn't be completed."
 *
 * — which is not an address. Taking stdout at face value fed that sentence to
 * `next start -H`, which died with ENOTFOUND. So: prefer ifconfig, and validate that
 * whatever we get back is actually a 100.64.0.0/10 address before using it.
 */
function tailnetIp() {
  const candidates = [];
  try {
    candidates.push(execFileSync("/sbin/ifconfig", { encoding: "utf8" }));
  } catch {
    /* ignore */
  }
  if (existsSync(TAILSCALE_BIN)) {
    try {
      candidates.push(execFileSync(TAILSCALE_BIN, ["ip", "-4"], { encoding: "utf8" }));
    } catch {
      /* ignore */
    }
  }
  for (const output of candidates) {
    const match = output.match(IPV4_TAILNET);
    if (match) return match[1];
  }
  return "";
}

async function resolveHost() {
  if (BIND_HOST !== "auto") return BIND_HOST;
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  while (Date.now() < deadline) {
    const ip = tailnetIp();
    if (ip) return ip;
    log("waiting for a Tailscale address…");
    await sleep(5000);
  }
  log(`no Tailscale address after ${WAIT_SECONDS}s — falling back to 127.0.0.1`);
  return "127.0.0.1";
}

const nextBin = join(REPO_DIR, "node_modules", ".bin", "next");

if (!existsSync(join(REPO_DIR, "node_modules"))) {
  log(`node_modules missing — run: cd ${REPO_DIR} && npm install`);
  process.exit(1);
}
if (SERVE_MODE === "prod" && !existsSync(join(REPO_DIR, ".next"))) {
  log(`no production build — run: cd ${REPO_DIR} && npm run build`);
  process.exit(1);
}
if (!existsSync(join(REPO_DIR, "data"))) {
  log(`WARNING: ${REPO_DIR}/data is missing. If the SSD is not mounted, the database`);
  log("         and every setting (including the API key) are unavailable.");
}
if (existsSync(join(REPO_DIR, "data")) && !statSync(join(REPO_DIR, "data")).isDirectory()) {
  log("data is not a directory — refusing to start.");
  process.exit(1);
}

const host = await resolveHost();
const args =
  SERVE_MODE === "dev"
    ? ["dev", "-H", host, "-p", PORT]
    : ["start", "-H", host, "-p", PORT];

log(`${SERVE_MODE} mode on ${host}:${PORT}`);
log(`reachable over the tailnet at http://${host}:${PORT}`);

const child = spawn(nextBin, args, { cwd: REPO_DIR, stdio: "inherit" });
child.on("exit", (code, signal) => {
  log(`next exited (code=${code} signal=${signal})`);
  process.exit(code ?? 1);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
