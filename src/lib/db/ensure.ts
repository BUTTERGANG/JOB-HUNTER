import fs from "fs";
import path from "path";
import { SCHEMA_SQL } from "./ddl";

let initialized = false;

export function ensureDb() {
  if (initialized) return;

  const dbDir = path.join(process.cwd(), "data");
  const dbPath = path.join(dbDir, "jobhunt.db");

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Always run DDL — all statements use IF NOT EXISTS so this is safe on
  // existing DBs and picks up new tables added in future schema updates.
  const Database = require("better-sqlite3");
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(SCHEMA_SQL);
  // Idempotent column additions for existing databases
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN score_location INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN details TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN estimated_salary_min INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN estimated_salary_max INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN salary_confidence TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN soc_code TEXT"); } catch {}
  sqlite.close();

  initialized = true;
}
