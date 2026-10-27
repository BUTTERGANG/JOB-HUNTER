---
status: backlog
priority: P2
agent_claimed: null
claimed_at: null
updated: 2026-10-27
---

# Application Tracking and Status Board

> **Repo:** JOB-HUNTER
> **Description:** Kanban board for applied/interviewing/offer/rejected stages

---

## Context

**Partially built already.** The `jobs` table tracks a pipeline today with nine statuses
(`saved`, `applied`, `phone_screen`, `technical`, `onsite`, `offer`, `rejected`, `ghosted`,
`withdrew`), tiers A/B/C, recruiter name/email, notes, `date_applied` and `follow_up_date`,
surfaced in `/jobs` (sortable table, status + tier filters, inline status edit), `/jobs/[id]`
(detail, tailored resume, listing recheck) and `/jobs/compare`. The dashboard already counts
active interviews, offers and follow-ups due. Storage is SQLite, not NeonDB.

What does **not** exist: a drag-and-drop board, a calendar view, and conversion stats.

## Acceptance Criteria

- [ ] Kanban board with drag-to-move between the existing statuses
- [ ] Calendar view for interview scheduling and follow-up reminders
- [ ] Stats: application rate, interview conversion, offer rate
- [ ] Application form capturing resume version used (the `resumes` table already stores one
      tailored resume per job — link the applied version explicitly)

## Technical Notes

- Reuse the existing status vocabulary in `src/lib/constants.ts` (`JOB_STATUSES`); do not add a
  second parallel set.
- Note the separate manual 0–25 scoring model (`score_role`…`score_total`, `SCORE_DIMENSIONS`)
  used by `/jobs/new`, `/jobs/compare` and `/jobs/[id]` — it is distinct from the AI
  `rank_score` in `job_analysis` and the UI shows both.
