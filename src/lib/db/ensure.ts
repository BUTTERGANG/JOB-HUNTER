import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
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
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN adjusted_salary_min INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN adjusted_salary_max INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE job_analysis ADD COLUMN col_index INTEGER"); } catch {}
  try { sqlite.exec("ALTER TABLE scrape_results ADD COLUMN description TEXT"); } catch {}
  try { sqlite.exec("ALTER TABLE jobs ADD COLUMN listing_status TEXT DEFAULT 'unknown'"); } catch {}
  try { sqlite.exec("ALTER TABLE jobs ADD COLUMN listing_checked_at TEXT"); } catch {}
  // Create indexes (idempotent)
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_job_analysis_scrape_result_id ON job_analysis(scrape_result_id)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_job_analysis_rank_score ON job_analysis(rank_score)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_listing_status_history_job_id ON listing_status_history(job_id)"); } catch {}
  sqlite.close();

  initialized = true;
}
