import Anthropic from "@anthropic-ai/sdk";
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
import { describePayForPrompt, normalizePay, parseInterval, type PayRange } from "@/lib/pay";

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
  jobType: string | null;
  description: string | null;
  isRemote?: boolean | null;
  jobLevel?: string | null;
  listingType?: string | null;
  companyIndustry?: string | null;
  experienceRange?: string | null;
}

const CHUNK_SIZE = 40;
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
- "salaryConfidence": "high" only when the posting states pay explicitly.
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

  const hoursVerdict = evaluateHoursRule(
    {
      hoursPerWeek: toNumberOrNull(raw.hoursPerWeek),
      jobType: job.jobType,
      isRemote:
        raw.isRemote === true || raw.schedule?.isRemote === true || job.isRemote === true,
      flexible: raw.scheduleFlexible === true,
      text: [job.role, job.jobType ?? "", job.description ?? ""].join(" "),
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

async function analyzeChunk(
  client: Anthropic,
  jobs: JobInput[],
  profile: TargetProfile
): Promise<JobAnalysisResult[]> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16000,
    messages: [{ role: "user", content: buildPrompt(jobs, profile) }],
  });

  // Models with extended thinking return a leading "thinking" block — take the
  // first actual text block rather than assuming content[0].
  const block = response.content.find((b) => b.type === "text");
  const text = block && block.type === "text" ? block.text : "";

  // Strip a ```json fence if the model added one, then take the outermost array.
  const unfenced = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const match = unfenced.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`analyzeJobs: no JSON array in response for chunk of ${jobs.length}`);
  }

  const parsed: ModelJobResult[] = JSON.parse(match[0]);
  if (!Array.isArray(parsed) || parsed.length !== jobs.length) {
    throw new Error(`analyzeJobs: expected ${jobs.length} results, got ${parsed?.length ?? 0}`);
  }

  return parsed.map((r, i) => normalizeResult(r ?? {}, jobs[i], profile));
}

export async function analyzeJobsBatch(
  jobs: JobInput[],
  apiKey: string,
  profile: TargetProfile = DEFAULT_PROFILE
): Promise<JobAnalysisResult[]> {
  const client = new Anthropic({ apiKey });
  const chunks = chunkArray(jobs, CHUNK_SIZE);
  const allResults: JobAnalysisResult[] = [];

  for (const chunk of chunks) {
    const results = await analyzeChunk(client, chunk, profile);
    allResults.push(...results);
  }

  return allResults;
}

/** Exposed for tests and tooling. */
export { buildPrompt as buildRankingPrompt };
export type { PayRange };
