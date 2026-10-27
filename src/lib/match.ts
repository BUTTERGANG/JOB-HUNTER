/**
 * Deterministic matching rules and the rank aggregation.
 *
 * Two principles this module exists to enforce:
 *
 * 1. **The aggregation lives in code, not in the prompt.** The model returns
 *    per-axis 0–10 scores and structured facts; the weighted sum, the weights
 *    and their normalisation are computed here. Changing the weighting is a
 *    config change, not a prompt rewrite, and an axis can no longer be scored
 *    by the model and then silently left out of the total.
 *
 * 2. **Nothing is filtered out, only scored and flagged.** The user explicitly
 *    wants roles that miss an explicit criterion to stay visible — a solo
 *    photographer gig that does not mention pay, a part-time role that is
 *    remote, an unusual title. Rules therefore return verdicts and flags;
 *    callers may sort or badge by them, never drop.
 */

import type { TargetProfile } from "./profile";
import { DEFAULT_PROFILE, rankWeights } from "./profile";

export type AxisKey = keyof ReturnType<typeof rankWeights>;

export interface AxisScores {
  pay: number;
  interest: number;
  responsibility: number;
  hours: number;
  flexibility: number;
  location: number;
  requirements: number;
  engagement: number;
}

export interface HoursRuleInput {
  /** Hours per week as stated or inferred from the posting; null when unknown. */
  hoursPerWeek: number | null;
  jobType: string | null;
  isRemote: boolean;
  /** Free-text signals of scheduling freedom ("flexible", "choose your shifts", "per event"). */
  flexible?: boolean;
  /** Title + description text to scan for scheduling/remote hints. */
  text?: string;
}

export interface HoursVerdict {
  meetsMin: boolean;
  /** True when the shortfall is excused by remote work or genuine flexibility. */
  justified: boolean;
  effectiveHours: number | null;
  /** Human-readable reason, shown in the UI and fed back to the model as context. */
  reason: string;
  /** Short machine flag, e.g. "hours:under-min". */
  flag: string | null;
}

const PART_TIME_HINTS = /part[\s-]?time|seasonal|per[\s-]?event|freelance|contract|as[\s-]?needed|on[\s-]?call/i;
const FLEX_HINTS = /flexib|choose your|your own schedule|set your own hours|as available|pick your|self[\s-]?schedul/i;

/**
 * The user's hours rule: at least `minWeeklyHours` per week, unless the role is
 * remote or genuinely flexible, in which case a short week is acceptable and is
 * recorded as justified rather than penalised.
 */
export function evaluateHoursRule(
  input: HoursRuleInput,
  profile: TargetProfile = DEFAULT_PROFILE
): HoursVerdict {
  // The floor lives under `work` — reading it off the top level silently made
  // every comparison `>= undefined` and flagged every listing as under-minimum.
  const min = profile.work.minWeeklyHours;
  const effective = input.hoursPerWeek;

  if (effective != null && effective >= min) {
    return {
      meetsMin: true,
      justified: false,
      effectiveHours: effective,
      reason: `${effective}h/wk meets the ${min}h/wk minimum.`,
      flag: null,
    };
  }

  const jobTypeText = [input.jobType ?? "", input.text ?? ""].join(" ");
  const flexible = input.flexible === true || FLEX_HINTS.test(jobTypeText);
  const remote = input.isRemote || /remote|work from home|wfh/i.test(jobTypeText);
  const partTimeShaped = PART_TIME_HINTS.test(jobTypeText);

  if (effective == null) {
    return {
      meetsMin: false,
      justified: remote || flexible,
      effectiveHours: null,
      reason: remote
        ? "Hours not stated and the role is remote — treated as acceptable until confirmed."
        : partTimeShaped
          ? "Hours not stated but the engagement type is part-time/per-event — confirm the weekly volume."
          : "Hours not stated — cannot confirm the weekly minimum from the posting alone.",
      flag: "hours:unknown",
    };
  }

  if (remote || flexible) {
    return {
      meetsMin: false,
      justified: true,
      effectiveHours: effective,
      reason: `${effective}h/wk is below the ${min}h/wk minimum, but justified by ${remote ? "remote work" : "scheduling flexibility"}.`,
      flag: "hours:under-min-justified",
    };
  }

  return {
    meetsMin: false,
    justified: false,
    effectiveHours: effective,
    reason: `${effective}h/wk is below the ${min}h/wk minimum with no remote or flexibility justification.`,
    flag: "hours:under-min",
  };
}

