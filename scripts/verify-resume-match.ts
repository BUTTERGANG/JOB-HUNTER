/**
 * Offline verification of the resume-arsenal matching rules.
 *
 *   node_modules/.bin/tsx scripts/verify-resume-match.ts
 *
 * No DB, no network, no model call. Asserts the parts that are easy to get quietly wrong:
 * that the same vertical reuses, that a different vertical tailors, that an empty posting
 * never claims a match, and that the master resume is parseable as a candidate without any
 * metadata being filled in first.
 */

import {
  ADAPT_THRESHOLD,
  REUSE_THRESHOLD,
  candidateFromResumeRow,
  jobSignal,
  matchResumeToJob,
  recommendResume,
  resumeSignal,
  type ResumeCandidate,
} from "../src/lib/resumeMatch";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T) {
  const same =
    typeof actual === "object" && actual !== null
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : Object.is(actual, expected);
  check(name, same, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── signals ─────────────────────────────────────────────────────────────────
{
  const job = jobSignal({ role: "Wedding Videographer" });
  check("a title yields weighted terms", job.weights.size > 0);
  eq("the title is weighted 2", job.weights.get("wedding"), 2);

  // Keywords must outrank the title: generic title words like "specialist" must not be
  // able to outvote the craft terms the posting actually screens on.
  const withKeywords = jobSignal({ role: "Media Specialist", keywords: ["photography"] });
  check(
    "a keyword outranks a title word",
    (withKeywords.weights.get("photo") ?? 0) > (withKeywords.weights.get("specialist") ?? 0),
    `photo=${withKeywords.weights.get("photo")} specialist=${withKeywords.weights.get("specialist")}`
  );

  // The craft terms must match across their forms. Without canonicalisation
  // "photographer" and "photography" were different tokens, so the single most important
  // overlap was invisible and a video resume scored 0 against a video job.
  for (const form of ["Photographer", "photography", "Photographs", "PHOTO"]) {
    const sig = jobSignal({ role: form });
    check(`"${form}" canonicalises to photo`, sig.weights.has("photo"), `got: ${[...sig.weights.keys()].join(", ")}`);
  }
  for (const [form, expected] of [["Videographer", "video"], ["videography", "video"], ["Editor", "edit"], ["editing", "edit"], ["disc jockey", "dj"]] as const) {
    const sig = jobSignal({ role: form });
    check(`"${form}" canonicalises to ${expected}`, sig.weights.has(expected), `got: ${[...sig.weights.keys()].join(", ")}`);
  }

  const noisy = jobSignal({ role: "Videographer", description: "You will join our team and be able to work with us" });
  check(
    "stopwords are dropped from the description",
    !noisy.weights.has("join") && !noisy.weights.has("team") && !noisy.weights.has("able"),
    `got: ${[...noisy.weights.keys()].join(", ")}`
  );

  // A description that repeats the title must NOT turn the title into supplementary text.
  // Every real posting does this; getting it wrong collapsed the core signal to zero and
  // made every job report "too little text to match on".
  const repeating = jobSignal({
    role: "Wedding Videographer",
    description: "We are hiring a Wedding Videographer. The Wedding Videographer will shoot weddings.",
  });
  const repeatingCore = [...repeating.weights.entries()].filter(([term]) => !repeating.supplementary.has(term));
  check(
    "a description repeating the title leaves the title as core signal",
    repeatingCore.length > 0 && repeatingCore.some(([term]) => term === "wedding"),
    `core: ${repeatingCore.map(([t]) => t).join(", ")} | supplementary: ${[...repeating.supplementary].join(", ")}`
  );
  check(
    "…and the match still works",
    matchResumeToJob(repeating, resumeSignal({ roleTitle: "Wedding Videographer" })).verdict === "reuse",
    `score ${matchResumeToJob(repeating, resumeSignal({ roleTitle: "Wedding Videographer" })).score}`
  );

  // A long description must not be able to drag a same-vertical job below the reuse
  // threshold — it is supporting evidence, not part of the coverage denominator.
  const filler = Array.from({ length: 120 }, (_, i) => `fillerterm${i}`).join(" ");
  const verbose = jobSignal({
    role: "Wedding Videographer",
    keywords: ["wedding", "videography", "editing"],
    description: filler,
  });
  const matching = resumeSignal({ roleTitle: "Wedding Videographer", keywords: ["wedding", "videography", "editing"] });
  const verboseMatch = matchResumeToJob(verbose, matching);
  check(
    "a 120-term description cannot bury the signal",
    verboseMatch.verdict === "reuse",
    `score ${verboseMatch.score} (verdict ${verboseMatch.verdict})`
  );
}

// ── the same vertical should reuse ──────────────────────────────────────────
{
  const job = {
    role: "Wedding Videographer",
    keywords: ["videography", "wedding", "editing", "camera", "audio"],
  };
  const resume = {
    roleTitle: "Wedding Videographer",
    keywords: ["videography", "wedding", "editing", "camera", "audio"],
    experienceTitles: ["Wedding Videographer", "Photographer / Videographer"],
    summary: "Wedding and event videographer with editing and audio experience.",
  };
  const m = matchResumeToJob(jobSignal(job), resumeSignal(resume));
  eq("an identical resume scores 100", m.score, 100);
  eq("…and is a reuse", m.verdict, "reuse");
  eq("…with nothing missing", m.missingTerms.length, 0);
  check("…and the score clears the reuse threshold", m.score >= REUSE_THRESHOLD);
}

// ── a different vertical should tailor ──────────────────────────────────────
{
  const job = {
    role: "Warehouse Associate",
    keywords: ["forklift", "inventory", "pallet", "shipping", "receiving"],
  };
  const resume = {
    roleTitle: "Wedding Videographer",
    keywords: ["videography", "wedding", "editing", "camera"],
    competencies: ["Video editing", "Audio mixing", "Client management"],
  };
  const m = matchResumeToJob(jobSignal(job), resumeSignal(resume));
  check("an unrelated resume scores low", m.score < ADAPT_THRESHOLD, `score: ${m.score}`);
  eq("…and is a fresh tailoring", m.verdict, "tailor");
  check("…and reports what is missing", m.missingTerms.includes("forklift"), `missing: ${m.missingTerms.join(",")}`);
}

// ── partial overlap should adapt ────────────────────────────────────────────
{
  // Same craft, adjacent subject: a real-estate media role against a wedding video resume.
  const job = {
    role: "Real Estate Media Specialist",
    keywords: ["photography", "video", "real estate", "editing"],
  };
  const resume = {
    roleTitle: "Photographer / Videographer",
    keywords: ["photography", "video", "wedding", "editing", "camera"],
  };
  const m = matchResumeToJob(jobSignal(job), resumeSignal(resume));
  check("an adjacent role lands between the thresholds", m.score >= ADAPT_THRESHOLD && m.score < REUSE_THRESHOLD, `score: ${m.score}`);
  eq("…and is flagged to adapt", m.verdict, "adapt");
  check("…and names the gap", m.missingTerms.length > 0, `missing: ${m.missingTerms.join(",")}`);
}

// ── an empty posting must never claim a match ───────────────────────────────
{
  const m = matchResumeToJob(jobSignal({ role: "" }), resumeSignal({ roleTitle: "Anything" }));
  eq("an empty posting scores 0", m.score, 0);
  eq("…and never recommends a reuse", m.verdict, "tailor");
  check("…and explains why", /too little text/i.test(m.reason), m.reason);
}

// ── no candidates at all ────────────────────────────────────────────────────
{
  const rec = recommendResume({ role: "Photographer" }, []);
  eq("no arsenal → no best pick", rec.best, null);
  eq("no arsenal → tailor", rec.verdict, "tailor");
  check("…with a clear reason", /no resumes in the arsenal/i.test(rec.reason), rec.reason);
}

// ── ranking, and the master penalty ─────────────────────────────────────────
{
  const candidates: ResumeCandidate[] = [
    { id: 1, label: "Master resume", isMaster: true, roleTitle: "Photographer / Videographer", keywords: ["photography", "video", "wedding", "editing"] },
    { id: 2, label: "Wedding — Danbren", roleTitle: "Wedding Videographer", keywords: ["wedding", "videography", "editing", "camera", "audio"] },
    { id: 3, label: "Warehouse — Amazon", roleTitle: "Warehouse Associate", keywords: ["forklift", "inventory", "pallet"] },
  ];
  const rec = recommendResume({ role: "Wedding Videographer", keywords: ["wedding", "videography", "editing", "camera"] }, candidates);

  eq("the same-vertical resume wins", rec.best?.id, 2);
  eq("…and the verdict is reuse", rec.verdict, "reuse");
  check("…with the unrelated one ranked last", rec.alternatives[rec.alternatives.length - 1]?.id === 3, JSON.stringify(rec.alternatives.map((a) => a.id)));
  check("alternatives are offered", rec.alternatives.length >= 2);

  // Covering identical ground: the tailored one should edge out the master.
  const tie: ResumeCandidate[] = [
    { id: 10, label: "Master resume", isMaster: true, roleTitle: "Wedding Videographer", keywords: ["wedding", "videography"] },
    { id: 11, label: "Wedding tailored", roleTitle: "Wedding Videographer", keywords: ["wedding", "videography"] },
  ];
  const tied = recommendResume({ role: "Wedding Videographer", keywords: ["wedding", "videography"] }, tie);
  eq("a tailored resume beats an equally-matching master", tied.best?.id, 11);
}

// ── reading real resume rows ────────────────────────────────────────────────
{
  // The shape /api/ai/tailor actually produces.
  const structured = JSON.stringify({
    name: "Alex Butterfield",
    tagline: "Photographer & Videographer",
    professionalSummary: "Wedding and event videographer.",
    coreCompetencies: { technical: ["Video editing", "Color grading"], operations: ["Client management"] },
    professionalExperience: [
      { title: "Professional Photographer and Videographer", company: "LA MEDIA" },
      { title: "Disk Jockey", company: "Complete Weddings + Events" },
    ],
    technicalProficiencies: ["Adobe Premiere", "Lightroom"],
  });
  const c = candidateFromResumeRow({ id: 5, type: "tailored", label: "Wedding — Danbren", keywords: '["wedding","videography"]', content: structured });
  eq("label comes from the row", c.label, "Wedding — Danbren");
  eq("keywords parse from JSON", c.keywords, ["wedding", "videography"]);
  check("competencies are flattened from the object form", c.competencies!.includes("Video editing") && c.competencies!.includes("Client management"), JSON.stringify(c.competencies));
  check("technical proficiencies are included", c.competencies!.includes("Adobe Premiere"));
  eq("experience titles are extracted", c.experienceTitles, ["Professional Photographer and Videographer", "Disk Jockey"]);
  eq("not the master", c.isMaster, false);

  // coreCompetencies as a flat array (the other accepted shape).
  const flat = candidateFromResumeRow({
    id: 6,
    type: "tailored",
    content: JSON.stringify({ coreCompetencies: ["Video editing", "Audio mixing"] }),
  });
  check("a flat competencies array also works", flat.competencies!.includes("Audio mixing"), JSON.stringify(flat.competencies));

  // Legacy markdown, and a row with no metadata at all.
  const legacy = candidateFromResumeRow({ id: 7, type: "master", content: "# Alex Butterfield\nWedding videographer with camera and audio experience." });
  eq("a master with no label is named", legacy.label, "Master resume");
  eq("…and is marked as master", legacy.isMaster, true);
  check("…and still yields a usable fingerprint", resumeSignal(legacy).weights.size > 0);

  // Malformed JSON must not throw.
  const broken = candidateFromResumeRow({ id: 8, type: "tailored", content: "{not json at all" });
  eq("malformed content does not throw", broken.id, 8);
  check("…and still produces a label", !!broken.label);

  // A master with no stored keywords must still be matchable via its own content.
  const rec = recommendResume(
    { role: "Wedding Videographer", keywords: ["wedding", "videography"] },
    [candidateFromResumeRow({ id: 9, type: "master", content: structured })]
  );
  check("the master is a usable candidate without stored metadata", (rec.best?.match.score ?? 0) > 0, `score: ${rec.best?.match.score}`);
}

console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}
