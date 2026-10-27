/**
 * Import the OpenRouter key already present on this machine into the app's
 * settings table, so the app can use it without anyone pasting a secret into a
 * chat window, a shell argument, or the browser.
 *
 * Read order: $OPENROUTER_API_KEY, then ~/.hermes/.env.
 * Writes: the `openrouter_api_key` row of the local SQLite `settings` table.
 * Prints: a masked fingerprint only — never the key.
 *
 * Run: node_modules/.bin/tsx scripts/import-openrouter-key.ts [--dry-run]
 */

import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

const ENV_PATH = path.join(os.homedir(), ".hermes", ".env");
const DB_PATH = path.join(process.cwd(), "data", "jobhunt.db");
const SETTING_KEY = "openrouter_api_key";

const dryRun = process.argv.includes("--dry-run");

function fingerprint(value: string): string {
  const clean = value.trim();
  if (clean.length <= 12) return `${clean.slice(0, 3)}…(${clean.length} chars)`;
  return `${clean.slice(0, 6)}…${clean.slice(-4)} (${clean.length} chars)`;
}

function readKeyFromEnvFile(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  // The file is mode 600; read it locally and never echo its contents.
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/);
    if (m) {
      const value = m[1].trim().replace(/^["']|["']$/g, "");
      if (value) return value;
    }
  }
  return null;
}

function main() {
  const fromEnv = (process.env.OPENROUTER_API_KEY || "").trim();
  const fromFile = fromEnv ? null : readKeyFromEnvFile(ENV_PATH);
  const key = fromEnv || fromFile || "";

  if (!key) {
    console.error(
      `No OpenRouter key found. Set OPENROUTER_API_KEY, or put it in ${ENV_PATH} as OPENROUTER_API_KEY=...`
    );
    process.exit(1);
  }
  if (!key.startsWith("sk-or-")) {
    console.warn(
      `Warning: the key does not start with "sk-or-" — it may not be an OpenRouter key. Fingerprint: ${fingerprint(key)}`
    );
  }

  console.log(`Source: ${fromEnv ? "environment" : ENV_PATH}`);
  console.log(`Key:    ${fingerprint(key)}`);
  console.log(`Target: ${DB_PATH} → settings.${SETTING_KEY}`);

  if (dryRun) {
    console.log("Dry run — nothing written.");
    return;
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found at ${DB_PATH}. Start the app once so it creates the schema.`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  const before = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(SETTING_KEY) as { value?: string } | undefined;

  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SETTING_KEY, key);
  db.close();

  console.log(
    before?.value
      ? `Replaced the stored key (was ${fingerprint(before.value)}).`
      : "Stored a new key."
  );
  console.log("Done. The app reads this from settings on every request — no restart needed.");
}

main();
