/**
 * The target profile — the single, user-editable place that describes what a
 * good job looks like.
 *
 * Why this exists: the ranker used to carry a *hardcoded persona* inside its
 * prompt (no college degree / wants remote / wants Mon–Fri / Indianapolis
 * suburbs). That persona was invisible in the UI, could not be changed without
 * editing source, and structurally capped an entire class of work — on-site,
 * weekend, per-event roles scored near the floor no matter how good they were.
 *
 * Rules for this module:
 * - **Nothing here is a filter.** The profile shapes scoring, ordering and
 *   labels. Roles that miss a stated preference stay in the list, flagged.
 * - **Every value is editable at runtime.** Persisted as JSON under the
 *   `target_profile` setting; `parseTargetProfile` deep-merges onto the
 *   defaults, so a partial or older profile is always safe to load.
 * - Pure module: no database or network imports, so the prompt builder and the
 *   scoring code can both depend on it without a cycle.
 */

export interface ProfileLocation {
  city: string;
  state: string;
  /** Cost-of-living index, national average = 100. Used to compare pay across markets. */
  colIndex: number;
  /** Commute tolerance in minutes; drives how hard distance is penalised. */
  maxCommuteMinutes: number;
  /** When true, out-of-state roles are scored on merit rather than discounted. */
  acceptOutOfState: boolean;
}

export interface ProfileWork {
  acceptOnSite: boolean;
  acceptRemote: boolean;
  acceptHybrid: boolean;
  acceptWeekends: boolean;
  acceptEvenings: boolean;
  acceptHolidays: boolean;
  /**
   * Employment types. `acceptFullTime` exists because its absence silently made
   * every full-time W-2 role score engagement 2 and carry a "not in accepted
   * types" flag — i.e. the profile was rejecting the most common engagement
   * type in the market without anyone asking it to.
   */
  acceptFullTime: boolean;
  acceptContract: boolean;
  acceptFreelance: boolean;
  acceptPerEvent: boolean;
  acceptTemporary: boolean;
  acceptPartTime: boolean;
  /** The weekly-hours floor: 20 by default. */
  minWeeklyHours: number;
  /**
   * What a week must be worth, in dollars, for a short week to be acceptable.
   *
   * This is what makes the rule earnings-aware rather than hours-counting:
   * 15h at $50/hr ($750/wk) clears it, 15h at $15/hr ($225/wk) does not. A role
   * is acceptable when it clears EITHER this floor or `minWeeklyHours`.
   * Null disables the earnings test and leaves a pure hours rule.
   */
  minWeeklyEarnings: number | null;
  /**
   * When true, a week below `minWeeklyHours` must be justified by remote work,
   * scheduling flexibility, or the earnings floor to avoid a penalty — it is
   * still ranked and shown.
   */
  requireJustificationBelowMinHours: boolean;
}

export interface ProfileCompensation {
  /** Null = no floor configured; pay is then scored against market rate, not pass/fail. */
  floorHourly: number | null;
  targetHourly: number | null;
  stretchHourly: number | null;
  floorAnnual: number | null;
  targetAnnual: number | null;
  stretchAnnual: number | null;
  /** Whether per-event/flat-rate engagements are acceptable without annualised pay. */
  acceptPerEventPay: boolean;
  /** Whether unpaid travel/editing time is a dealbreaker. */
  requirePaidTravel: boolean;
}

export interface ProfileWeights {
  pay: number;
  interest: number;
  responsibility: number;
  hours: number;
  flexibility: number;
  location: number;
  requirements: number;
  engagement: number;
}

export interface ProfileRequirements {
  /** null = the question does not apply / was never asked. */
  hasCollegeDegree: boolean | null;
  highestEducation: string;
  yearsExperience: number | null;
  /** Gear the applicant already owns — a signal for shoot/production roles. */
  ownGear: string[];
  certifications: string[];
  /** Portfolio/reel is the real gate on creative roles, in place of a degree. */
  hasPortfolio: boolean;
}

