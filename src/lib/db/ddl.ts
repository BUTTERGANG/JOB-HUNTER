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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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
`;
