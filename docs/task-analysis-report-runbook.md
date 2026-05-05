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

The 13 categories are: Web Development, Tech Stack/Ops, Account Management, Content Creation, Podcast, Design/Creative, Paid Media, ABM, SEO/AEO, Performance/Reporting, Strategy/Research, Video, Other.

---

## Visualizing the data with Claude.ai

Drop `tasks.csv` and `rollup.csv` into Claude.ai (web), use Opus 4.7, and paste the prompt below. Claude will use code execution (pandas + plotly) to process the data and render an interactive HTML artifact.

### Main prompt — produces the dashboard artifact

```
Attached: tasks.csv (one row per delivered task, ~6,000+ rows) and
rollup.csv (one row per contract with task counts and points totals
for each of 13 categories, plus a PORTFOLIO TOTAL row at the bottom).

Context: I'm the head of a marketing agency. These are all tasks
my agency has delivered for active client contracts in the last 90
days. Each task has been AI-classified into one of 13 work categories
(Web Development, Tech Stack/Ops, Account Management, Content
Creation, Podcast, Design/Creative, Paid Media, ABM, SEO/AEO,
Performance/Reporting, Strategy/Research, Video, Other). The "points"
field is our internal effort estimate for each task — higher points
means heavier work.

I want a single interactive HTML artifact I can share with my
leadership team that tells the story of what we actually produced
this quarter. Use code execution (pandas + plotly or similar) to
process both CSVs, then render the artifact.

Required sections:

1. **Executive summary at the top** — 4-6 KPI tiles: total tasks,
   total points, number of active contracts, average tasks per
   contract, top category by volume, top category by effort (points).
   Below the tiles, 3-5 bullet headlines about what stands out.

2. **Portfolio composition** — two side-by-side charts:
   (a) tasks per category, sorted descending
   (b) points per category, sorted descending
   Make it easy to see where volume and effort diverge (a category
   might have many small tasks or few heavy ones).

3. **Effort intensity by category** — average points per task for
   each category, sorted. Flag categories where avg points is
   notably high or low compared to portfolio average.

4. **Contracts × categories heatmap** — rows = contracts (sorted
   by total tasks desc), columns = the 13 categories, cell intensity
   = task count. Truncate to the top ~25 contracts by volume so it
   stays readable; note total contracts in a caption.

5. **Top 3 contracts per category** — small multiples (one mini
   bar chart per category) showing the contracts contributing the
   most tasks in that category. Helps me see who's driving each
   slice of work.

6. **Contract concentration analysis** — for each contract,
   calculate how concentrated its work is across categories (e.g.
   Herfindahl index or just "% of tasks in top category"). Plot
   contracts on two axes: total tasks (x) vs concentration (y).
   Highlight contracts that are unusually concentrated or diversified.

7. **Tier comparison** (the rollup has a "priority" column with
   Tier 1 / Tier 2 / etc.) — show portfolio composition (% of tasks
   by category) split by tier. Are Tier 1 contracts getting different
   work than Tier 2/3?

8. **Written analysis section** — 4-6 paragraphs of plain-English
   insights answering:
   - What kind of agency are we, based on what we actually deliver?
     (vs what we say we do)
   - Where are we spending the most effort and is that aligned with
     where the highest-tier accounts are?
   - Any categories that are surprisingly large or small?
   - Which contracts are outliers (very high volume, very concentrated,
     or unusual category mix)?
   - One or two questions this data raises that we should investigate.

Design requirements:
- Modern, minimal aesthetic. Pick a cohesive color palette.
- Responsive layout that works in a browser at typical desktop widths.
- Section headers, clean typography, good use of whitespace.
- All charts should have clear labels, legends, and tooltips.
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
If you were going to retitle our 13 categories based on what's
actually in each one, what would you call them? Show the proposed
new name + a 1-line rationale per category.
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