export interface RankedScore {
  rankScore: number;
  /** Each axis after profile weighting, out of 10, in the same order as the weights. */
  breakdown: Record<AxisKey, number>;
  weights: Record<AxisKey, number>;
  /** Deterministic penalty points removed by rules (never hidden). */
  penalties: { label: string; points: number }[];
}

export function clampScore(v: unknown, max = 10): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(0, Math.round(n)));
}

/**
 * Weighted 0–100 rank score. Weights come from the profile and are normalised,
 * so a profile may carry weights that do not sum to 1 without skewing the scale.
 */
export function computeRankScore(
  scores: AxisScores,
  profile: TargetProfile = DEFAULT_PROFILE,
  opts: { hours?: HoursVerdict } = {}
): RankedScore {
  const weights = rankWeights(profile);
  const axes = Object.keys(weights) as AxisKey[];

  let weighted = 0;
  const breakdown = {} as Record<AxisKey, number>;
  for (const axis of axes) {
    const value = clampScore(scores[axis]);
    breakdown[axis] = value;
    weighted += value * weights[axis];
  }

  const penalties: { label: string; points: number }[] = [];

  // Only an unjustified short week costs points; a justified one is recorded
  // and surfaced but does not push the role down the list.
  if (opts.hours && !opts.hours.meetsMin && !opts.hours.justified) {
    const pts = profile.penalties?.underMinHours ?? DEFAULT_PROFILE.penalties!.underMinHours!;
    if (pts > 0) penalties.push({ label: "under minimum weekly hours", points: pts });
  }

  const penaltyTotal = penalties.reduce((sum, p) => sum + p.points, 0);
  const rankScore = Math.max(0, Math.min(100, Math.round(weighted * 10 - penaltyTotal)));

  return { rankScore, breakdown, weights, penalties };
}

/** Interest match: profile interests and industries are the relevance signal. */
export function interestHits(
  text: string,
  profile: TargetProfile = DEFAULT_PROFILE
): string[] {
  const hay = (text || "").toLowerCase();
  if (!hay) return [];
  const terms = [...profile.interests, ...profile.industries];
  return terms.filter((t) => t && hay.includes(t.toLowerCase()));
}

export interface SoftFlag {
  code: string;
  label: string;
  weight: "info" | "warn";
}

/**
 * Assemble the visible flags for a listing. These are advisory: the UI shows
 * them and the user decides. Nothing here removes a listing from the list.
 */
export function buildSoftFlags(input: {
  hours?: HoursVerdict;
  interests: string[];
  profile?: TargetProfile;
  notes?: string | null;
}): SoftFlag[] {
  const profile = input.profile ?? DEFAULT_PROFILE;
  const flags: SoftFlag[] = [];

  if (input.hours?.flag === "hours:under-min") {
    flags.push({ code: "hours:under-min", label: "Under minimum weekly hours", weight: "warn" });
  } else if (input.hours?.flag === "hours:under-min-justified") {
    flags.push({ code: "hours:under-min-justified", label: "Short week, justified by flexibility/remote", weight: "info" });
  } else if (input.hours?.flag === "hours:unknown") {
    flags.push({ code: "hours:unknown", label: "Weekly hours not stated", weight: "info" });
  }

  if (input.interests.length === 0) {
    flags.push({ code: "interest:off-profile", label: "Outside stated interests", weight: "info" });
  } else {
    flags.push({ code: "interest:match", label: `Matches: ${input.interests.join(", ")}`, weight: "info" });
  }

  if (profile.industries.length === 0) {
    flags.push({ code: "industry:open", label: "Industry unrestricted", weight: "info" });
  }

  return flags;
}
