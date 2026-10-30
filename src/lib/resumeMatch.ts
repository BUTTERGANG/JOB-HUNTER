/**
 * Resume arsenal matching: which resume you already have fits this job?
 *
 * The point is to stop re-tailoring from scratch for every posting. Most jobs in a
 * vertical want substantially the same resume; only some justify a new one. This decides
 * which, and says why, so the recommendation can be trusted rather than guessed at.
 *
 * Pure functions over plain data — no DB, no model call — so the thresholds and the
 * scoring can be asserted offline. See scripts/verify-resume-match.ts.
 */

/** Words that carry no signal about what a job IS. */
const STOPWORDS = new Set([
  "and", "the", "for", "with", "you", "your", "our", "are", "will", "that", "this",
  "from", "have", "has", "not", "but", "all", "any", "can", "may", "must", "should",
  "job", "role", "position", "work", "working", "candidate", "ideal", "looking",
  "required", "requirements", "preferred", "plus", "including", "include", "includes",
  "ability", "able", "strong", "good", "great", "excellent", "experience", "years",
  "year", "team", "teams", "company", "full", "time", "part", "per", "new", "other",
  "within", "into", "about", "more", "most", "than", "then", "them", "they", "their",
  "who", "what", "when", "where", "which", "while", "would", "could", "also", "across",
  "using", "use", "used", "well", "make", "made", "help", "helps", "join", "day",
  "days", "week", "weekly", "hour", "hours", "pay", "paid", "salary", "benefits",
]);

/**
 * Canonical forms for the words that decide whether a resume fits.
 *
 * Without this, "photographer" and "photography" are different tokens, "videographer" and
 * "video" are different tokens, and "editor" and "editing" are different tokens — so the
 * single most important overlap (the craft itself) was invisible, and a wedding video
 * resume scored 0 against a video job. These map the common forms of a term onto one
 * token. Deliberately a short, domain-aware list rather than a general stemmer: it is
 * predictable, and it cannot turn "company" into "compan".
 */
const CANONICAL: [RegExp, string][] = [
  [/^(photograph|photog|photo)/, "photo"],
  [/^(videograph|videog|video)/, "video"],
  [/^(cinematograph|cinematog)/, "video"],
  [/^(edit|editor)/, "edit"],
  [/^(dj|discjockey|deejay)/, "dj"],
  [/^realestate/, "realestate"],
  [/^socialmedia/, "socialmedia"],
  [/^videoedit/, "edit"],
  [/^(audio|sound)/, "audio"],
  [/^(camera|cameraman|camerawork)/, "camera"],
  [/^(wedding|bridal)/, "wedding"],
  [/^(event|events)/, "event"],
];

/**
 * Multi-word terms, rewritten before tokenising.
 *
 * Per-token canonicalisation cannot see "disc jockey" — it arrives as two separate tokens
 * "disc" and "jockey", neither of which means DJ on its own. Rewriting the phrase first is
 * more precise than mapping "jockey" to "dj" globally.
 */
const PHRASES: [RegExp, string][] = [
  [/\bdisc\s*jockeys?\b/gi, " dj "],
  [/\bdee\s*jays?\b/gi, " dj "],
  [/\breal\s+estate\b/gi, " realestate "],
  [/\bsocial\s+media\b/gi, " socialmedia "],
  [/\bvideo\s+editing\b/gi, " videoedit "],
  [/\bcustomer\s+service\b/gi, " customerservice "],
];

function applyPhrases(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PHRASES) out = out.replace(pattern, replacement);
  return out;
}

function canonicalise(token: string): string {
  for (const [pattern, canonical] of CANONICAL) {
    if (pattern.test(token)) return canonical;
  }
  return token;
}

/**
 * Short terms that carry real signal and must survive the length filter.
 *
 * The 3-character minimum exists to drop noise, but it was silently discarding "dj" — for
 * a working DJ that is one of the most important terms in the whole vocabulary. "it" is
 * deliberately absent: it is far more common as a pronoun than as a department.
 */
const SHORT_TERMS = new Set(["dj", "av", "mc", "tv", "vr", "ai", "qa", "ui", "ux", "seo", "pc"]);

