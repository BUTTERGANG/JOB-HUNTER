import { chatComplete, extractJson, LlmError } from "@/lib/ai/llm";
import {
  DEFAULT_PROFILE,
  buildProfilePromptBlock,
  type TargetProfile,
} from "@/lib/profile";
import {
  computeRankScore,
  evaluateHoursRule,
  buildSoftFlags,
  interestHits,
  clampScore,
  type AxisScores,
  type HoursVerdict,
  type SoftFlag,
} from "@/lib/match";
import {
  describePayForPrompt,
  normalizePay,
  parseInterval,
  HOURS_PER_YEAR,
  type PayRange,
} from "@/lib/pay";

export interface JobSchedule {
  days: string[];
  hasOvertime: boolean;
  isRemote: boolean;
  hoursPerWeek: number | null;
  shiftType: string | null;
}

export interface JobRequirements {
  degreeRequired: string | null;
  yearsExperience: number | null;
  certificationsRequired: string[];
  backgroundCheckRequired: boolean | null;
  locationArea: string;
}

export interface JobAnalysisResult {
  rankScore: number;
  scorePay: number;
  scoreFlexibility: number;
  scoreLocation: number;
  scoreResponsibilities: number;
  scoreHours: number;
  scoreRequirements: number;
  /** Axis added so relevance (interests) is first-class instead of implicit. */
  scoreInterest: number | null;
  /** Axis added so contract/per-event/W-2 fit is scored explicitly. */
  scoreEngagement: number | null;
  /** Normalised pay, unit preserved end to end. */
  payInterval: string | null;
  payLabel: string | null;
  /** The deterministic weekly-hours verdict — never model-computed. */
  hoursVerdict: HoursVerdict | null;
  /** Advisory labels. Informational only; never used to drop a listing. */
  flags: SoftFlag[];
  /** Points removed by deterministic rules, with the reason. Never hidden. */
  penalties: { label: string; points: number }[];
  schedule: JobSchedule;
  requirements: JobRequirements;
  benefits: string[];
  notes: string;
  estimatedSalaryMin: number | null;
  estimatedSalaryMax: number | null;
  salaryConfidence: "high" | "medium" | "low" | null;
  socCode: string | null;
  adjustedSalaryMin: number | null;
  adjustedSalaryMax: number | null;
  colIndex: number | null;
}

export interface JobInput {
  role: string;
  company: string;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** Pay unit as scraped ("hourly", "yearly", "per_event"...). */
  salaryInterval?: string | null;
  /** Where the pay figure came from: "direct_data" (stated) or "estimated". */
  salarySource?: string | null;
  jobType: string | null;
  description: string | null;
  isRemote?: boolean | null;
  jobLevel?: string | null;
  listingType?: string | null;
  companyIndustry?: string | null;
  experienceRange?: string | null;
}

/**
 * Listings per ranking request.
 *
 * Each scored listing costs the model ~400 output tokens (axes, schedule,
 * requirements, flags, notes, salary estimates), so 40 listings needs ~16k output
 * tokens — which is exactly the ceiling that used to be requested. Every chunk
 * truncated, and a 228-listing run scored 0. 20 keeps a chunk near half the budget.
 */
const CHUNK_SIZE = 20;

/** How deep to keep halving a chunk that the model cannot answer in one go. */
const MAX_SPLIT_DEPTH = 4;

const DESCRIPTION_CHARS = 2000;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** The shape the model is asked to return for each listing. */
interface ModelJobResult {
  pay?: number;
  interest?: number;
  responsibility?: number;
  hours?: number;
  flexibility?: number;
  location?: number;
  /** The accessibility axis. Deliberately NOT called "requirements": that key
   *  holds the structured requirements object below, and one JSON object cannot
   *  carry both without one silently clobbering the other. */
  accessibility?: number;
  engagement?: number;
  hoursPerWeek?: number | null;
  isRemote?: boolean | null;
  scheduleFlexible?: boolean | null;
  schedule?: {
    days?: string[];
    hasOvertime?: boolean;
    isRemote?: boolean;
    shiftType?: string | null;
  };
  requirements?: {
    degreeRequired?: string | null;
    yearsExperience?: number | null;
    certificationsRequired?: string[];
    backgroundCheckRequired?: boolean | null;
    locationArea?: string | null;
  };
  benefits?: string[];
  flags?: string[];
  notes?: string;
  estimatedSalaryMin?: number | null;
  estimatedSalaryMax?: number | null;
  salaryConfidence?: string | null;
  socCode?: string | null;
  adjustedSalaryMin?: number | null;
  adjustedSalaryMax?: number | null;
  colIndex?: number | null;
  interestMatches?: string[];
}

