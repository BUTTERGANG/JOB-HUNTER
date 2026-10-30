## 2026-10-30 — Silent-error audit: what was fixed, and what is still open

A sweep for failures that do not announce themselves. Fixed items are decisions; the open
ones are recorded so they are not rediscovered as surprises.

**Fixed**

- **A hand-edit to a resume inserted a new row every save.** `PUT /api/jobs/[id]/resume` called
  `saveTailoredResume`, which inserts — so each edit added an arsenal row stripped of its
  label, keywords and provenance, and a *reused* resume silently became an anonymous
  *tailored* one. Editing now updates the row attached to the job.
- **Six unguarded `JSON.parse` calls on database columns.** `JSON.parse(analysis.keywords ||
  "[]")` guards against NULL, not against malformed text, so one bad row 500'd the endpoint
  that read it. All parsing of stored JSON now goes through `src/lib/json.ts`, which never
  throws; three duplicate implementations were consolidated into it.
- **36 migrations used `try { … } catch {}`.** A locked database, a read-only file or a typo'd
  column all looked exactly like "already migrated", and the app then failed later somewhere
  unrelated. Only a duplicate-column / already-exists error is tolerated now; anything else
  throws naming the statement.
- **`src/app/api/auth.ts` was never a route.** Next only serves `route.ts` from the App Router,
  so that health check did not exist. It was also the sole importer of
  `src/lib/authMiddleware.ts`, whose `getClientIdentifier` was byte-identical to
  `rateLimit.ts`'s. Both deleted; a real `GET /api/health` added.
- **The dashboard inlined the interview-status list** while `ACTIVE_INTERVIEW_STATUSES` sat
  unimported — two sources of truth for one rule, free to drift. Now imported.
- **Client-side silent failures.** The dashboard's post-action reload swallowed errors, so a
  failed refresh looked like "the button did nothing". Worse, the job page treated a failed
  resume load as "no resume" — inviting a fresh tailoring over a resume that was there all
  along. Both now say so.
- **Build tracing.** A dynamic `path.resolve` in `pythonBin.ts` made the bundler trace the
  entire project (public folder included) into the server output; annotated with
  `turbopackIgnore`.

**Still open, deliberately**

- **`listing_status_history` is written but never read.** Listing rechecks append history
  rows; no UI or query surfaces them, though the README claims long-term trend analysis.
  Either surface it on the job page or stop writing it.
- **Remaining dead exports:** `getExistingTrackedJobIdentityKeys`, `getSocSectorPrefix`,
  `TERMINAL_STATUSES`.
- **`src/lib/db/migrate.ts`** is a standalone script referenced by no npm script, and it
  duplicates what `ensureDb()` does.
- **Unused UI components:** `sheet`, `tooltip`, `separator`, `dropdown-menu` (shadcn leftovers).
- **`POST /api/jobs` returns 201 while other POSTs return 200.** Correct but inconsistent;
  every client checks `res.ok`, so it is cosmetic.
- **Refactor candidates, by value:** `src/lib/db/queries.ts` (~950 lines) mixes jobs, resumes,
  steps, metrics and scrape concerns; `src/app/jobs/[id]/page.tsx` is ~1,250 lines with six
  responsibilities; and three overlapping notions of "interview" (an active loop / a human
  replied / reached an interview stage) are documented but still separate concepts.

# Decisions

Why things are the way they are, newest first. Each entry records the decision, the reason,
and what was rejected — so a later change is a deliberate reversal rather than a regression.

---

## 2026-10-30 — Resume arsenal: reuse an existing resume instead of re-tailoring

**Decision.** Build a resume library (a "Resumes" tab) that collects every resume as it is
created, and recommend an existing one for a similar job rather than generating a new one for
every posting. Tailoring fresh is reserved for jobs that genuinely differ.

**Why.** Tailoring is currently one-job-at-a-time from `/jobs/[id]` and reachable only for
jobs already in the tracker — so 231 ranked listings produced 1 tailored resume. Most jobs in
a vertical want substantially the same resume; regenerating it per posting is wasted effort
and wasted model calls.

