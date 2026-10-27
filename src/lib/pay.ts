/**
 * Unit-aware pay handling.
 *
 * Every scraped listing carries an amount AND a unit. The unit used to be
 * dropped in the ETL (`scripts/scrape_jobs.py` discarded jobspy's `interval`
 * column), so an hourly rate reached the ranker labelled "/year" and any
 * hourly or per-event posting — i.e. nearly all creative, event and gig work —
 * scored as sub-poverty pay. Nothing downstream may read `salaryMin`/
 * `salaryMax` without also reading the interval.
 */

export type PayInterval =
  | "hourly"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly"
  | "per_event"
  | "unknown";

export interface PayRange {
  min: number | null;
  max: number | null;
  interval: PayInterval;
  /** Annualised equivalent, null when the unit cannot be annualised honestly. */
  annualMin: number | null;
  annualMax: number | null;
  /** Hourly equivalent, null when unknown/per-event. */
  hourlyMin: number | null;
  hourlyMax: number | null;
  /** Per-event / flat-rate quotes have no implied hours — never annualise them silently. */
  isPerEvent: boolean;
  /** Display label that always carries its unit, e.g. "$60–$61/hr". */
  label: string;
}

export const HOURS_PER_YEAR = 2080;
export const WEEKS_PER_YEAR = 52;

const INTERVAL_ALIASES: Record<string, PayInterval> = {
  hourly: "hourly",
  hour: "hourly",
  hr: "hourly",
  daily: "daily",
  day: "daily",
  weekly: "weekly",
  week: "weekly",
  biweekly: "biweekly",
  "bi-weekly": "biweekly",
  fortnightly: "biweekly",
  monthly: "monthly",
  month: "monthly",
  yearly: "yearly",
  annual: "yearly",
  annually: "yearly",
  year: "yearly",
  per_event: "per_event",
  "per event": "per_event",
  perevent: "per_event",
  event: "per_event",
  flat: "per_event",
  "flat rate": "per_event",
  contract: "per_event",
};

/** Normalise a raw interval string (jobspy, CSV, or free text) to a PayInterval. */
export function parseInterval(raw: string | null | undefined): PayInterval {
  if (!raw) return "unknown";
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "nan" || s === "none") return "unknown";
  if (INTERVAL_ALIASES[s]) return INTERVAL_ALIASES[s];
  if (/\bper\s*(event|shoot|wedding|gig|day rate)\b/.test(s)) return "per_event";
  if (/\bflat\s*rate\b/.test(s)) return "per_event";
  if (/\/\s*h(r|our)\b|\bper\s*hour\b|\ban\s*hour\b/.test(s)) return "hourly";
  if (/\/\s*yr\b|\bper\s*year\b|\bannual(ly)?\b|\bsalary\b/.test(s)) return "yearly";
  if (/\/\s*mo\b|\bper\s*month\b/.test(s)) return "monthly";
  if (/\/\s*wk\b|\bper\s*week\b/.test(s)) return "weekly";
  return "unknown";
}

/**
 * Infer the unit from the amount itself when the ETL had no interval column.
 * Below ~$150 the number cannot plausibly be an annual salary.
 */
export function inferInterval(
  min: number | null,
  max: number | null,
  declared: PayInterval
): PayInterval {
  if (declared !== "unknown") return declared;
  const probe = max ?? min;
  if (probe == null) return "unknown";
  if (probe > 0 && probe < 150) return "hourly";
  if (probe >= 150 && probe < 4001) return "unknown"; // could be weekly or monthly
  return "yearly";
}

function scaleFactor(interval: PayInterval, hoursPerWeek: number | null): number | null {
  switch (interval) {
    case "hourly":
      return hoursPerWeek && hoursPerWeek > 0
        ? hoursPerWeek * WEEKS_PER_YEAR
        : HOURS_PER_YEAR;
    case "daily":
      return 260;
    case "weekly":
      return WEEKS_PER_YEAR;
    case "biweekly":
      return 26;
    case "monthly":
      return 12;
    case "yearly":
      return 1;
    default:
      return null; // per_event / unknown — not annualisable
  }
}

/**
 * Normalise a quoted range into annual / hourly equivalents, preserving the
 * original unit. `hoursPerWeek` (when known from the posting) is used for the
 * hourly→annual conversion instead of a blind 2080.
 */
export function normalizePay(
  min: number | null,
  max: number | null,
  interval: string | null | undefined,
  opts: { hoursPerWeek?: number | null } = {}
): PayRange {
  const declared = parseInterval(interval);
  const resolved = inferInterval(min, max, declared);
  const hoursPerWeek = opts.hoursPerWeek ?? null;
  const factor = scaleFactor(resolved, hoursPerWeek);
  const round = (n: number) => Math.round(n / 100) * 100;

  const annualMin = factor != null && min != null ? round(min * factor) : null;
  const annualMax = factor != null && max != null ? round(max * factor) : null;
  const hourlyMin =
    min == null
      ? null
      : resolved === "hourly"
        ? min
        : resolved === "yearly" && factor === 1
          ? Math.round(min / HOURS_PER_YEAR)
          : null;
  const hourlyMax =
    max == null
      ? null
      : resolved === "hourly"
        ? max
        : resolved === "yearly" && factor === 1
          ? Math.round(max / HOURS_PER_YEAR)
          : null;

  return {
    min,
    max,
    interval: resolved,
    annualMin,
    annualMax,
    hourlyMin,
    hourlyMax,
    isPerEvent: resolved === "per_event",
    label: formatPayLabel(min, max, resolved),
  };
}

/** Always-unit-bearing label for prompts and UI. */
export function formatPayLabel(
  min: number | null,
  max: number | null,
  interval: PayInterval
): string {
  if (min == null && max == null) return interval === "unknown" ? "Not listed" : "Not listed";
  const money = (n: number) =>
    n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${n}`;
  const suffix: Record<PayInterval, string> = {
    hourly: "/hr",
    daily: "/day",
    weekly: "/wk",
    biweekly: "/2wk",
    monthly: "/mo",
    yearly: "/yr",
    per_event: "/event",
    unknown: "",
  };
  const body =
    min != null && max != null
      ? `${money(min)}–${money(max)}`
      : min != null
        ? `${money(min)}+`
        : `up to ${money(max!)}`;
  return `${body}${suffix[interval]}`;
}

/**
 * Text the ranker can read without unit confusion: the quoted rate plus its
 * annualised equivalent when one is honest.
 */
export function describePayForPrompt(pay: PayRange): string {
  if (pay.min == null && pay.max == null) return "Not listed";
  const parts = [pay.label];
  if (pay.annualMin != null || pay.annualMax != null) {
    const lo = pay.annualMin != null ? `$${pay.annualMin.toLocaleString("en-US")}` : null;
    const hi = pay.annualMax != null ? `$${pay.annualMax.toLocaleString("en-US")}` : null;
    const annual = lo && hi ? `${lo}–${hi}` : lo ?? `up to ${hi}`;
    parts.push(`(~${annual}/yr equivalent)`);
  } else if (pay.isPerEvent) {
    parts.push("(per-event/flat rate — do NOT annualise; judge rate quality against market event rates)");
  }
  return parts.join(" ");
}
