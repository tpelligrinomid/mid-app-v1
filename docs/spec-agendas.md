# Agendas — plan (draft for review with Colin)

Status: **planning, not built.** Drafted 2026-10-18 for a walkthrough with Colin (head of client ops) before any build.

## The idea

Three objects, three tenses:

| Nav item | Tense | What it is |
|---|---|---|
| **Notes** | Past | What we've done (strategy notes, weekly notes, meeting notes) |
| **Agendas** *(new)* | Future | What we'll cover in the next meeting |
| **Meetings** | Present → past | What actually got discussed (recording, transcript, sentiment) |

An agenda is a **new artifact**, not a note: each one is kept, so over time there's a record of every meeting we prepared for a client — what we said we'd delivered, what we asked of them, what we flagged.

Left nav (Management): Notes → **Agendas** → Meetings → Deliverables → Status Reports → Paid Media.

## Decisions so far

- **On demand only** to start. No scheduling, no calendar integration.
- **Write it like a doc, present it like slides.** One markdown document with rich blocks (task lists, metrics, charts, timelines, asks); `---` splits it into slides for Present mode. See *Format* below.
- **Strategists refine it by chatting** with it in Ask Compass before it goes to the client — including adding charts from Databox / Nightwatch data or numbers they paste (preview → confirm → new version).
- **Delivered locks it** (same rule as deliverables). Changing it after that means setting it back to Working.
- **Internal notes: later.** Not needed for v1.

## What an agenda contains (default structure)

Built from data we already sync (ClickUp every 15 min, Compass meetings/notes/deliverables, Databox, Nightwatch). Each section is one slide in Present mode:

| Section | Source | Notes |
|---|---|---|
| **Cover** | Contract, meeting date, attendees (from the last meeting) | "Weekly check-in · Oct 23" |
| **Since we last met** | Tasks with `date_done` since the **previous client meeting** (from Meetings), not a fixed 7 days; deliverables delivered in that window | Wins first |
| **Needs your input** | ClickUp status `waiting on client` (75 open across clients today) + Compass deliverables in *Waiting on client* | The section that matters most — clear asks with due dates |
| **In progress** | Tasks with status `working`: owner, due date | Grouped by channel/service category |
| **Overdue / outstanding** | ToDos past due, not delivered | Optional per client |
| **Results** | Databox (traffic, conversions, spend), Nightwatch (rank movers) | Metric cards + a chart |
| **Coming up** | Due in the next 14 days | Timeline |
| **Points** | Balance, burn vs allotment | Sensitive for some accounts — included only when chosen |
| **Discussion topics** | AI-suggested: plan gaps, results, open questions from last call, sentiment | The only mostly-AI section |
| **Next steps** | Open action items from the last meeting notes + new asks | Becomes the checklist for next time |

**Facts come from data; Claude writes the framing.** Task lists, dates, owners and numbers are pulled directly (never invented); Claude writes headlines, summaries and suggested topics. Data in blocks is **frozen at generation**, so an archived agenda still shows what we presented even after ClickUp or Databox numbers change.

## Format: markdown with rich blocks

An agenda is one markdown document (`content_raw`). Two additions make it look like the mockup instead of a wall of text:

**1. Slide breaks.** `---` on its own line starts a new slide. The same source renders two ways:
- **Doc view** (default): a styled, scrolling document — good for reading, review and editing.
- **Present mode**: one section per slide, full screen, arrow keys. Text auto-scales; an overlong section scrolls or splits.

**2. Rich blocks** as fenced code (the way Mermaid diagrams work in markdown). Anything outside a block is ordinary markdown — strategists can type, paste tables, add images.

````markdown
## Since we last met
```tasks
- Blog: Marketing Agency vs. In-House | Colin | delivered | 2026-10-17 | newnorth.com/insights/…
- Tech Qualified: Praveen Das edit | Nina | delivered | 2026-10-20
```

---

## Needs your input
```asks
- Approve the revised Q4 content plan | Needed by Oct 28 | Built around Tech Qualified at 100 points/month
- GA4 admin access | Blocking reporting | Key events haven't recorded since ~Aug 22
```

---

## Results
```metrics
Organic sessions | 192 | -28% vs prior 30 days
Top-10 keywords | 4 / 47 | tracking since Oct 17
```

```chart
type: line
title: Organic sessions, last 90 days
source: databox · Google Analytics 4 · sessions (organic) · 2026-07-20..2026-10-18 · fetched 2026-10-18
unit: sessions
data:
  - [Jul 20, 61]
  - [Jul 27, 58]
  - …
```
````

Block types (v1): `tasks` (status chips, owner, due/done date, link), `asks` (callout cards), `metrics` (value + change), `chart`, `timeline`. Blocks are simple line formats so they're readable and editable as text — by people and by Ask Compass.

**Why not rigid slides:** strategists can add anything (a paragraph, a table, a screenshot, a chart) without fighting a slide template, and every edit is a text edit. **Why not plain markdown:** the blocks and typography are what make it feel like a deck rather than a doc.

Look: **Marketers in Demand styling for now**, built on the shared brand settings so agendas switch to the newnorth.com brand kit with the rest of the platform (see `docs/plan-newnorth-rebrand.md`). One accent color, generous type, status colors consistent with ClickUp. See `docs/agendas-mockup.html` for the visual direction (static mock, partly sample data — not client-ready).

## Charts from chat

Strategists ask for a chart in plain language; Ask Compass gets the data and inserts a `chart` block (preview → confirm, like any edit):

