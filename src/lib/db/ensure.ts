import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./ddl";

let initialized = false;

/**
 * Run one migration statement, tolerating ONLY "this database already has it".
 *
 * These used to be `try { … } catch {}`, which swallowed every failure equally — including
 * the ones that matter. A locked database, a read-only file, or a typo'd column name all
 * looked identical to "already migrated", and the app then failed later somewhere unrelated
 * with no trace of why. Only a duplicate-column / already-exists error is expected here;
 * anything else is rethrown with the statement that caused it.
 */
function migrate(sqlite: Database.Database, sql: string): void {
  try {
    sqlite.exec(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate column name|already exists/i.test(message)) return;
    throw new Error(
      `Schema migration failed (and this is not the benign "already applied" case):\n` +
        `  statement: ${sql}\n` +
        `  error:     ${message}`
    );
  }
}

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

  // Idempotent column additions for existing databases.
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN score_location INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN details TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN estimated_salary_min INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN estimated_salary_max INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN salary_confidence TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN soc_code TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN adjusted_salary_min INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN adjusted_salary_max INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN col_index INTEGER");

  // Axes and facts added with the profile-driven ranker.
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN score_interest INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN score_engagement INTEGER");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN pay_interval TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN pay_label TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN hours_verdict TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN flags TEXT");
  migrate(sqlite, "ALTER TABLE job_analysis ADD COLUMN penalties TEXT");

  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN description TEXT");
  // Pay unit + contract/gig signals. Added because the schema previously dropped
  // the pay interval, making an hourly rate indistinguishable from an annual one.
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN salary_interval TEXT");
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN salary_source TEXT");
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN is_remote INTEGER");
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN job_level TEXT");
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN listing_type TEXT");
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN company_industry TEXT");
  migrate(sqlite, "ALTER TABLE scrape_results ADD COLUMN experience_range TEXT");

  // The search radius is part of a run's configuration — without it a past run
  // cannot be reproduced, and yield differences look like noise.
  migrate(sqlite, "ALTER TABLE scrape_runs ADD COLUMN distance INTEGER");

  // Resume-arsenal metadata. Added as columns rather than a side table on existing
  // databases so there is one place to read them from; new databases get them from the DDL.
  migrate(sqlite, "ALTER TABLE resumes ADD COLUMN label TEXT");
  migrate(sqlite, "ALTER TABLE resumes ADD COLUMN role_title TEXT");
  migrate(sqlite, "ALTER TABLE resumes ADD COLUMN keywords TEXT");
  migrate(sqlite, "ALTER TABLE resumes ADD COLUMN source_resume_id INTEGER");
  migrate(sqlite, "ALTER TABLE resumes ADD COLUMN reuse_count INTEGER DEFAULT 0");

  migrate(sqlite, "ALTER TABLE jobs ADD COLUMN listing_status TEXT DEFAULT 'unknown'");
  migrate(sqlite, "ALTER TABLE jobs ADD COLUMN listing_checked_at TEXT");

  // Indexes (idempotent by statement, so the tolerance rarely applies).
  migrate(sqlite, "CREATE INDEX IF NOT EXISTS idx_job_analysis_scrape_result_id ON job_analysis(scrape_result_id)");
  migrate(sqlite, "CREATE INDEX IF NOT EXISTS idx_job_analysis_rank_score ON job_analysis(rank_score)");
  migrate(sqlite, "CREATE INDEX IF NOT EXISTS idx_listing_status_history_job_id ON listing_status_history(job_id)");

  sqlite.close();

  initialized = true;
}