**How matching works** (`src/lib/resumeMatch.ts`, verified by `scripts/verify-resume-match.ts`):

- **Coverage, not symmetric similarity.** The question is "does this resume already say what
  this posting screens for", not "are these two documents alike". A resume that covers
  everything the posting asks for is a reuse candidate even if it is much longer.
- **Craft terms are canonicalised.** `photographer`/`photography`/`photographs` → `photo`;
  `videographer`/`video`/`cinematography` → `video`; `editor`/`editing` → `edit`; `disc jockey`
  → `dj`. Without this the most important overlap was invisible and a video resume scored 0
  against a video job. A short domain-aware list, not a general stemmer — predictable, and it
  cannot turn "company" into "compan".
- **Short signal terms survive the length filter.** The 3-character minimum was silently
  discarding `dj` — a core term for this searcher. An allowlist (`dj`, `av`, `mc`, `ai`, …)
  now protects them. `it` is deliberately excluded: far more common as a pronoun.
- **The description is supporting evidence, never part of the denominator.** Coverage is a
  ratio, and a 2,000-character description would add ~150 weight-1 tokens and swamp the title
  and keywords — a same-vertical job would stop looking like a match. Description overlap adds
  a capped bonus instead.
- **Keywords outrank title words.** ATS keywords weigh 3, title 2, so generic title words like
  "specialist" cannot outvote the craft terms the posting actually screens on.
- **Thresholds: ≥65 reuse, 35–64 adapt, <35 tailor.** Chosen so a same-vertical job reuses, an
  adjacent one (real-estate media vs wedding video) adapts, and an unrelated one tailors.
- **The master resume is a candidate, penalised by 2 points** so an equally-matching tailored
  resume wins. It is matchable without any metadata because the fingerprint comes from the
  resume's own content — including legacy markdown, which previously parsed to an empty
  fingerprint and was therefore permanently unmatchable.

**Rejected.** Symmetric text similarity (Jaccard over all tokens) — too sensitive to length
and to domain words, and it scored adjacent-but-relevant pairs as poorly as unrelated ones.
Also rejected: requiring hand-entered tags per resume before matching could work at all; the
fingerprint is derived from content so the master works immediately.

**A bug that would have made the whole feature useless.** Description tokens were marked
supplementary unconditionally — but every real posting repeats its own title in the body, so
the title words were classified as supplementary, the coverage denominator excluded them, and
the core signal collapsed to nothing. Every job reported "too little text to match on" despite
having a 2,000-character description. Description tokens are now supplementary **only if they
are not already core terms**, with a regression test.

**Status.** Built: schema, queries, API, the Resumes tab, the recommendation on the job page,
and the reuse action. Verified by `verify-resume-match.ts` (50 checks),
`verify-arsenal.ts` (24 checks against the real database, self-cleaning), and a render check
of the Resumes tab in Brave.

---

## 2026-10-30 — A verification harness must never mutate real data

**Decision.** `verify-pipeline.ts` snapshots the existing master resume before overwriting it,
restores that snapshot at the end, and asserts the restore byte-for-byte as a stage.

**Why.** It needed a master resume for its resume stages, and the only row `/api/ai/tailor`
reads is `type='master'`. It finished by calling `PUT /api/settings {masterResume: ""}` as
"cleanup" — the same row the real resume lives in — so **every run silently destroyed the
user's master resume** while reporting "placeholder resume removed ✓". It was caught only by
noticing the row held 0 chars where it had held 22,967 minutes earlier.

**Rejected.** Leaving the placeholder in place (it would masquerade as the real resume), and
"just don't clear it" (that leaves the placeholder). The assertion is the important part: a
silent regression is now a failing test.

---

## 2026-10-30 — No XP, no levels, no streaks

**Decision.** Momentum comes from **next steps you tick off** plus **per-listing pipeline
progress**. No points, badges, streaks or levels.

**Why.** Gamifying application *volume* trains you to spam listings — the exact opposite of
what this app is for. A design mockup explored XP/levels/streaks/quests; it was rejected and
is banner-annotated as superseded in `docs/mockups/`.

