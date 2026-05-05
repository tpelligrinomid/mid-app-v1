# Task Analysis Report — Runbook

Ad-hoc endpoint that pulls every delivered task across active client contracts in a rolling window, AI-classifies each one into 13 work categories, and returns a zip with task-level + contract-level CSVs plus a run summary. Designed for one-off portfolio analysis, not a recurring scheduled job.

**Endpoint:** `POST /api/admin/task-analysis-report`
**Auth:** `CRON_SECRET` (header or query param)
**Typical runtime:** ~4 min for ~6,000 tasks
**Approximate Claude cost per run:** ~$1.40 for 6,000 tasks (Haiku 4.5 with prompt caching)

---

## When to use this

- Quarterly portfolio reviews (what kinds of work did we actually deliver?)
- Pre-leadership-meeting prep (Tier 1 vs Tier 2 work breakdown, top contributors per category)
- Sanity-checking the agency's positioning vs reality
- Ad-hoc analysis where you want to feed the data to Claude.ai for further slicing

This is **not** wired into Pulse. There is no UI button. Run it from the command line when you need a fresh snapshot.

---

## What gets included / excluded

**Contracts:** active, non-hosting, non-internal (`engagement_type != 'internal'`).
**Tasks:** status = `delivered`, with a `date_done` inside the window.
**Window:** controlled by the `?days=N` query param (default 90, max 365).

The summary.json file in the zip reports how many contracts were excluded as internal.

---

## Running via curl (recommended)

The cleanest way to invoke this is from PowerShell on your Windows machine. No local backend needed — it hits production directly.

```powershell
curl.exe -X POST "https://mid-app-v1.onrender.com/api/admin/task-analysis-report?days=90" `
  -H "Authorization: Bearer YOUR_CRON_SECRET" `
  -o task-analysis.zip
```