/** Crude singularisation — good enough for matching, and predictable. */
function normaliseToken(raw: string): string {
  const token = raw.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  if (token.length < 3) return SHORT_TERMS.has(token) ? token : "";
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return applyPhrases(text)
    .split(/[^A-Za-z0-9+#]+/)
    .map(normaliseToken)
    .map(canonicalise)
    .filter((t) => t && !STOPWORDS.has(t));
}

export interface WeightedTerms {
  /** token → importance. Higher means the term says more about what the job is. */
  weights: Map<string, number>;
  /**
   * Tokens that only came from the long description.
   *
   * Kept apart from `weights` because coverage is a ratio: a 2,000-character description
   * would add ~150 weight-1 tokens and swamp the title and keywords, so a same-vertical
   * job would stop looking like a match. Description text counts as supporting evidence,
   * never against.
   */
  supplementary: Set<string>;
}

function addTerms(
  target: WeightedTerms,
  text: string | null | undefined,
  weight: number,
  supplementary = false
): void {
  for (const token of tokenize(text)) {
    if (supplementary) target.supplementary.add(token);
    target.weights.set(token, Math.max(target.weights.get(token) ?? 0, weight));
  }
}

function addTokenList(target: WeightedTerms, values: readonly string[] | null | undefined, weight: number): void {
  if (!values) return;
  for (const value of values) addTerms(target, value, weight);
}

export interface JobSignalInput {
  role: string;
  company?: string | null;
  keywords?: readonly string[] | null;
  interests?: readonly string[] | null;
  description?: string | null;
}

export interface ResumeSignalInput {
  roleTitle?: string | null;
  keywords?: readonly string[] | null;
  competencies?: readonly string[] | null;
  summary?: string | null;
  experienceTitles?: readonly string[] | null;
}

/**
 * What a job is asking for.
 *
 * Weights: ATS keywords 3 (the terms the posting screens on), title 2 (it names the job —
 * lower than keywords so generic title words like "specialist" cannot outvote the craft),
 * stated interests 2. The description is supplementary only.
 */
export function jobSignal(input: JobSignalInput): WeightedTerms {
  const out: WeightedTerms = { weights: new Map(), supplementary: new Set() };
  addTerms(out, input.role, 2);
  addTokenList(out, input.keywords, 3);
  addTokenList(out, input.interests, 2);

  // Description tokens are supplementary ONLY if they are not already core terms.
  //
  // Every real posting repeats its own title in the body, so marking description tokens
  // unconditionally put the title words into the supplementary set — which the coverage
  // denominator then excluded, collapsing the core signal to nothing. Every job looked
  // like it had "too little text to match on" despite having a 2,000-character body.
  const core = new Set(out.weights.keys());
  for (const token of tokenize(input.description)) {
    if (core.has(token)) continue;
    out.supplementary.add(token);
    out.weights.set(token, Math.max(out.weights.get(token) ?? 0, 1));
  }
  return out;
}

/** What a resume actually covers. */
export function resumeSignal(input: ResumeSignalInput): WeightedTerms {
  const out: WeightedTerms = { weights: new Map(), supplementary: new Set() };
  addTerms(out, input.roleTitle, 3);
  addTokenList(out, input.keywords, 3);
  addTokenList(out, input.competencies, 2);
  addTokenList(out, input.experienceTitles, 2);
  addTerms(out, input.summary, 1);
  return out;
}

export type MatchVerdict = "reuse" | "adapt" | "tailor";

export interface ResumeMatch {
  score: number;
  verdict: MatchVerdict;
  /** Terms the job asks for that this resume covers, most important first. */
  sharedTerms: string[];
  /** Important terms the job asks for that this resume does not mention. */
  missingTerms: string[];
  reason: string;
}

/** Coverage thresholds. Tuned so a same-vertical job reuses and a different one tailors. */
export const REUSE_THRESHOLD = 65;
export const ADAPT_THRESHOLD = 35;

/**
 * Most points that supporting description overlap can add.
 *
 * Capped because it is evidence, not a signal: without a cap a resume that happens to
 * share boilerplate with any posting would creep over the reuse threshold.
 */
const SUPPLEMENTARY_BONUS_MAX = 10;

/**
 * How well a resume covers a job's signal.
 *
 * Deliberately coverage, not symmetric similarity: the question is "does this resume
 * already say what this posting screens for", not "are these two documents alike". A
 * resume that covers everything the job asks for is a reuse candidate even if it is much
 * longer than the posting.
 */
export function matchResumeToJob(job: WeightedTerms, resume: WeightedTerms): ResumeMatch {
  const jobTerms = [...job.weights.entries()].filter(([term]) => !job.supplementary.has(term));
  const totalJobWeight = jobTerms.reduce((sum, [, w]) => sum + w, 0);

  if (totalJobWeight === 0) {
    return {
      score: 0,
      verdict: "tailor",
      sharedTerms: [],
      missingTerms: [],
      reason: "The posting carries too little text to match on — tailor a fresh one.",
    };
  }


  let covered = 0;
  const shared: { term: string; weight: number }[] = [];
  const missing: { term: string; weight: number }[] = [];

  for (const [term, weight] of jobTerms) {
    if (resume.weights.has(term)) {
      covered += weight;
      shared.push({ term, weight });
    } else {
      missing.push({ term, weight });
    }
  }

  // Supporting evidence from the description, capped.
  let bonus = 0;
  for (const term of job.supplementary) {
    if (job.weights.has(term) && resume.weights.has(term)) bonus += 1;
  }
  bonus = Math.min(SUPPLEMENTARY_BONUS_MAX, bonus);

  const score = Math.min(100, Math.round((covered / totalJobWeight) * 100) + bonus);
  const sharedTerms = shared.sort((a, b) => b.weight - a.weight).map((s) => s.term);
  const missingTerms = missing.sort((a, b) => b.weight - a.weight).map((m) => m.term);

  let verdict: MatchVerdict;
  if (score >= REUSE_THRESHOLD) verdict = "reuse";
  else if (score >= ADAPT_THRESHOLD) verdict = "adapt";
  else verdict = "tailor";

  const reason =
    verdict === "reuse"
      ? `Covers ${score}% of what this posting asks for — reuse it as-is.`
      : verdict === "adapt"
        ? `Covers ${score}% — close enough to reuse with a light edit rather than starting over.`
        : `Only ${score}% overlap — different enough to warrant a fresh tailoring.`;

  return { score, verdict, sharedTerms, missingTerms, reason };
}

export interface ResumeCandidate {
  id: number;
  label: string;
  roleTitle?: string | null;
  keywords?: readonly string[] | null;
  competencies?: readonly string[] | null;
  summary?: string | null;
  experienceTitles?: readonly string[] | null;
  isMaster?: boolean;
}

export interface ResumeRecommendation {
  best: (ResumeCandidate & { match: ResumeMatch }) | null;
  /** Ranked runners-up, for when the top pick isn't wanted. */
  alternatives: (ResumeCandidate & { match: ResumeMatch })[];
  /** The recommendation for the whole arsenal: reuse, adapt, or tailor fresh. */
  verdict: MatchVerdict;
  reason: string;
}

/**
 * Pick the best existing resume for a job.
 *
 * The master resume is a candidate too, but it is penalised slightly: it is the general
 * document, so a tailored one that covers the same ground should win. Ties break toward
 * the higher score, then toward the tailored resume over the master.
 */
export function recommendResume(
  job: JobSignalInput,
  candidates: readonly ResumeCandidate[]
): ResumeRecommendation {
  const jobSig = jobSignal(job);

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      match: matchResumeToJob(jobSig, resumeSignal(candidate)),
    }))
    .sort((a, b) => {
      const aScore = a.match.score - (a.isMaster ? 2 : 0);
      const bScore = b.match.score - (b.isMaster ? 2 : 0);
      if (bScore !== aScore) return bScore - aScore;
      if (a.isMaster !== b.isMaster) return a.isMaster ? 1 : -1;
      return a.id - b.id;
    });

  if (scored.length === 0) {
    return {
      best: null,
      alternatives: [],
      verdict: "tailor",
      reason: "No resumes in the arsenal yet — this one has to be tailored from scratch.",
    };
  }

  const [best, ...rest] = scored;
  return {
    best,
    alternatives: rest.slice(0, 4),
    verdict: best.match.verdict,
    reason: best.match.reason,
  };
}

