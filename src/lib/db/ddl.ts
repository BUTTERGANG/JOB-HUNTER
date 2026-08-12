export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    location TEXT,
    salary_min INTEGER,
    salary_max INTEGER,
    url TEXT,
    source TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'saved',
    listing_status TEXT DEFAULT 'unknown',
    listing_checked_at TEXT,
    tier TEXT DEFAULT 'B',
    score_role INTEGER,
    score_skills INTEGER,
    score_company INTEGER,
    score_comp INTEGER,
    score_growth INTEGER,
    score_total INTEGER,
    date_applied TEXT,
    date_added TEXT,
    follow_up_date TEXT,
    recruiter_name TEXT,
    recruiter_email TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    keywords TEXT,
    fit_score INTEGER,
    red_flags TEXT,
    must_have TEXT,
    nice_to_have TEXT,
    questions TEXT,
    raw_response TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS scrape_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    searches TEXT NOT NULL,
    sites TEXT NOT NULL,
    results_per_site INTEGER,
    hours INTEGER,
    total_found INTEGER NOT NULL,
    metrics TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scrape_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_run_id INTEGER NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    url TEXT,
    source TEXT,
    salary_min INTEGER,
    salary_max INTEGER,
    date_posted TEXT,
    job_type TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_result_id INTEGER NOT NULL REFERENCES scrape_results(id) ON DELETE CASCADE,
    rank_score INTEGER NOT NULL,
    score_pay INTEGER NOT NULL,
    score_flexibility INTEGER NOT NULL,
    score_responsibilities INTEGER NOT NULL,
    score_hours INTEGER NOT NULL,
    score_requirements INTEGER NOT NULL,
    score_location INTEGER,
    schedule TEXT,
    benefits TEXT,
    notes TEXT,
    details TEXT,
    estimated_salary_min INTEGER,
    estimated_salary_max INTEGER,
    salary_confidence TEXT,
    soc_code TEXT,
    adjusted_salary_min INTEGER,
    adjusted_salary_max INTEGER,
    col_index INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_job_analysis_scrape_result_id ON job_analysis(scrape_result_id);
  CREATE INDEX IF NOT EXISTS idx_job_analysis_rank_score ON job_analysis(rank_score);

  CREATE TABLE IF NOT EXISTS bls_wages (
    occ_code  TEXT PRIMARY KEY,
    occ_title TEXT NOT NULL,
    a_median  INTEGER,
    a_pct25   INTEGER,
    a_pct75   INTEGER,
    a_mean    INTEGER,
    tot_emp   INTEGER,
    data_year INTEGER
  );

  CREATE TABLE IF NOT EXISTS bulk_runs (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'running',
    total       INTEGER NOT NULL DEFAULT 0,
    done        INTEGER NOT NULL DEFAULT 0,
    jobs_total  INTEGER NOT NULL DEFAULT 0,
    config      TEXT,
    progress    TEXT,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS analysis_runs (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'running',
    total       INTEGER NOT NULL DEFAULT 0,
    analyzed    INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gov_scrape_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword      TEXT NOT NULL DEFAULT '',
    location     TEXT NOT NULL DEFAULT '',
    total_found  INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gov_scrape_results (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    scrape_run_id INTEGER NOT NULL REFERENCES gov_scrape_runs(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    company       TEXT NOT NULL DEFAULT 'State of Indiana',
    location      TEXT,
    salary        TEXT,
    date_posted   TEXT,
    url           TEXT,
    description   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS listing_status_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    checked_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_listing_status_history_job_id ON listing_status_history(job_id);
`;
