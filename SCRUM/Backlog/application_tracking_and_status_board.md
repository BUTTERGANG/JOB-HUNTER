---
status: backlog
priority: P2
agent_claimed: null
claimed_at: null
updated: 2026-08-20
---

# Application Tracking and Status Board

> **Repo:** JOB-HUNTER
> **Description:** Kanban board for applied/interviewing/offer/rejected stages

---

## Context

Users need to track their application pipeline -- which jobs they've applied to, interview stages, offers, and rejections.

---

## Acceptance Criteria

- [ ] Kanban board with drag-to-move between columns
- [ ] Application form with notes, resume version, and contact tracking
- [ ] Calendar view for interview scheduling and follow-up reminders
- [ ] Stats dashboard: application rate, interview conversion, offer rate

---

## Technical Notes

- React DnD for kanban; SQLite/NeonDB for persistence; calendar picker component