/**
 * Build a candidate from a stored resume row.
 *
 * The fingerprint comes from the resume's own content, so the master resume is usable as
 * a candidate without any extra metadata being filled in first.
 */
export function candidateFromResumeRow(row: {
  id: number;
  type: string;
  label?: string | null;
  roleTitle?: string | null;
  keywords?: string | null;
  content: string;
}): ResumeCandidate {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(row.content);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    // Legacy markdown resumes still match on their raw text.
    parsed = {};
  }

  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const competencies = asStrings(parsed.coreCompetencies)
    .concat(
      parsed.coreCompetencies && typeof parsed.coreCompetencies === "object" && !Array.isArray(parsed.coreCompetencies)
        ? Object.values(parsed.coreCompetencies as Record<string, unknown>).flatMap(asStrings)
        : []
    )
    .concat(asStrings(parsed.technicalProficiencies));

  const experienceTitles = Array.isArray(parsed.professionalExperience)
    ? (parsed.professionalExperience as Record<string, unknown>[])
        .map((e) => (typeof e?.title === "string" ? e.title : ""))
        .filter(Boolean)
    : [];

  let storedKeywords: string[] = [];
  if (row.keywords) {
    try {
      const parsedKeywords = JSON.parse(row.keywords);
      if (Array.isArray(parsedKeywords)) storedKeywords = asStrings(parsedKeywords);
    } catch {
      storedKeywords = [];
    }
  }

  // A legacy markdown resume parses to nothing, which used to leave it with an empty
  // fingerprint and therefore permanently unmatchable. Fall back to its own raw text.
  const hasStructure = Object.keys(parsed).length > 0;

  return {
    id: row.id,
    label: row.label || row.roleTitle || (row.type === "master" ? "Master resume" : `Resume #${row.id}`),
    roleTitle: row.roleTitle ?? (typeof parsed.tagline === "string" ? parsed.tagline : null),
    keywords: storedKeywords,
    competencies,
    summary:
      typeof parsed.professionalSummary === "string"
        ? parsed.professionalSummary
        : hasStructure
          ? null
          : row.content,
    experienceTitles,
    isMaster: row.type === "master",
  };
}