- **From Databox:** *"Add a chart of organic sessions for the last 90 days to Results."* → Compass calls its existing Databox tool, gets the weekly series, writes the block with the numbers and where they came from.
- **From Nightwatch:** *"Chart our top 5 keywords' rankings since tracking started."* → ranking history from the existing Nightwatch tools (lower = better, axis inverted).
- **From pasted or attached data:** *"Here's our LinkedIn spend by month: Jul 3,200, Aug 3,800, Sep 4,100 — bar chart."* or a CSV attached in chat (text attachments already work).
- **Edits:** *"Make it a bar chart," "compare to the same period last year," "drop September."*

Chart block details:
- **Types:** line, bar (incl. grouped/stacked), area, donut, plus a single big-number "sparkline" card. Rendered with Recharts (already in the app) in MiD colors.
- **Data is stored in the block** (labels + values, series names, unit), so the chart is frozen with the agenda and renders without calling Databox again.
- **`source` line** records provider, metric, range and fetch date — shown as a caption ("Source: Google Analytics 4 via Databox, Jul 20–Oct 18") and used for *"refresh this chart"* while the agenda is still a draft.
- **Guardrails:** Compass only charts numbers it fetched or was given (no invented data); keeps currencies/units separate; caps points per chart for readability.
- Images (a screenshot of a dashboard) work as plain markdown images for anything we can't chart.

The same chart block can later appear in deliverables and content plans — it's a markdown feature, not an agenda feature.

## Lifecycle

1. **Create** — Agendas → "New agenda" (pick meeting date and type) or Ask Compass: *"Build the agenda for Thursday's New North call."* Status **Draft**, version 1.0.
2. **Refine** — open it with Ask Compass attached: *"Drop the points section," "Add a chart of LinkedIn spend by month," "Make the asks more direct," "Move the case study to Coming up."* Strategists can also edit the markdown directly. Preview → confirm → 1.1, 1.2…
3. **Deliver** — set **Delivered**: locked, share link enabled, it's what the client saw.
4. **After the meeting (phase 2)** — when the recording lands in Meetings, link it to the agenda by date. Compass can then show **planned vs discussed** and carry anything not covered (and new action items) into the next agenda.

## Data model (sketch)

New table `compass_agendas`:

- `agenda_id`, `contract_id`, `title`, `meeting_date`, `meeting_type` (weekly check-in, monthly review, QBR — templates later)
- `status` (draft / working / delivered), `version`, `delivered_at`
- `content_raw` — the markdown with slide breaks and blocks
- `data_snapshot` — the raw tasks/metrics used at generation (for audit and "refresh")
- `period_start` (previous meeting date) / `period_end`
- `meeting_id` — the meeting it was for, once recorded (phase 2)
- `share_id`, `created_by`, timestamps, `metadata` (generation request, revision links)
- Versions: `compass_agenda_versions` (same pattern as deliverable versions, full content per version)

Plus: RLS like deliverables; MCP tools later (`list_agendas`, `get_agenda`); delivered agendas embedded in the knowledge base as `agenda` so Compass can answer "what did we ask New North for last month?".

## Phases

| Phase | Scope |
|---|---|
| **1 — MVP** | Agendas nav + list; on-demand generation (button + Ask Compass); markdown renderer with `tasks` / `asks` / `metrics` / `timeline` / `chart` blocks; doc view + Present mode; chat edits incl. charts from Databox, Nightwatch and pasted data; versions; Delivered lock; share link; Ask Compass task tool (ClickUp tasks in chat) |
| **2** | Link to the recorded meeting; planned-vs-discussed + carry-over; PDF export; client portal view; chart blocks available in deliverables |
| **3** | Meeting-type templates; internal speaker notes; scheduling (day before the meeting); Google Slides export |

## Questions for Colin

1. **Meeting types:** are weekly check-ins and monthly/quarterly reviews different enough to need different default sections in v1, or one default?
2. **Default sections:** which go to clients by default? Overdue and points feel case-by-case.
3. **Points:** show the client their balance? (Deficit accounts make this sensitive.)
4. **Who builds it:** strategist or account manager? Who sets Delivered?
5. **ClickUp hygiene:** agendas are only as good as statuses and due dates. Is "waiting on client" used consistently? Are due dates and owners set on most working tasks?
6. **Sharing:** link before the call, screen-share during, PDF after — which matters most?
7. **Charts:** which 3–5 charts would strategists reach for most (sessions, leads, spend, rankings, points burn)? Those become one-line requests.
8. **"Since last meeting":** anchor on the last recorded client meeting (proposed) or a fixed window?

## Related

- Existing: Weekly Strategy Notes (`backend/src/services/strategy-notes/`) and Client Status Reports (`backend/src/services/reports/client-status-report.ts`) already gather points, in-progress, completed and waiting-on-client tasks — the agenda generator reuses that gathering.
- Ask Compass deliverable editing (`backend/src/services/deliverables/chat-tools.ts`): text find/replace edits, versioning, the Delivered lock and the editor-conflict guard carry over unchanged.
- Data tools Ask Compass already has: Databox (`list_marketing_sources`, `list_source_metrics`, `get_marketing_metric`), Nightwatch (`get_seo_rankings`, `get_seo_ranking_history`, `get_seo_movers`).
- Task data: `pulse_tasks` (`list_type` Deliverables / ToDos / Goals; `status_raw` planned / working / waiting on client / delivered).
