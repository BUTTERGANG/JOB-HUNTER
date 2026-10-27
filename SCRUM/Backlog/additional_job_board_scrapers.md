---
status: backlog
priority: P1
agent_claimed: null
claimed_at: null
updated: 2026-10-27
---

# Sourcing for creative / live-event work (replaces the old "add more boards" card)

> **Repo:** JOB-HUNTER
> **Description:** Source photographer/videographer/DJ/event work from the channels that
> actually carry it — the generalist boards do not.

---

## Context

The original card asked for Indeed/LinkedIn/Glassdoor scrapers. **Those already exist** —
they ship via `python-jobspy` (`scripts/scrape_jobs.py`, sites: indeed, linkedin, glassdoor,
zip_recruiter, google), with per-site caps, proxy rotation, retry/backoff and cross-run
dedupe. Storage is SQLite, not NeonDB.

The real gap is channel fit, and it is now measured. Indeed for the Indianapolis market over
a 7-day window returns **5 unique listings** across photographer/videographer searches, and
**zero** for "wedding photographer", "wedding dj" and "event photographer". A ranking
improvement cannot fix an empty input set.

## Acceptance Criteria

- [ ] Verify yield per channel before building on it (count unique listings for the target terms)
- [ ] Vendor marketplaces (The Knot, WeddingWire, Zola): enumerate the market's *vendors*, then
      hit each vendor's own careers/contact page — reuse `wedding-vendor-scraper-workflow`
- [ ] Gig marketplaces (Thumbtack, GigSalad): per-event work is quoted, not posted
- [ ] Employer archetypes scraped directly: local photo/video studios, national wedding-video
      companies hiring contract shooters, DJ companies, venues with in-house AV, rental houses
- [ ] Capture the gig-work fields the W-2 schema drops: rate + unit, engagement type, own-gear
      required, weekend/evening load, portfolio/reel requirement, travel radius, seasonality
- [ ] Every new source writes through the same `scrape_results` path so ranking is unchanged

## Technical Notes

- Generalist boards stay wired as a secondary stream; they are not useless, just thin here.
- WorkForIndiana (`scripts/scrape_indiana.py`, Playwright) is a W-2 salaried channel — low
  priority for event work.
- Proxies/anti-block notes live in `docs/scraper-improvements.md`.