export interface ProfileScoring {
  /**
   * Widen-search mode: role titles that are not explicitly listed are still
   * scored on merit and kept visible. This is on by default and should stay on
   * — the point of the profile is preference, not exclusion.
   */
  widenSearch: boolean;
  /** Display/alert threshold only. Never deletes a row. */
  minDisplayScore: number;
  /** How much a confirmed interest match is worth on the interest axis. */
  notes: string;
}

export interface TargetProfile {
  version: number;
  label: string;
  location: ProfileLocation;
  work: ProfileWork;
  compensation: ProfileCompensation;
  /** Free-text interest tags — the relevance signal. Lowercase, matched as substrings. */
  interests: string[];
  /** Empty means "any industry" — the user is explicitly not picky here. */
  industries: string[];
  roles: {
    /** Titles/terms that usually indicate a good fit. Advisory, never a requirement. */
    include: string[];
    /** Terms that usually indicate a bad fit. Recorded as a flag, still scored. */
    marginal: string[];
  };
  requirements: ProfileRequirements;
  weights: ProfileWeights;
  penalties: { underMinHours: number };
  scoring: ProfileScoring;
  /** Free text appended verbatim to the ranking prompt. */
  notes: string;
}

export const PROFILE_SETTING_KEY = "target_profile";

export const DEFAULT_PROFILE: TargetProfile = {
  version: 1,
  label: "Creative & live-event work — Indianapolis",
  location: {
    city: "Indianapolis",
    state: "IN",
    colIndex: 91,
    maxCommuteMinutes: 45,
    acceptOutOfState: true,
  },
  work: {
    acceptOnSite: true,
    acceptRemote: true,
    acceptHybrid: true,
    acceptWeekends: true,
    acceptEvenings: true,
    acceptHolidays: false,
    acceptFullTime: true,
    acceptContract: true,
    acceptFreelance: true,
    acceptPerEvent: true,
    acceptTemporary: true,
    acceptPartTime: true,
    minWeeklyHours: 20,
    // $600/wk ≈ $31k/yr. Deliberately below 20h × the default pay expectations
    // so it excuses a genuinely well-paid short week without excusing a thin one.
    minWeeklyEarnings: 600,
    requireJustificationBelowMinHours: true,
  },
  compensation: {
    // Left unset on purpose: with no floor the pay axis is scored relative to
    // market rate for the role instead of pass/fail, so nothing is hidden for
    // not listing a number. Set these in Settings to make it absolute.
    floorHourly: null,
    targetHourly: null,
    stretchHourly: null,
    floorAnnual: null,
    targetAnnual: null,
    stretchAnnual: null,
    acceptPerEventPay: true,
    requirePaidTravel: false,
  },
  interests: [
    "photography",
    "photographer",
    "videography",
    "videographer",
    "video editor",
    "dj",
    "live events",
    "wedding",
    "event production",
    "audio",
    "lighting",
    "creative",
  ],
  industries: [],
  roles: {
    include: [
      "photographer",
      "videographer",
      "video editor",
      "dj",
      "event",
      "production assistant",
      "content creator",
      "studio",
    ],
    marginal: [],
  },
  requirements: {
    hasCollegeDegree: null,
    highestEducation: "",
    yearsExperience: null,
    ownGear: [],
    certifications: [],
    hasPortfolio: true,
  },
  weights: {
    // Sums to 1.00. Normalised in rankWeights() regardless, so a profile may
    // carry weights that do not add up without skewing the 0–100 scale.
    pay: 0.22,
    interest: 0.2,
    responsibility: 0.13,
    hours: 0.13,
    flexibility: 0.1,
    location: 0.08,
    requirements: 0.09,
    engagement: 0.05,
  },
  penalties: { underMinHours: 12 },
  scoring: {
    widenSearch: true,
    minDisplayScore: 0,
    notes: "",
  },
  notes: "",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge of a partial profile onto a base, ignoring undefined. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  if (!isPlainObject(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value)
      ? deepMerge(current, value)
      : value;
  }
  return out as T;
}

/** Parse a stored profile (JSON string or object) onto the defaults. Never throws. */
export function parseTargetProfile(raw: unknown): TargetProfile {
  if (!raw) return { ...DEFAULT_PROFILE };
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { ...DEFAULT_PROFILE };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }
  const merged = deepMerge(DEFAULT_PROFILE, parsed);
  return sanitizeProfile(merged);
}

