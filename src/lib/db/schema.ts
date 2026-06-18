import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  company: text("company").notNull(),
  role: text("role").notNull(),
  location: text("location"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  url: text("url"),
  source: text("source"),
  description: text("description"),
  status: text("status").default("saved").notNull(),
  tier: text("tier").default("B"),
  scoreRole: integer("score_role"),
  scoreSkills: integer("score_skills"),
  scoreCompany: integer("score_company"),
  scoreComp: integer("score_comp"),
  scoreGrowth: integer("score_growth"),
  scoreTotal: integer("score_total"),
  dateApplied: text("date_applied"),
  dateAdded: text("date_added"),
  followUpDate: text("follow_up_date"),
  recruiterName: text("recruiter_name"),
  recruiterEmail: text("recruiter_email"),
  notes: text("notes"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
  updatedAt: text("updated_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const resumes = sqliteTable("resumes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'master' or 'tailored'
  content: text("content").notNull(),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const analyses = sqliteTable("analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id")
    .references(() => jobs.id, { onDelete: "cascade" })
    .notNull(),
  keywords: text("keywords"), // JSON array
  fitScore: integer("fit_score"),
  redFlags: text("red_flags"), // JSON array
  mustHave: text("must_have"), // JSON array
  niceToHave: text("nice_to_have"), // JSON array
  questions: text("questions"), // JSON array
  rawResponse: text("raw_response"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export const scrapeRuns = sqliteTable("scrape_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  searches: text("searches").notNull(),
  sites: text("sites").notNull(),
  resultsPerSite: integer("results_per_site"),
  hours: integer("hours"),
  totalFound: integer("total_found").notNull(),
  metrics: text("metrics"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const scrapeResults = sqliteTable("scrape_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scrapeRunId: integer("scrape_run_id")
    .references(() => scrapeRuns.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(),
  company: text("company").notNull(),
  location: text("location"),
  url: text("url"),
  source: text("source"),
  salaryMin: integer("salary_min"),
  salaryMax: integer("salary_max"),
  datePosted: text("date_posted"),
  jobType: text("job_type"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const jobAnalysis = sqliteTable("job_analysis", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scrapeResultId: integer("scrape_result_id")
    .references(() => scrapeResults.id, { onDelete: "cascade" })
    .notNull(),
  rankScore: integer("rank_score").notNull(),
  scorePay: integer("score_pay").notNull(),
  scoreFlexibility: integer("score_flexibility").notNull(),
  scoreResponsibilities: integer("score_responsibilities").notNull(),
  scoreHours: integer("score_hours").notNull(),
  scoreRequirements: integer("score_requirements").notNull(),
  scoreLocation: integer("score_location"),
  schedule: text("schedule"),       // JSON JobSchedule
  benefits: text("benefits"),       // JSON string[]
  notes: text("notes"),
  details: text("details"),         // JSON JobRequirements
  estimatedSalaryMin: integer("estimated_salary_min"),
  estimatedSalaryMax: integer("estimated_salary_max"),
  salaryConfidence: text("salary_confidence"),
  socCode: text("soc_code"),
  createdAt: text("created_at")
    .default(sql`(datetime('now'))`)
    .notNull(),
});

export const blsWages = sqliteTable("bls_wages", {
  occCode: text("occ_code").primaryKey(),
  occTitle: text("occ_title").notNull(),
  aMedian: integer("a_median"),
  aPct25: integer("a_pct25"),
  aPct75: integer("a_pct75"),
  aMean: integer("a_mean"),
  totEmp: integer("tot_emp"),
  dataYear: integer("data_year"),
});

export type BLSWagesRow = typeof blsWages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type ScrapeRun = typeof scrapeRuns.$inferSelect;
export type ScrapeResult = typeof scrapeResults.$inferSelect;
export type JobAnalysisRow = typeof jobAnalysis.$inferSelect;
export type NewJobAnalysis = typeof jobAnalysis.$inferInsert;
