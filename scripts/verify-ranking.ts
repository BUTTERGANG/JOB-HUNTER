/**
 * Offline verification of the profile-driven ranking.
 *
 * Runs with no API key and no network: it exercises the deterministic layers
 * (pay-unit normalisation, the weekly-hours rule, the weighted aggregation, the
 * prompt builder) and then applies the ranking to the real listings the probe
 * scraped, so the structural bias can be measured rather than asserted.
 *
 * Run: node_modules/.bin/tsx scripts/verify-ranking.ts
 *
 * Axis scores for the real listings below are SIMULATED — a hand-applied
 * reading of the rubric from the prompt — because the model itself needs an API
 * key. What is NOT simulated is every number this script computes: the
 * normalisation, the rule verdicts and the weighted totals all come from the
 * same code the app runs.
 */

import { normalizePay, parseInterval, inferInterval, describePayForPrompt } from "@/lib/pay";
import { evaluateHoursRule, computeRankScore, type AxisScores } from "@/lib/match";
import { DEFAULT_PROFILE, parseTargetProfile, rankWeights, buildProfilePromptBlock } from "@/lib/profile";
import { buildRankingPrompt } from "@/lib/ai/analyzeJobs";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`
  );
}
function assert(label: string, cond: boolean) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
}

console.log("\n=== 1. Pay units: an hourly rate is no longer read as an annual salary ===");
const hourly = normalizePay(60, 61, "hourly");
check("$60–$61/hr annualised at 2080h", hourly.annualMin, 124800);
check("$60–$61/hr label keeps its unit", hourly.label, "$60–$61/hr");
check("$60–$61/hr interval", hourly.interval, "hourly");
check(
  "prompt text never says /year for an hourly rate",
  /\/year/.test(describePayForPrompt(hourly)),
  false
);

const yearly = normalizePay(70000, 90000, "yearly");
check("yearly passes through", [yearly.annualMin, yearly.annualMax], [70000, 90000]);
check("yearly label", yearly.label, "$70,000–$90,000/yr");

const perEvent = normalizePay(800, 1500, "per event");
check("per-event is not silently annualised", perEvent.annualMin, null);
check("per-event flag", perEvent.isPerEvent, true);
check("per-event label", perEvent.label, "$800–$1,500/event");

check("interval parsing: 'per hour'", parseInterval("per hour"), "hourly");
check("interval parsing: 'Per Event'", parseInterval("Per Event"), "per_event");
check("inferInterval: bare 14 → hourly", inferInterval(14, null, "unknown"), "hourly");
check("inferInterval: bare 120000 → yearly", inferInterval(120000, null, "unknown"), "yearly");

const contracted = normalizePay(60, 61, "hourly", { hoursPerWeek: 20 });
check("hourly annualised on stated 20h/wk", contracted.annualMin, 62400);

console.log("\n=== 2. The 20h/week rule ===");
const fullTime = evaluateHoursRule({ hoursPerWeek: 40, jobType: "fulltime", isRemote: false });
check("40h/wk meets the minimum", fullTime.meetsMin, true);
check("40h/wk carries no flag", fullTime.flag, null);

const shortRemote = evaluateHoursRule({ hoursPerWeek: 10, jobType: "parttime, remote", isRemote: true });
check("10h/wk remote → justified", [shortRemote.meetsMin, shortRemote.justified], [false, true]);
check("10h/wk remote → justified flag", shortRemote.flag, "hours:under-min-justified");

const shortFlexible = evaluateHoursRule({ hoursPerWeek: 12, jobType: "contract", isRemote: false, flexible: true });
check("12h/wk self-scheduled → justified", shortFlexible.justified, true);

const shortRigid = evaluateHoursRule({ hoursPerWeek: 8, jobType: "parttime", isRemote: false, flexible: false });
check("8h/wk rigid on-site → NOT justified", [shortRigid.meetsMin, shortRigid.justified], [false, false]);
check("8h/wk rigid → penalised flag", shortRigid.flag, "hours:under-min");

console.log("\n=== 3. Aggregation: weights normalise, penalties are explicit ===");
const weights = rankWeights(DEFAULT_PROFILE);
const wsum = Object.values(weights).reduce((s, n) => s + n, 0);
check("default weights sum to 1", Math.abs(wsum - 1) < 1e-9, true);

const skewed = rankWeights({ ...DEFAULT_PROFILE, weights: { ...DEFAULT_PROFILE.weights, pay: 5 } });
check("non-normalised input still sums to 1", Math.abs(Object.values(skewed).reduce((s, n) => s + n, 0) - 1) < 1e-9, true);

const perfect: AxisScores = {
  pay: 10, interest: 10, responsibility: 10, hours: 10,
  flexibility: 10, location: 10, requirements: 10, engagement: 10,
};
check("perfect axes → 100", computeRankScore(perfect, DEFAULT_PROFILE).rankScore, 100);

const penalised = computeRankScore(perfect, DEFAULT_PROFILE, { hours: shortRigid });
check(
  "perfect axes with an unjustified short week lose the configured penalty",
  penalised.rankScore,
  100 - (DEFAULT_PROFILE.penalties.underMinHours ?? 0)
);
check("penalty is reported, not hidden", penalised.penalties.length, 1);

const excused = computeRankScore(perfect, DEFAULT_PROFILE, { hours: shortRemote });
check("a justified short week costs nothing", excused.rankScore, 100);

// Unknown hours must not be fined. A 12-point hit for "schedule not stated"
// quietly buried every listing that omitted its hours — the live probe caught it.
const unknownHours = evaluateHoursRule({ hoursPerWeek: null, jobType: "contract", isRemote: false });
const unknownScored = computeRankScore(perfect, DEFAULT_PROFILE, { hours: unknownHours });
check("unknown hours are flagged", unknownHours.flag, "hours:unknown");
check("unknown hours are NOT penalised", unknownScored.rankScore, 100);
check("unknown hours carry no penalty entry", unknownScored.penalties.length, 0);

// Every common engagement type must be accepted by default, or the profile
// rejects the market's most common listings without being asked to.
check("full-time is accepted by default", DEFAULT_PROFILE.work.acceptFullTime, true);
assert(
  "the prompt lists full-time as an accepted engagement type",
  /full-time \(W-2\)/.test(buildProfilePromptBlock(DEFAULT_PROFILE))
);

console.log("\n=== 4. No persona left in the prompt ===");
const prompt = buildRankingPrompt(
  [
    {
      role: "Wedding Videographer",
      company: "Danbren Media",
      location: "Southport, IN",
      salaryMin: 60,
      salaryMax: 61,
      salaryInterval: "hourly",
      jobType: "contract",
      description: "Weekend wedding shoots. Own gear required.",
    },
  ],
  DEFAULT_PROFILE
);
assert("prompt never claims 'NO college degree'", !/NO college degree/i.test(prompt));
assert("prompt never claims a hard degree constraint", !/hard constraint/i.test(prompt));
assert("prompt does not hardcode the old suburb list", !/Fishers, Carmel, Noblesville/.test(prompt));
assert("prompt carries the editable interests", /photography, photographer/i.test(prompt));
assert("prompt states the 20h/week rule from the profile", /at least 20h\/week/.test(prompt));
assert("prompt carries the real pay unit", /\$60–\$61\/hr/.test(prompt));
assert("prompt forbids computing the total", /do NOT compute a total/i.test(prompt));
assert("prompt mandates scoring every listing", /must appear in your output/i.test(prompt));

console.log("\n=== 5. Profile round-trip ===");
check("missing profile falls back to defaults", parseTargetProfile(null).interests.length > 0, true);
check("garbage profile falls back to defaults", parseTargetProfile("not json").label, DEFAULT_PROFILE.label);
check(
  "partial profile deep-merges",
  parseTargetProfile('{"interests":["drone pilot"],"work":{"minWeeklyHours":32}}').interests,
  ["drone pilot"]
);
check(
  "partial profile keeps untouched defaults",
  parseTargetProfile('{"interests":["drone pilot"]}').work.minWeeklyHours,
  20
);
check(
  "out-of-range hours are clamped, not accepted",
  parseTargetProfile('{"work":{"minWeeklyHours":999}}').work.minWeeklyHours,
  80
);
assert(
  "prompt block renders without throwing",
  buildProfilePromptBlock(DEFAULT_PROFILE).includes("SEEKER PROFILE")
);

console.log("\n=== 6. Real listings, scored under the new weighting vs the old one ===");
console.log(
  "    (axes are a hand-applied rubric simulation; every total below is computed by the app's own code)\n"
);

interface Case {
  label: string;
  axes: AxisScores;
  hours?: Parameters<typeof computeRankScore>[2];
}

const cases: Case[] = [
  {
    label: "Wedding Videographer, Danbren Media (contract, $60/hr, weekends)",
    axes: { pay: 7, interest: 10, responsibility: 8, hours: 7, flexibility: 7, location: 8, requirements: 8, engagement: 9 },
    hours: { hours: shortFlexible },
  },
  {
    label: "Watch Photo / E-comm Listing, Moyer Fine Jewelers (FT, $20-30/hr)",
    axes: { pay: 6, interest: 7, responsibility: 7, hours: 10, flexibility: 4, location: 10, requirements: 8, engagement: 8 },
    hours: { hours: fullTime },
  },
  {
    label: "Automotive Photographer/Videographer (contract, pay unlisted)",
    axes: { pay: 5, interest: 8, responsibility: 7, hours: 7, flexibility: 6, location: 10, requirements: 6, engagement: 8 },
    hours: { hours: shortFlexible },
  },
  {
    label: "Santa Photo, Children's Museum (temporary/PT, $14/hr)",
    axes: { pay: 2, interest: 6, responsibility: 5, hours: 6, flexibility: 5, location: 10, requirements: 10, engagement: 5 },
    hours: { hours: evaluateHoursRule({ hoursPerWeek: 20, jobType: "temporary, parttime", isRemote: false }) },
  },
  {
    label: "CATS Videographer/Editor, Monroe Co Library (PT, Bloomington)",
    axes: { pay: 4, interest: 8, responsibility: 7, hours: 6, flexibility: 4, location: 3, requirements: 6, engagement: 6 },
    hours: { hours: evaluateHoursRule({ hoursPerWeek: 18, jobType: "parttime", isRemote: false, flexible: false }) },
  },
  {
    label: "CONTROL: Software Engineer (remote, $130k, bachelor's required)",
    axes: { pay: 10, interest: 1, responsibility: 7, hours: 10, flexibility: 10, location: 9, requirements: 3, engagement: 9 },
    hours: { hours: fullTime },
  },
  {
    label: "CONTROL: Warehouse Associate (Indy, $40k, M-F, no degree)",
    axes: { pay: 4, interest: 0, responsibility: 4, hours: 10, flexibility: 2, location: 10, requirements: 10, engagement: 9 },
    hours: { hours: fullTime },
  },
];

/** The formula that shipped before this change, for comparison. */
function oldRank(a: AxisScores): number {
  return Math.round((a.pay * 0.25 + a.flexibility * 0.2 + a.location * 0.2 + a.requirements * 0.2 + a.hours * 0.15) * 10);
}

const rows = cases.map((c) => ({
  label: c.label,
  old: oldRank(c.axes),
  neu: computeRankScore(c.axes, DEFAULT_PROFILE, c.hours).rankScore,
}));

console.log("listing".padEnd(74) + "old   new");
for (const r of rows) {
  console.log(r.label.padEnd(74) + String(r.old).padStart(3) + String(r.neu).padStart(6));
}

const target = rows.find((r) => r.label.startsWith("Wedding Videographer"))!;
const swe = rows.find((r) => r.label.includes("Software Engineer"))!;
const warehouse = rows.find((r) => r.label.includes("Warehouse"))!;

console.log("");
assert(
  `the on-target wedding role now outranks the software-engineer control (${target.neu} vs ${swe.neu})`,
  target.neu > swe.neu
);
assert(
  `the on-target wedding role now outranks the warehouse control (${target.neu} vs ${warehouse.neu})`,
  target.neu > warehouse.neu
);
assert(
  `the old formula had the software-engineer control ahead (was ${swe.old} vs ${target.old})`,
  swe.old > target.old
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`
);
process.exit(failures === 0 ? 0 : 1);