/** Coerce obviously-wrong values back into range; never drop user intent. */
export function sanitizeProfile(p: TargetProfile): TargetProfile {
  const out: TargetProfile = { ...p };
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  out.work = {
    ...out.work,
    minWeeklyHours:
      Number.isFinite(out.work?.minWeeklyHours) && out.work.minWeeklyHours >= 0
        ? clamp(out.work.minWeeklyHours, 0, 80)
        : DEFAULT_PROFILE.work.minWeeklyHours,
    minWeeklyEarnings:
      out.work?.minWeeklyEarnings == null || !Number.isFinite(Number(out.work.minWeeklyEarnings))
        ? null
        : clamp(Number(out.work.minWeeklyEarnings), 0, 100_000),
  };
  out.location = {
    ...out.location,
    colIndex:
      Number.isFinite(out.location?.colIndex) && out.location.colIndex > 0
        ? clamp(out.location.colIndex, 40, 300)
        : DEFAULT_PROFILE.location.colIndex,
    maxCommuteMinutes:
      Number.isFinite(out.location?.maxCommuteMinutes) && out.location.maxCommuteMinutes > 0
        ? clamp(out.location.maxCommuteMinutes, 5, 300)
        : DEFAULT_PROFILE.location.maxCommuteMinutes,
  };
  out.interests = Array.isArray(out.interests)
    ? out.interests.map((s) => String(s).trim()).filter(Boolean)
    : DEFAULT_PROFILE.interests;
  out.industries = Array.isArray(out.industries)
    ? out.industries.map((s) => String(s).trim()).filter(Boolean)
    : [];
  out.penalties = {
    underMinHours:
      Number.isFinite(out.penalties?.underMinHours) && out.penalties.underMinHours >= 0
        ? clamp(out.penalties.underMinHours, 0, 100)
        : DEFAULT_PROFILE.penalties.underMinHours,
  };
  out.scoring = {
    ...out.scoring,
    widenSearch: out.scoring?.widenSearch !== false,
    minDisplayScore:
      Number.isFinite(out.scoring?.minDisplayScore) && out.scoring.minDisplayScore >= 0
        ? clamp(out.scoring.minDisplayScore, 0, 100)
        : 0,
  };
  return out;
}

/**
 * Normalised axis weights. Always sums to 1 across the axes that are actually
 * in play, so changing one weight cannot silently rescale the 0–100 range.
 */
