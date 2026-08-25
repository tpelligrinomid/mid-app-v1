# Q1 2026 Management Task Analysis

**Period:** January 1 — March 31, 2026
**Scope:** Parent-level Deliverables only (same 930-task set as the main Q1 analysis)
**Method:** Task-name pattern match against the classified deliverables CSV.

## Headline

**~42% of Q1 deliverables are management-shaped work**, accounting for ~35% of total points.

| Metric | Management | Total | % |
| :---- | :---- | :---- | :---- |
| Tasks | 389 | 930 | **41.8%** |
| Points | 3,021 | 8,596 | **35.1%** |

The lower share of points vs. tasks reflects that management items are lighter-weight than production work.

---

## Breakdown by Management Type

| Bucket | Tasks | Points | Avg Points/Task |
| :---- | :---- | :---- | :---- |
| "Manage X" (manage web, paid media, ABM, SEO, content, social, performance reporting, etc.) | 173 | 1,170 | 6.8 |
| Meetings (Facilitate Client Meetings, bi-weekly, Meeting: …) | 97 | 785 | 8.1 |
| Tech stack (recurring ops) | 90 | 1,034 | 11.5 |
| Kickoff / alignment meetings (Conduct …) | 13 | 0 | 0.0 |
| Website hosting (recurring) | 6 | 12 | 2.0 |
| Update Website (recurring) | 5 | 0 | 0.0 |
| Client onboarding | 3 | 20 | 6.7 |
| Support request windows | 2 | 0 | 0.0 |
| **Total** | **389** | **3,021** | **7.8** |

---

## Key Observations

- **"Manage X" is the biggest single bucket** — 173 tasks, 1,170 points. These recurring monthly retainer-style items dominate several categories:
  - Paid Media: 42 of 74 tasks are "Manage paid media"
  - ABM: 25 of 71 tasks are "Manage ABM"
  - Performance/Reporting: 24 of 37 tasks are "Manage performance reporting"
  - SEO/AEO: 11 of 54 tasks are "Manage SEO"
- **Meetings account for 110 tasks combined** (97 client meetings + 13 kickoff/alignment) but only 785 points total — lots of small recurring commitments rather than a few heavyweight items.
- **Tech stack tasks carry real point weight** (1,034 points, avg 11.5/task) — higher than most management buckets, suggesting these aren't just light check-ins.
- **Many management items have zero assigned points** (kickoff/alignment meetings, support windows, Update Website) — these are effectively non-deliverable-shaped work masquerading as deliverables, and they inflate the task count without contributing revenue.

---

## Classification Rules

A task was counted as "management" if its name matched any of these patterns (case-insensitive where noted):

- Starts with `Manage …` (or `[Prefix] Manage …`)
- Starts with `Tech stack …`
- Starts with `Facilitate …` or `Meeting: …`
- Starts with `Conduct …` (kickoff/alignment meetings)
- Starts with `Support Request Window`
- Starts with `Website Hosting`
- Starts with `Update Website`
- Starts with `Client Onboarding` or `Post-AGE Client Onboarding`

---

## Notes

- Point totals sum to 8,596 in the source CSV (71 of the 930 rows have null points). The main Q1 analysis cites 9,200.5 points, which likely reflects a different counting pass (e.g. including estimated points on null rows). Percentages in this file are computed against the 8,596 base for internal consistency.