Notes:
- **`curl.exe` matters** in PowerShell — bare `curl` is an alias for `Invoke-WebRequest` and behaves differently.
- Replace `YOUR_CRON_SECRET` with the actual value (find it in Render's environment variables for the `mid-app-v1` service).
- Adjust `?days=90` if you want a different window (e.g. `?days=30` for the last month, `?days=180` for half a year).
- The terminal will sit silent for ~4 minutes — that's normal. Don't kill it.
- When it finishes, you'll have `task-analysis.zip` in the directory you ran the command from.

---

## Running via Postman (alternative)

1. New request, method = `POST`
2. URL: `https://mid-app-v1.onrender.com/api/admin/task-analysis-report?days=90`
3. **Authorization tab** → Type = `Bearer Token` → paste `CRON_SECRET` (no "Bearer " prefix; Postman adds it)
4. **CRITICAL:** switch from "Cloud Agent" to "Desktop Agent" at the bottom of Postman. The cloud agent has a 30-second timeout and will fail this request.
5. Click the dropdown arrow next to **Send** → **Send and Download** to save the zip to disk.

If you don't have Postman Desktop installed, just use curl instead — easier.

---

## What you get back

A zip with three files:

| File | Shape | What it's for |
|---|---|---|
| `tasks.csv` | One row per delivered task | Filtering, slicing, deep dives. Columns: task_id, clickup_task_id, contract_name, contract_external_id, priority, account_manager, team_manager, category, confidence, list_type, task_name, task_description, points, date_done. |
| `rollup.csv` | One row per contract + a portfolio total row | Visualization at the portfolio level. Columns: contract_name, priority, total_tasks, total_points, then 26 columns covering tasks and points for each of the 13 categories. |
| `summary.json` | Run metadata | Window, contract counts, task counts, Claude usage (incl. cache hits), elapsed ms. Useful for sanity-checking. |

The 14 categories are: Web Development, Tech Stack, Marketing Ops, Account Management, Content Creation, Podcast, Design/Creative, Paid Media, ABM, SEO/AEO, Performance/Reporting, Strategy/Research, Video, Other.

**Note on `Tech Stack` vs `Marketing Ops`:** `Tech Stack` is reserved for tasks literally named "Tech Stack" — these are cost-tracking placeholder tasks representing platform subscription costs, not service work. They're pre-classified by name without an AI call. All actual operational work (CRM admin, integrations, lead routing, process documentation, lifecycle definition) goes under `Marketing Ops`.

---

## Visualizing the data with Claude.ai

Drop `tasks.csv` and `rollup.csv` into Claude.ai (web), use Opus 4.7, and paste the prompt below. Claude will use code execution (pandas + plotly) to process the data and render an interactive HTML artifact.

### Main prompt — produces the dashboard artifact

```
Attached: tasks.csv (one row per delivered task, ~2,000+ rows after
filtering to parent tasks only) and rollup.csv (one row per contract
with task counts and points totals for each category, plus a
PORTFOLIO TOTAL row at the bottom).

Context: I'm the head of a marketing agency. These are all tasks
my agency has delivered for active client contracts in the last 90
days. Each task is classified into one of 14 categories: Web
Development, Tech Stack, Marketing Ops, Account Management, Content
Creation, Podcast, Design/Creative, Paid Media, ABM, SEO/AEO,
Performance/Reporting, Strategy/Research, Video, Other.

Important field definitions:
- "points" is our internal effort/sprint-points estimate per task.
  Higher points = heavier work.
- "monthly_points_allotment" is the contracted monthly point budget
  we sold to the client. Multiply by ~3 to get the expected 90-day
  allotment.
- "amount" is the contract's monthly recurring revenue (USD). Use
  this for revenue-efficiency analysis.
- "priority" is our internal account tier (Tier 1 / Tier 2 / etc.).
- "engagement_type" is "strategic" or "tactical" — strategic
  engagements are higher-touch / longer-horizon.
- "contract_type" describes the contract structure (retainer,
  project, etc.).
- "Tech Stack" tasks are cost-tracking placeholders representing
  platform subscription costs, NOT service work. Surface these
  separately and EXCLUDE them from any "labor delivered" or
  "service mix" calculations. Include them only in cost-context
  views.

I want a single interactive HTML artifact I can share with my
leadership team that tells the story of what we actually produced
this quarter and how it lines up with what we sold. Use code
execution (pandas + plotly or similar) to process both CSVs, then
render the artifact.

Required sections:

1. **Executive summary at the top** — KPI tiles for: total contracts,
   total tasks (excluding Tech Stack), total service points
   delivered (excluding Tech Stack), portfolio MRR (sum of unique
   contract amounts), portfolio monthly allotment (sum of unique
   monthly_points_allotment), top service category by points, and
   "delivery vs allotment" ratio (90-day points delivered ÷ 3 ×
   monthly_points_allotment summed across the portfolio). Then 3-5
   bullet headlines about what stands out.

2. **Portfolio composition (service work only)** — two side-by-side
   charts, both EXCLUDING Tech Stack:
   (a) tasks per category, sorted descending
   (b) points per category, sorted descending
   Make it easy to see where volume and effort diverge.

3. **Effort intensity by category** — average points per task for
   each service category (exclude Tech Stack). Flag categories
   where avg points is notably high or low compared to portfolio
   average.

4. **Capacity utilization per contract** — for each contract,
   compute: expected_90d_points = monthly_points_allotment × 3,
   delivered_service_points = total_points minus Tech Stack points,
   utilization = delivered_service_points / expected_90d_points.
   Render as a horizontal bar chart sorted by utilization,
   color-coded: green if 80-110% (on track), red if >110%
   (over-delivering = revenue leak), amber if <80% (under-delivering
   = client risk). Annotate the highest over- and under-utilizers.

5. **Revenue efficiency** — points-per-dollar by contract. For each
   contract: efficiency = delivered_service_points / amount. Plot
   as scatter with amount (MRR) on x-axis, delivered service points
   on y-axis. Diagonal lines mark efficiency bands (e.g. 0.5 / 1.0
   / 2.0 points per dollar). Label outliers — high-effort/low-revenue
   contracts and the inverse.

6. **Tier × engagement type breakdown** — small grid of charts:
   for each combination of priority tier (Tier 1/2/3/4) AND
   engagement_type (strategic/tactical), show portfolio composition
   (% of points by category, Tech Stack excluded). Helps me see
   whether Tier 1 strategics are actually getting different work
   than Tier 3 tacticals.

7. **Contracts × categories heatmap** — rows = top ~25 contracts by
   service points delivered (Tech Stack excluded), columns = the 13
   service categories, cell intensity = points delivered. Note
   total contract count in a caption.

8. **Top 3 contracts per category** — small multiples showing the
   contracts contributing the most points in each service category.

9. **Tech Stack costs (separate section)** — bar chart of Tech
   Stack point totals per contract (only contracts that have one).
   Caption explaining these are cost line items, not delivered
   labor. Total Tech Stack points across the portfolio as a single
   KPI.

10. **Written analysis section** — 5-7 paragraphs of plain-English
    insights answering:
    - Where are we over-delivering vs allotment, and is that
      concentrated in any tier or engagement type?
    - Where are we under-delivering, and which of those are revenue
      risks (high MRR, low utilization)?
    - Which contracts are revenue-efficient (high effort relative
      to MRR) vs revenue-inefficient (low effort relative to MRR)?
    - Does our service mix actually match our positioning? (e.g.
      if we sell ourselves as a content agency but Marketing Ops
      is the biggest category, that's worth flagging)
    - Are strategic engagements meaningfully different from tactical
      ones in their work mix, or are we delivering the same thing
      under both labels?
    - One or two questions this data raises that we should
      investigate next quarter.

Design requirements:
- Modern, minimal aesthetic. Pick a cohesive color palette.
- Responsive layout that works in a browser at typical desktop
  widths.
- Section headers, clean typography, good use of whitespace.
- All charts should have clear labels, legends, and tooltips.
- For utilization and efficiency charts, use diverging color scales
  (e.g. red-amber-green) so over/under is visually obvious.
- No "AI slop" defaults — avoid generic purple-on-white gradients,
  Inter/Roboto, or stock dashboard templates.

Output the artifact as a single self-contained HTML file I can open
locally or share with my team.
```

### Follow-up prompts for deeper dives

Use after the main artifact, depending on what stands out.

**Spot-check a category for a specific contract:**
```
Pull every task in the [CATEGORY] category for [CONTRACT NAME].
Show me the task names and points so I can sanity-check the
classification.
```

**Find effort outliers:**
```
Show me the 20 highest-point individual tasks in the dataset, with
their contract, category, and date_done. Are these legitimately our
heaviest work, or are there outliers (e.g. a 100-point task that
should've been broken up)?
```

**Compare similar contracts:**
```
Build a matched-pair comparison: pick 2-3 contracts in the same
tier with similar total task counts but very different category
mixes. What does that tell us about how we serve different clients
within the same tier?
```

**Stress-test the taxonomy:**
```
If you were going to retitle our 14 categories based on what's
actually in each one, what would you call them? Show the proposed
new name + a 1-line rationale per category.
```

**Identify at-risk accounts:**
```
List the top 10 contracts at delivery risk: high MRR (top quartile
of amount) but low capacity utilization (delivered_service_points
< 0.7 × monthly_points_allotment × 3, where service points exclude
Tech Stack). For each, show MRR, allotment, delivered points,
utilization %, and the top 2 categories of work being done.
```

**Find revenue leaks:**
```
Which contracts are we significantly over-delivering on (delivered
service points > 1.2 × expected 90-day allotment)? Show MRR,
allotment, delivered, over-delivery %, and what categories are
absorbing the extra effort. Are any of these consistent patterns
worth raising in client conversations?
```

**Strategic vs tactical reality check:**
```
Compare strategic vs tactical engagements head-to-head: average
points delivered per contract, average MRR, points-per-dollar
efficiency, and category mix. Are strategic engagements actually
delivering more strategic-type work (Strategy/Research, ABM,
Performance/Reporting) than tactical ones, or is the engagement
type label decoupled from the actual work?
```

### Tips for working with Claude.ai on this

- If the first artifact pass misses visually, give specific feedback rather than generic ("more like a Stripe dashboard, less like a default Tableau report"). Vague "make it cleaner" pushes the model to a different generic template instead of producing variety.
- For category-specific drill-ins, ask Claude to filter `tasks.csv` by category — that's faster than re-running the report with a smaller window.
- The `confidence` column in `tasks.csv` tells you how sure the classifier was. If you're skeptical of a category total, filter to that category sorted by confidence ascending and eyeball the low-confidence rows.

---

## Operational notes and caveats

- **Render timeout ceiling:** the endpoint must finish in under ~5 minutes wall-clock. Today this isn't an issue (parallelized run on 6,000 tasks finishes in ~4 min). If task volume grows past ~10,000, we'll need to convert this to an async job (return a job ID, classify in background, second endpoint downloads when ready).
- **Don't fire two runs in parallel.** Each run costs ~$1.40 in Claude calls. If a request times out in your client (Postman cloud agent, etc.), the request *keeps running on Render*. Wait for it to finish or check the Render logs before retrying.
- **The deploy gotcha:** if you push code to `main` while a run is in flight, Render's drain timeout will kill the in-flight run with a 502. Either wait for the run to finish before deploying, or just retrigger after the deploy lands.
- **Classifications are not persisted.** Every run re-classifies from scratch. This is intentional — if the taxonomy changes or we add categories, you don't want stale labels. The trade-off is cost (~$1.40/run instead of ~free), which is fine at this volume. If we ever wire up a proper ClickUp custom field for category, this endpoint becomes a thin wrapper that reads the field instead of calling Claude.
- **Internal contracts excluded:** filtered client-side on `engagement_type != 'internal'`. Contracts with null `engagement_type` are kept (treated as not-internal). Hosting contracts (`hosting = true`) are also excluded.

---

## Code locations

- **Endpoint handler:** `backend/src/routes/admin/task-analysis-report.ts`
- **Mounted in:** `backend/src/index.ts` under `/api/admin`
- **Claude wrapper:** `backend/src/services/claude/client.ts` (`sendCachedRequest` function)
- **Auth pattern:** mirrors `backend/src/routes/cron.ts` `verifyCronSecret`
