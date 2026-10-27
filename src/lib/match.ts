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
  /**
   * The hourly rate, when known. This is what makes the rule earnings-aware:
   * a short week is judged on what it pays, not only on how many hours it is.
   */
  hourlyRate?: number | null;
}

export interface HoursVerdict {
  /** True when the role clears the hours floor OR the weekly earnings floor. */
  meetsMin: boolean;
  /** True when a shortfall is excused (remote, flexibility, or a high enough rate). */
  justified: boolean;
  effectiveHours: number | null;
  /** hours x rate, when both are known — the figure the rule actually judges. */
  weeklyEarnings: number | null;
  /** Which test carried the verdict. */
  basis: "hours" | "earnings" | null;
  /**
   * Graduated deduction: a near-miss costs a little, a badly short week costs the
   * configured maximum. Zero for anything that clears a floor or is justified.
   */
  penaltyPoints: number;
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
  // The floors live under `work` — reading them off the top level silently made
  // every comparison `>= undefined` and flagged every listing as under-minimum.
  const minHours = profile.work.minWeeklyHours;
  const minEarnings = profile.work.minWeeklyEarnings;
  const maxPenalty = profile.penalties?.underMinHours ?? DEFAULT_PROFILE.penalties!.underMinHours!;

  const hours = input.hoursPerWeek;
  const rate = input.hourlyRate ?? null;
  const weeklyEarnings =
    hours != null && rate != null && rate > 0 ? Math.round(hours * rate) : null;

  const jobTypeText = [input.jobType ?? "", input.text ?? ""].join(" ");
  const flexible = input.flexible === true || FLEX_HINTS.test(jobTypeText);
  const remote = input.isRemote || /remote|work from home|wfh/i.test(jobTypeText);
  const partTimeShaped = PART_TIME_HINTS.test(jobTypeText);

  const hoursOK = hours != null && hours >= minHours;
  const earningsOK = minEarnings != null && weeklyEarnings != null && weeklyEarnings >= minEarnings;

  // ── Clears a floor: no penalty either way ──────────────────────────────────
  if (hoursOK || earningsOK) {
    const lowEarnings = hoursOK && minEarnings != null && weeklyEarnings != null && !earningsOK;
    return {
      meetsMin: true,
      justified: false,
      effectiveHours: hours,
      weeklyEarnings,
      basis: earningsOK ? "earnings" : "hours",
      penaltyPoints: 0,
      reason: earningsOK
        ? `${hours ?? "?"}h at ${rate != null ? `$${rate}/hr` : "the quoted rate"} = $${weeklyEarnings}/wk, which clears the $${minEarnings}/wk floor.`
        : `${hours}h/wk meets the ${minHours}h/wk minimum.`,
      flag: lowEarnings ? "hours:low-earnings" : null,
    };
  }

  // ── Hours unknown: flag, never fine ────────────────────────────────────────
  // Absence of information in a posting is not evidence of a bad role.
  if (hours == null) {
    return {
      meetsMin: false,
      justified: remote || flexible,
      effectiveHours: null,
      weeklyEarnings,
      basis: null,
      penaltyPoints: 0,
      reason: remote
        ? "Hours not stated and the role is remote — treated as acceptable until confirmed."
        : partTimeShaped
          ? "Hours not stated but the engagement type is part-time/per-event — confirm the weekly volume."
          : "Hours not stated — cannot confirm the weekly commitment from the posting alone.",
      flag: "hours:unknown",
    };
  }

  // ── Below the hours floor. Justified by flexibility or remote? ─────────────
  if (remote || flexible) {
    return {
      meetsMin: false,
      justified: true,
      effectiveHours: hours,
      weeklyEarnings,
      basis: null,
      penaltyPoints: 0,
      reason: `${hours}h/wk is below the ${minHours}h/wk minimum, but justified by ${remote ? "remote work" : "scheduling flexibility"}.`,
      flag: "hours:under-min-justified",
    };
  }

  // ── Genuine shortfall: graduated, and visible ──────────────────────────────
  // Judge on earnings when we can, hours otherwise; a near-miss costs little and
  // a badly short week costs the configured maximum.
  const ratio =
    weeklyEarnings != null && minEarnings != null && minEarnings > 0
      ? Math.min(weeklyEarnings / minEarnings, 1)
      : minHours > 0
        ? Math.min(hours / minHours, 1)
        : 1;
  const penaltyPoints = Math.max(0, Math.round(maxPenalty * (1 - ratio)));

  const shortfall =
    weeklyEarnings != null && minEarnings != null
      ? `$${weeklyEarnings}/wk against a $${minEarnings}/wk floor`
      : `${hours}h/wk against a ${minHours}h/wk minimum`;

  return {
    meetsMin: false,
    justified: false,
    effectiveHours: hours,
    weeklyEarnings,
    basis: null,
    penaltyPoints,
    reason: `${shortfall} with no remote, flexibility or rate justification — ${penaltyPoints} of ${maxPenalty} penalty points.`,
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

  // Penalise ONLY a confirmed shortfall with no justification, and only by the
  // graduated amount the rule computed. Unknown hours are flagged, never fined:
  // absence of information in a posting is not evidence of a bad role, and a flat
  // 12-point hit for "schedule not stated" quietly buried most of the market.
  if (opts.hours && opts.hours.penaltyPoints > 0) {
    penalties.push({
      label:
        opts.hours.weeklyEarnings != null
          ? "under the weekly earnings floor"
          : "under the minimum weekly hours",
      points: opts.hours.penaltyPoints,
    });
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
    flags.push({
      code: "hours:under-min",
      label: input.hours.weeklyEarnings != null
        ? `Short week and low earnings ($${input.hours.weeklyEarnings}/wk)`
        : "Under minimum weekly hours",
      weight: "warn",
    });
  } else if (input.hours?.flag === "hours:under-min-justified") {
    flags.push({
      code: "hours:under-min-justified",
      label: "Short week, justified by flexibility/remote",
      weight: "info",
    });
  } else if (input.hours?.flag === "hours:unknown") {
    flags.push({ code: "hours:unknown", label: "Weekly hours not stated", weight: "info" });
  } else if (input.hours?.flag === "hours:low-earnings") {
    flags.push({
      code: "hours:low-earnings",
      label: input.hours.weeklyEarnings != null
        ? `Meets the hours minimum but pays only $${input.hours.weeklyEarnings}/wk`
        : "Meets the hours minimum but the rate is low",
      weight: "info",
    });
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