export function rankWeights(profile: TargetProfile = DEFAULT_PROFILE): ProfileWeights {
  const raw: ProfileWeights = {
    pay: num(profile.weights?.pay, DEFAULT_PROFILE.weights.pay),
    interest: num(profile.weights?.interest, DEFAULT_PROFILE.weights.interest),
    responsibility: num(profile.weights?.responsibility, DEFAULT_PROFILE.weights.responsibility),
    hours: num(profile.weights?.hours, DEFAULT_PROFILE.weights.hours),
    flexibility: num(profile.weights?.flexibility, DEFAULT_PROFILE.weights.flexibility),
    location: num(profile.weights?.location, DEFAULT_PROFILE.weights.location),
    requirements: num(profile.weights?.requirements, DEFAULT_PROFILE.weights.requirements),
    engagement: num(profile.weights?.engagement, DEFAULT_PROFILE.weights.engagement),
  };
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  if (total <= 0) return { ...DEFAULT_PROFILE.weights };
  const out = {} as ProfileWeights;
  for (const key of Object.keys(raw) as (keyof ProfileWeights)[]) {
    out[key] = raw[key] / total;
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const money = (n: number | null) =>
  n == null ? "not set" : n >= 1000 ? `$${n.toLocaleString("en-US")}` : `$${n}/hr`;

/**
 * Render the profile as the prompt's opening block.
 *
 * The prompt must contain no persona of its own — everything the model is told
 * about the job seeker comes from here, so the UI can change it.
 */
export function buildProfilePromptBlock(profile: TargetProfile = DEFAULT_PROFILE): string {
  const w = rankWeights(profile);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const yesNo = (b: boolean) => (b ? "yes" : "no");

  const comp = profile.compensation;
  const payLines: string[] = [];
  if (comp.floorHourly != null) payLines.push(`  hourly floor: ${money(comp.floorHourly)}`);
  if (comp.targetHourly != null) payLines.push(`  hourly target: ${money(comp.targetHourly)}`);
  if (comp.stretchHourly != null) payLines.push(`  hourly stretch: ${money(comp.stretchHourly)}`);
  if (comp.floorAnnual != null) payLines.push(`  annual floor: ${money(comp.floorAnnual)}`);
  if (comp.targetAnnual != null) payLines.push(`  annual target: ${money(comp.targetAnnual)}`);
  if (comp.stretchAnnual != null) payLines.push(`  annual stretch: ${money(comp.stretchAnnual)}`);
  if (payLines.length === 0) {
    payLines.push(
      "  NO FLOOR OR TARGET SET — score pay on rate quality for this kind of work in this market.",
      "  Do not treat a missing salary as a reason to score low; judge the rate that IS quoted fairly."
    );
  }

  const req = profile.requirements;
  const edu = req.hasCollegeDegree === true
    ? `holds a college degree (${req.highestEducation || "unspecified"})`
    : req.hasCollegeDegree === false
      ? "does not hold a college degree"
      : "education level unstated — do NOT assume either way and do NOT penalise a degree requirement";

  const gear = req.ownGear.length ? req.ownGear.join(", ") : "none recorded";

  const notes = [profile.notes, profile.scoring.notes].filter(Boolean).join("\n");

  return `You are ranking job listings for one specific job seeker. Everything you are
told about them comes from the profile below. Do not assume anything that is not
stated here, and do not apply a persona of your own.

## SEEKER PROFILE
Market: ${profile.location.city}, ${profile.location.state} (cost-of-living index ${profile.location.colIndex}, national average 100)
Commute tolerance: ~${profile.location.maxCommuteMinutes} minutes; out-of-state roles are ${yesNo(profile.location.acceptOutOfState) ? "in scope on merit" : "out of scope"}
Weekly commitment: at least ${profile.work.minWeeklyHours}h/week${profile.work.minWeeklyEarnings != null ? `, OR at least $${profile.work.minWeeklyEarnings}/week in earnings — whichever the role satisfies` : ""}.
A role clears the bar when it meets EITHER test. Hours and pay trade off directly: a
15h/week role at $50/hr ($750/wk) is BETTER than a 20h/week role at $15/hr ($300/wk), and must
not be marked down for having fewer hours. Judge a short week on what it actually pays — a
high rate justifying fewer hours is a good outcome, not a deficiency.
Only a week that misses BOTH the hours floor and the earnings floor, with no remote or
scheduling-flexibility justification, is a genuine shortfall — and even then it stays in the
list, flagged.
Education: ${edu}
Own gear: ${gear}
Portfolio/reel: ${yesNo(req.hasPortfolio)}${req.yearsExperience != null ? `\nYears of experience: ${req.yearsExperience}` : ""}${req.certifications.length ? `\nCertifications: ${req.certifications.join(", ")}` : ""}

Willing to work: ${[
    profile.work.acceptOnSite && "on-site",
    profile.work.acceptRemote && "remote",
    profile.work.acceptHybrid && "hybrid",
    profile.work.acceptWeekends && "weekends",
    profile.work.acceptEvenings && "evenings",
    profile.work.acceptHolidays && "holidays",
  ].filter(Boolean).join(", ") || "unspecified"}

Engagement types accepted: ${[
    profile.work.acceptFullTime && "full-time (W-2)",
    profile.work.acceptContract && "contract",
    profile.work.acceptFreelance && "freelance",
    profile.work.acceptPerEvent && "per-event",
    profile.work.acceptTemporary && "temporary",
    profile.work.acceptPartTime && "part-time",
  ].filter(Boolean).join(", ") || "unspecified"}
If a listing is an engagement type OTHER than the ones listed here, still score it on its
merits and note the mismatch in the flags array — do not treat it as a disqualification.

Compensation:
${payLines.join("\n")}
Per-event / flat-rate pay is ${comp.acceptPerEventPay ? "acceptable" : "not acceptable"}; unpaid travel and editing time is ${comp.requirePaidTravel ? "a dealbreaker" : "tolerable"}.
IMPORTANT — UNITS: each listing shows its rate WITH its unit ("/hr", "/yr", "/event"). Never
re-read an hourly or per-event rate as an annual salary or vice versa. When a rate is hourly or
per-event, judge it against what that work pays in this market, not against a 40-hour salary.

## INTERESTS (relevance signal)
${profile.interests.length ? profile.interests.join(", ") : "none specified — score interest on general fit"}
${profile.industries.length ? `Industries of interest: ${profile.industries.join(", ")}` : "Industries: no restriction — any industry is acceptable if the role scores well on pay, responsibility and interest."}
Roles that usually fit: ${profile.roles.include.length ? profile.roles.include.join(", ") : "unspecified"}${profile.roles.marginal.length ? `\nRoles that are usually marginal: ${profile.roles.marginal.join(", ")} (score them honestly and flag the concern — do not discard them)` : ""}

## HOW TO JUDGE
The seeker is NOT picky about industry. A role is good when it ranks well on pay,
responsibility and interest. Apply this rule literally:

- WIDEN THE SEARCH. A listing must never be scored down merely for being outside
  the stated interests, using a title we did not list, being part-time, being
  on-site, being weekend/evening work, or being contract/per-event. Those are
  preferences, not requirements.
- If a listing does not match the explicit interests but looks genuinely
  promising for pay, responsibility or skill growth, score it on those merits and
  say so in one clause — it must stay near the top if its merits are high.
- Be generous where information is missing. Absence of a salary, a schedule, or a
  degree requirement is NOT evidence of a bad role.
- Report facts as stated. Do not invent salary, hours, or requirements.

## AXES — return a 0–10 integer for each
pay            Rate quality for this work in this market, using the listing's real
               unit. With no floor set, ${profile.compensation.floorHourly == null ? "10 = strong for the work and clearly livable, 5 = typical, 0 = exploitative or unpaid." : "score against the configured floor/target above."}
interest       How well the work itself matches the stated interests and the kind
               of work the seeker wants to do. 0 = nothing in common, 10 = squarely
               in the target vertical.
responsibility How attractive the duties are: 10 = work the seeker is capable of and
               would be good at, with room to own something; 0 = duties that are
               unsuitable, or so senior/multi-discipline they are unrealistic.
hours          Fit of the weekly commitment, weighing hours AND what the week pays:
               10 = clears the hours minimum, or pays well above the weekly earnings
               floor on fewer hours; 5 = borderline on both counts, or unclear;
               0 = few hours AND low earnings with no flexibility. A short week at a
               high rate belongs at 8-10, not at 5 — do not score hours on the hour
               count alone. Weekend and evening work is NOT a deduction here: the
               seeker works live events.
flexibility    Scheduling freedom: 10 = fully remote or largely self-scheduled;
               5 = predictable set schedule; 0 = rigidly fixed hours with no
               give. On-site shoot work should sit around 4–6, not 0.
location       Commute/relocation desirability from ${profile.location.city}:
               10 = in town or no commute, 5 = within the tolerance, 1 = requires
               relocating far away. Remote work is at least 9.
accessibility  (returned as "accessibility" — the key "requirements" is the
               structured object below it, so the two must not collide)
               10 = nothing formal required or training provided; 5 = experience
               preferred, no credential gate; 0 = a credential, licence or
               portfolio the seeker plainly cannot meet.
engagement     How well the engagement type suits the seeker: 10 = a type they
               accepted above with stable volume; 0 = a type they did not accept.

## WEIGHTS IN USE (for your judgement only — do NOT compute a total)
pay ${pct(w.pay)}, interest ${pct(w.interest)}, responsibility ${pct(w.responsibility)},
hours ${pct(w.hours)}, flexibility ${pct(w.flexibility)}, location ${pct(w.location)},
requirements ${pct(w.requirements)}, engagement ${pct(w.engagement)}.
Return the axes only. The total is computed in code from this weighting.
${notes ? `\n## ADDITIONAL INSTRUCTIONS FROM THE SEEKER\n${notes}` : ""}`;
}
