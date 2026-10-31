/**
 * Notifications through the Hermes gateway.
 *
 * The app can post to Discord itself with a webhook, but that means a second bot identity —
 * a webhook per app. Hermes already runs a gateway with Discord credentials configured, and
 * `hermes send --to <target>` is built for exactly this ("pipe text from any shell script to
 * any messaging platform Hermes is already configured for"). Piggybacking on it means one
 * bot, one place the credentials live, and updates landing in the project's own Discord
 * thread next to every other app's.
 *
 * `hermes send` needs no LLM and no agent loop, so calling it from an API route is cheap.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";

export interface GatewayNotifyResult {
  ok: boolean;
  target: string;
  /** Present when ok is false — the CLI's own message, not a guess. */
  error?: string;
}

/**
 * Find the hermes executable.
 *
 * Mirrors `resolvePythonBin()`: a launchd-spawned process inherits a minimal PATH, so
 * relying on `hermes` being on it would work interactively and fail in the service. Order:
 * explicit env override, then PATH, then the usual install locations.
 */
export function resolveHermesBin(): string | null {
  const fromEnv = process.env.HERMES_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const candidates = [
    path.join(process.env.HOME ?? "", ".local", "bin", "hermes"),
    "/opt/homebrew/bin/hermes",
    "/usr/local/bin/hermes",
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // Last resort: hope it is on PATH.
  return "hermes";
}

/** Send one message through the gateway. Never throws. */
export async function sendViaGateway(target: string, message: string): Promise<GatewayNotifyResult> {
  const bin = resolveHermesBin();
  if (!bin) {
    return { ok: false, target, error: "Could not find the hermes executable (set HERMES_BIN)." };
  }

  return new Promise((resolve) => {
    execFile(
      bin,
      ["send", "--to", target, "--quiet", message],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = (stderr || error.message || "").trim().slice(0, 400);
          resolve({ ok: false, target, error: detail || "hermes send failed." });
          return;
        }
        resolve({ ok: true, target });
      }
    );
  });
}

export interface JobUpdateSummary {
  rankScore: number;
  company: string;
  role: string;
  url: string | null;
  location: string | null;
  salary: string | null;
  source: string | null;
}

function formatSalary(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`;
  return min != null ? `${fmt(min)}+` : `up to ${fmt(max!)}`;
}

/**
 * Plain-text rendering for a chat message.
 *
 * Markdown, not an embed: `hermes send` posts text, and Discord renders the links and bold
 * natively. Kept short enough that a phone notification is readable.
 */
export function renderJobUpdateText(args: {
  jobs: JobUpdateSummary[];
  minScore: number;
  totalFound: number;
  totalHighScoring: number;
  runAt: string;
}): string {
  const lines: string[] = [
    `**Job update** — ${args.totalHighScoring} new job${args.totalHighScoring === 1 ? "" : "s"} scoring ${args.minScore}+ (of ${args.totalFound} fetched)`,
    "",
  ];

  for (const job of args.jobs.slice(0, 8)) {
    const title = job.url ? `[${job.role}](${job.url})` : job.role;
    lines.push(`**${job.rankScore}** · ${title}`);
    const meta = [job.company, job.location, job.salary, job.source].filter(Boolean).join(" · ");
    if (meta) lines.push(`    ${meta}`);
    lines.push("");
  }

  const extra = args.totalHighScoring - Math.min(args.jobs.length, 8);
  if (extra > 0) lines.push(`…and ${extra} more above the threshold.`, "");
  lines.push(`_scraped ${new Date(args.runAt).toLocaleString()}_`);

  return lines.join("\n");
}

export { formatSalary as formatJobSalary };

/** Targets that look like a Discord channel or thread id. */
export function looksLikeTarget(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[a-z0-9_]+:/.test(value.trim());
}