function buildPrompt(jobs: JobInput[], profile: TargetProfile): string {
  const jobList = jobs
    .map((j, i) => {
      const pay = normalizePay(j.salaryMin, j.salaryMax, j.salaryInterval);
      const extras = [
        j.jobType ? `Job Type: ${j.jobType}` : null,
        j.isRemote != null ? `Remote (as tagged by the source): ${j.isRemote ? "yes" : "no"}` : null,
        j.salarySource
          ? `Pay source: ${/estimat/i.test(j.salarySource) ? "ESTIMATED by the job board, not stated in the posting" : "stated in the posting"}`
          : null,
        j.jobLevel ? `Level: ${j.jobLevel}` : null,
        j.listingType ? `Listing Type: ${j.listingType}` : null,
        j.companyIndustry ? `Company Industry: ${j.companyIndustry}` : null,
        j.experienceRange ? `Source experience tag: ${j.experienceRange}` : null,
      ].filter(Boolean);

      return `
JOB ${i + 1}
Title: ${j.role}
Company: ${j.company}
Location: ${j.location || "Not specified"}
Pay: ${describePayForPrompt(pay)}
${extras.join("\n")}
Description:
${(j.description || "No description available.").substring(0, DESCRIPTION_CHARS)}
`;
    })
    .join("\n---\n");

  return `${buildProfilePromptBlock(profile)}

## LISTINGS TO RANK
${jobs.length === 1 ? "One listing" : `${jobs.length} listings`} below. Score every one of them —
all ${jobs.length} must appear in your output, in this order. Never skip a listing for being
off-profile, off-industry, part-time, on-site, contract, weekend-heavy or missing details.

Return a JSON array with exactly ${jobs.length} objects, each shaped like this:

{
  "pay": 0-10, "interest": 0-10, "responsibility": 0-10, "hours": 0-10,
  "flexibility": 0-10, "location": 0-10, "accessibility": 0-10, "engagement": 0-10,
  "hoursPerWeek": number|null,
  "isRemote": boolean|null,
  "scheduleFlexible": boolean|null,
  "schedule": { "days": string[], "hasOvertime": boolean, "isRemote": boolean, "shiftType": "day"|"evening"|"night"|"rotating"|null },
  "requirements": {
    "degreeRequired": "none"|"high_school"|"associate"|"bachelor"|"master"|"phd"|null,
    "yearsExperience": number|null,
    "certificationsRequired": string[],
    "backgroundCheckRequired": boolean|null,
    "locationArea": "in_market"|"commutable"|"remote"|"out_of_state"|"unspecified"
  },
  "benefits": string[],
  "flags": string[],
  "notes": string,
  "estimatedSalaryMin": number|null,
  "estimatedSalaryMax": number|null,
  "salaryConfidence": "high"|"medium"|"low",
  "socCode": "XX-XXXX"|null,
  "adjustedSalaryMin": number|null,
  "adjustedSalaryMax": number|null,
  "colIndex": number|null
}

Field notes:
- "hoursPerWeek": the weekly hours the posting implies (null only if genuinely unstated).
  For part-time and per-event work give your best estimate of the typical weekly load.
- "scheduleFlexible": true when the posting offers real scheduling latitude — choosing your
  own shifts, self-scheduled shoots, per-event bookings, "as available" work.
- "flags": short lowercase concerns ("requires own camera", "unpaid travel", "commission only",
  "evening heavy", "licence required"). Use [] when there is nothing notable. A flag is a note
  for the reader, not a disqualifier.
- "notes": ONE sentence naming the biggest positive and biggest negative for this seeker.
- "estimatedSalaryMin/Max": annualised USD for this market. When the listing quotes an hourly,
  daily or per-event rate, annualise it using the weekly hours you recorded (40h/wk if the
  posting is full-time and unstated) so the numbers stay comparable across listings.
- "salaryConfidence": "high" only when the posting states pay explicitly. A figure the
  job board ESTIMATED (see "Pay source") is never "high" — use "low" or "medium", and do
  not let an estimate carry the pay axis on its own.
- "colIndex": cost-of-living index of the job's location (national average 100;
  ${profile.location.city} is ${profile.location.colIndex}). null when the location is unstated.
- "adjustedSalaryMin/Max": the estimated annual pay converted to ${profile.location.city}
  purchasing power: est_salary x (${profile.location.colIndex} / colIndex).

Return ONLY the JSON array. No markdown, no commentary, no text outside the array.

${jobList}`;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Turn one model result into a stored analysis.
 *
 * Everything numeric that drives ordering — the rank score, the weekly-hours
 * verdict, the under-minimum penalty — is computed here from the profile, never
 * taken from the model. The model supplies per-axis judgements and facts; code
 * supplies the arithmetic and the rules.
 */
export function normalizeResult(
  raw: ModelJobResult,
  job: JobInput,
  profile: TargetProfile = DEFAULT_PROFILE
): JobAnalysisResult {
  const pay = normalizePay(job.salaryMin, job.salaryMax, job.salaryInterval, {
    hoursPerWeek: toNumberOrNull(raw.hoursPerWeek),
  });

  // The rate is what makes the hours rule earnings-aware: 15h at $50/hr is judged
  // on the $750/wk it pays, not on the hour count alone.
  const hourlyRate =
    pay.hourlyMin ??
    (pay.annualMin != null && pay.annualMin > 0 ? pay.annualMin / HOURS_PER_YEAR : null);

  const hoursVerdict = evaluateHoursRule(
    {
      hoursPerWeek: toNumberOrNull(raw.hoursPerWeek),
      jobType: job.jobType,
      isRemote:
        raw.isRemote === true || raw.schedule?.isRemote === true || job.isRemote === true,
      flexible: raw.scheduleFlexible === true,
      text: [job.role, job.jobType ?? "", job.description ?? ""].join(" "),
      hourlyRate,
    },
    profile
  );

  const axes: AxisScores = {
    pay: clampScore(raw.pay),
    interest: clampScore(raw.interest),
    responsibility: clampScore(raw.responsibility),
    hours: clampScore(raw.hours),
    flexibility: clampScore(raw.flexibility),
    location: clampScore(raw.location),
    requirements: clampScore(raw.accessibility),
    engagement: clampScore(raw.engagement),
  };

  const ranked = computeRankScore(axes, profile, { hours: hoursVerdict });

  const matches =
    Array.isArray(raw.interestMatches) && raw.interestMatches.length
      ? raw.interestMatches.filter((m): m is string => typeof m === "string")
      : interestHits([job.role, job.company, job.description ?? ""].join(" "), profile);

  const modelFlags: SoftFlag[] = (Array.isArray(raw.flags) ? raw.flags : [])
    .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    .slice(0, 8)
    .map((f) => ({
      code: `model:${f.toLowerCase().slice(0, 40)}`,
      label: f,
      weight: "info" as const,
    }));

  return {
    rankScore: ranked.rankScore,
    scorePay: axes.pay,
    scoreFlexibility: axes.flexibility,
    scoreLocation: axes.location,
    scoreResponsibilities: axes.responsibility,
    scoreHours: axes.hours,
    scoreRequirements: axes.requirements,
    scoreInterest: axes.interest,
    scoreEngagement: axes.engagement,
    payInterval: pay.interval === "unknown" ? parseInterval(job.salaryInterval) : pay.interval,
    payLabel: pay.label,
    hoursVerdict,
    flags: [...buildSoftFlags({ hours: hoursVerdict, interests: matches, profile }), ...modelFlags],
    penalties: ranked.penalties,
    schedule: {
      days: Array.isArray(raw.schedule?.days)
        ? raw.schedule.days.filter((d): d is string => typeof d === "string")
        : [],
      hasOvertime: Boolean(raw.schedule?.hasOvertime),
      isRemote: Boolean(raw.schedule?.isRemote),
      hoursPerWeek: toNumberOrNull(raw.hoursPerWeek),
      shiftType: raw.schedule?.shiftType ?? null,
    },
    requirements: {
      degreeRequired:
        typeof raw.requirements?.degreeRequired === "string"
          ? raw.requirements.degreeRequired
          : null,
      yearsExperience: toNumberOrNull(raw.requirements?.yearsExperience),
      certificationsRequired: Array.isArray(raw.requirements?.certificationsRequired)
        ? raw.requirements.certificationsRequired.filter(
            (c): c is string => typeof c === "string"
          )
        : [],
      backgroundCheckRequired:
        raw.requirements?.backgroundCheckRequired != null
          ? Boolean(raw.requirements.backgroundCheckRequired)
          : null,
      locationArea:
        typeof raw.requirements?.locationArea === "string"
          ? raw.requirements.locationArea
          : "unspecified",
    },
    benefits: Array.isArray(raw.benefits)
      ? raw.benefits.filter((b): b is string => typeof b === "string")
      : [],
    notes: typeof raw.notes === "string" ? raw.notes : "",
    estimatedSalaryMin: toNumberOrNull(raw.estimatedSalaryMin),
    estimatedSalaryMax: toNumberOrNull(raw.estimatedSalaryMax),
    salaryConfidence:
      raw.salaryConfidence === "high" ||
      raw.salaryConfidence === "medium" ||
      raw.salaryConfidence === "low"
        ? raw.salaryConfidence
        : null,
    socCode:
      typeof raw.socCode === "string" && /^\d{2}-\d{4}$/.test(raw.socCode) ? raw.socCode : null,
    adjustedSalaryMin: toNumberOrNull(raw.adjustedSalaryMin),
    adjustedSalaryMax: toNumberOrNull(raw.adjustedSalaryMax),
    colIndex: toNumberOrNull(raw.colIndex),
  };
}

/**
 * Is this failure a "the chunk was too big for one response" problem?
 *
 * Provider problems (bad key, no credit, rate limit, unknown model) must propagate —
 * splitting the chunk would just fail twice as often.
 */
function isChunkSizeProblem(e: unknown): boolean {
  if (!(e instanceof LlmError)) return false;
  if ([400, 401, 402, 403, 404, 429].includes(e.status)) return false;
  return /token ceiling|expected \d+ scored listings|did not return a JSON array|Could not parse/i.test(
    e.message
  );
}

async function analyzeChunkOnce(
  jobs: JobInput[],
  profile: TargetProfile
): Promise<JobAnalysisResult[]> {
  const res = await chatComplete({
    role: "ranker",
    user: buildPrompt(jobs, profile),
    // The model allows 128k output tokens; 32k is generous headroom for a chunk of
    // 20 without inviting a runaway response. The previous 16k ceiling was ours,
    // not the provider's, and it silently failed entire runs.
    maxTokens: 32000,
    jsonObject: true,
  });

  if (res.truncated) {
    throw new LlmError(
      `The ranking response for a chunk of ${jobs.length} hit the token ceiling and is incomplete.`,
      502
    );
  }

  const parsed = extractJson<ModelJobResult[]>(res.text, "array");
  if (!Array.isArray(parsed) || parsed.length !== jobs.length) {
    throw new LlmError(
      `analyzeJobs: expected ${jobs.length} scored listings, got ${Array.isArray(parsed) ? parsed.length : 0}`,
      502
    );
  }

  return parsed.map((r, i) => normalizeResult(r ?? {}, jobs[i], profile));
}

/**
 * Rank a chunk, halving and retrying if the model cannot answer it in one response.
 *
 * Truncation is a size problem, not a fatal one: a chunk that is too large for the
 * output budget still works when split. Without this, one oversized chunk loses the
 * whole run (228 listings scored 0 before this existed).
 */
async function analyzeChunk(
  jobs: JobInput[],
  profile: TargetProfile,
  depth = 0
): Promise<JobAnalysisResult[]> {
  try {
    return await analyzeChunkOnce(jobs, profile);
  } catch (e) {
    if (jobs.length <= 1 || depth >= MAX_SPLIT_DEPTH || !isChunkSizeProblem(e)) throw e;
    const mid = Math.ceil(jobs.length / 2);
    const [first, second] = await Promise.all([
      analyzeChunk(jobs.slice(0, mid), profile, depth + 1),
      analyzeChunk(jobs.slice(mid), profile, depth + 1),
    ]);
    return [...first, ...second];
  }
}

/**
 * Rank a batch of listings.
 *
 * The provider, key and model come from `@/lib/ai/llm` (OpenRouter by default);
 * callers no longer pass an API key around, and no model id is hardcoded here.
 */
/**
 * How many chunks to rank at once.
 *
 * Each chunk's response is ~8k output tokens and the provider streams them at a fixed
 * rate, so chunk count is the whole runtime: 228 listings sequentially took ~15
 * minutes. Three at a time brings that to ~5 without stressing the provider or the
 * per-endpoint rate limit.
 */
const CHUNK_CONCURRENCY = 3;

export async function analyzeJobsBatch(
  jobs: JobInput[],
  profile: TargetProfile = DEFAULT_PROFILE,
  opts: { concurrency?: number } = {}
): Promise<JobAnalysisResult[]> {
  const chunks = chunkArray(jobs, CHUNK_SIZE);
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? CHUNK_CONCURRENCY, chunks.length));

  // Index-assigned so the output stays in the same order as the input regardless of
  // which worker finishes first — the caller pairs results back to listings by index.
  const results: JobAnalysisResult[][] = new Array(chunks.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= chunks.length) return;
      results[index] = await analyzeChunk(chunks[index], profile);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results.flat();
}

/** Exposed for tests and tooling. */
export { buildPrompt as buildRankingPrompt };
export type { PayRange };
