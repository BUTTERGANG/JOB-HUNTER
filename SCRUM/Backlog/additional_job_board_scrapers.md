---
status: backlog
priority: P2
agent_claimed: null
claimed_at: null
updated: 2026-08-20
---

# Additional Job Board Scrapers

> **Repo:** JOB-HUNTER
> **Description:** Add Indeed, LinkedIn, Glassdoor scrapers beyond current sources

---

## Context

Currently scraping a limited set of boards. Need broader coverage for better job discovery.

---

## Acceptance Criteria

- [ ] Indeed scraper with location and keyword filters
- [ ] LinkedIn scraper with pagination and login session management
- [ ] Glassdoor scraper with company rating and salary data
- [ ] Unified job schema with source tracking and dedup across boards

---

## Technical Notes

- Playwright for JS-heavy sites; proxy rotation for rate limits; NeonDB for storage