**Consequences.** Next steps are derived from status, one open step per job, proposed
automatically; completing an "Apply" step also advances the job to `applied` and dates it.

---

## 2026-10-30 — Progress is reconstructed from an event log, not from current status

**Decision.** Every status transition is appended to `job_stage_events`, written **inside
`updateJob`** rather than in the API route.

**Why.** `jobs.status` holds only the current value, so it cannot answer "how far did I get":
a rejection after an onsite and a rejection the day after applying are the same string.
Putting the write in `updateJob` means every path that changes a status — the UI, an import,
any future automation — produces the same history. A status change that silently skipped the
log would make the metrics quietly wrong, which is the whole point of having them.

**Consequences.** Conversion rates are computed over **applied** jobs only: a saved listing
you never applied to cannot fail to respond, so counting it would just dilute the numbers.
A rejected listing keeps its high-water mark and is credited with having reached it.

---

## 2026-10-28 — Measure relevance, not just yield, before recommending a keyword

**Decision.** Score a search term by how many of its returned titles are actually this work.

**Why.** Yield alone gave bad advice. `merchandiser` returns **87 listings and 0** relevant;
`warehouse` 100/4; `live stream` 85/3; `event production` 100/9 (it matches manufacturing
"production"). Meanwhile the terms that sound most like the job return the least — `event
technician` 1 listing, `stagehand` 1, `audio visual technician` 5 — and the work hides under
generic stems: `video production` returned 14 listings and **all 14** were on-target.

**Consequences.** Presets rebuilt around measured relevance. The classifier counts "production"
and "media", so it scores a manufacturing "Production Lead" as on-target — read the titles of
anything you intend to recommend, don't trust the counter alone.

---

## 2026-10-27 — The app binds to the Tailscale address, not 0.0.0.0

**Decision.** The LaunchAgent binds to this machine's tailnet IP; the macOS firewall stays the
LAN's problem. Consequence: `localhost:3002` does not answer on the mini.

**Why.** The firewall is off, so `0.0.0.0` would put an app with no authentication on 25 of 27
routes in front of every device on the local network. The tailnet is the access-control layer.

**Also learned, the hard way.** A launchd job cannot read the external SSD through `/bin/bash`
— TCC refuses a removable volume to a "platform binary" and will not even prompt, so the job
dies at spawn with `Operation not permitted`. Exec'ing **node directly** is what works.
`StandardOutPath` must not be on the external volume either (the job dies at setup with
`EX_CONFIG 78` and produces no output at all). And the Tailscale CLI is unusable from a launchd
agent: it prints "The Tailscale GUI failed to start" *to stdout*, which taken at face value
becomes a hostname and makes `next start` die with `ENOTFOUND`.

---

## 2026-10-27 — Search broad, rank narrow; send `distance` explicitly

**Decision.** Search short stems and let the ranking layer narrow. `distance` is an explicit,
validated control, and every run records it.

**Why.** Measured on Indeed for Indianapolis: `photographer` 3 unique listings vs `photo` 53;
50mi → 100mi is +70%; a 7-day → 30-day window roughly doubles it; the result cap of 25 was
binding. Together: **3 unique listings → 225**. `distance` had never been sent by the app at
all — jobspy's default of 50 miles was silently always in force. And Indeed ANDs the words in a
phrase, so `wedding photographer` returns 0 where `photo` returns hundreds.

---

## 2026-10-27 — Profile-driven ranking; aggregation in code

**Decision.** All weights, interests and rules live in an editable Target Profile, and the
weighted total is computed in code — the model returns per-axis 0–10 scores only.

**Why.** The persona and weights were hardcoded in the prompt, so the search could not be
widened without editing source. Keeping the arithmetic in code makes the 0–100 scale auditable
and the weights normalised (they need not sum to 1).

**Consequences.** The hours rule accepts a role clearing **either** `minWeeklyHours` (20) or
`minWeeklyEarnings` ($600/wk) — a short week at a high rate is accepted, not fined. Unknown
hours are flagged, never fined: absence of information in a posting is not evidence of a bad
role, and a flat penalty for "schedule not stated" used to bury most of the market.
