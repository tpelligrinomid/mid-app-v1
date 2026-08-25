# Brief for Lovable — Program Roadmap (hours-based)

**This is a review request, not a build request.** Read it, tell me what's wrong, what's
missing, and what conflicts with what you've already built. Nothing gets built until the
backend, Master Marketer and you all agree.

Full spec: `docs/program-roadmap-spec.md`.

---

## What this is

A second kind of roadmap, priced in **hours** instead of points. It runs **alongside** the
existing points roadmap — it does not replace it.

- Existing clients stay on points. Their roadmaps, allotments and views do not change.
- New engagements use hours. Routing is by the existing `contracts.customer_display_type`:
  `'hours'` → new path, `'points'` and `'none'` → current path.
- No schema change on contracts. `customer_display_type` and `dollar_per_hour` already
  exist.

The point of the change: points froze both the rate ($100/pt) and the effort (whatever the
menu said). Hours let both flex per client — a heavier client gets a higher rate or more
hours on a task. "Your custom report took 16 hours" is something a client can verify;
"your custom report is 10 points" is not.

---

## Three things change in the UI

### 1. Generation input form — options

A roadmap is generated from **1–3 options**, each a complete priced scenario the client
chooses between. The strategist adds a row per option:

| Field | Notes |
|---|---|
| `tier` | Execute / Perform / Grow |
| `programs` | Authority, Reach, Pursuit — multi-select |
| `monthly_budget` | The **service** fee |
| technology | Multi-select from the Pulse tech stack catalog (`technologies` table) |

The blended hourly rate is **not** per option — it comes from `contracts.dollar_per_hour`
and is the same across all options.

Validation before submitting (backend enforces too, but the form should catch it):

- Tier must match the budget band: $4,000–5,900 Execute, $6,000–11,900 Perform, $12,000+ Grow
- Execute = 1 program, Perform = 2, Grow = 3
- Pursuit is never available at Execute, and never sold alone at any tier
- `dollar_per_hour` must be set on the contract
- Maximum 3 options

### 2. Viewer — shared sections vs per-option sections

Most of the roadmap describes the client and does not change with the investment. Only the
plan does.

| Section | Scope |
|---|---|
| Executive Summary | Shared, but ends with a recommendation naming an option |
| Overview, Target Market, Brand Story, Products & Solutions, Competition | **Shared** |
| Goals, Roadmap Phases, Quarterly Initiatives, Annual Plan, **Hours Plan** | **Per option** |

The option switch changes only the per-option sections. The shared ones stay put rather
than re-rendering, so someone toggling options is watching the plan change against a fixed
picture of their business — not feeling they changed document.

"Points Plan" becomes "Hours Plan" on this path.

**Options are alternatives, never phases.** Never show a summed total across options —
three options are not a $22,000 proposal.

`selected_option_id` may be set after the SOW is signed; when present the viewer collapses
to that option with a way back to the comparison. It is a label only and must not trigger
any write to the contract or its technology.

### 3. Editing — same as today, in hours

Your current editing UI is the right shape already — editable task, description, stage and
value per row, Add Task, Add Month, delete, in-memory tracking until save. Four changes:

- **Pts → Hrs**, one decimal place
- **Month header** shows `hours allocated / hours available`, not a bare total, so going
  over is visible while editing
- **Total band** shows hours available, hours allocated, variance, and the dollar value at
  the contract rate
- **Flags render inline** on the row or month they belong to

Each row carries `baseline_hours` (from the process library) as well as `hours`. Show the
baseline quietly beside the field so the strategist can see what standard was.

**When an edit pushes a month over capacity, let it go red — do not block the keystroke.**
The number they're reaching for is usually right; what needs to happen is a budget
conversation, not a rejected input.

---

## Technology

Every option shows three money figures: **services**, **technology**, **total**. Showing
the service fee alone makes a Pursuit option look cheaper than it is, because outbound
needs sending infrastructure that Authority doesn't.

Technology never consumes hours — `hours_available` derives from the service fee only.

Rules for the picker and the totals:

- Price from **`default_client_price`**, never `default_internal_cost`. They diverge —
  Factors.ai is $450 internal against $600 client price. Internal cost must never appear
  in anything client-facing.
- Include an item only when **`is_client_billable`** is true. Do not infer this from a
  blank price.
- **`is_agency_plan` does not mean non-billable** — n8n is an agency plan billed on at
  $50. Excluding agency plans would under-quote.
- Multiply by **`quantity`**, and normalise **cadence** to monthly.
- `payment_sources` is which agency card pays. Internal finance — **never surface it to a
  client.**

Selecting technology on an option does **not** create `contract_technologies` rows. There
is no approval step on a deliverable (statuses are `planned` / `working` /
`waiting_on_client` / `delivered`), and acceptance happens in the deal room and SOW. The
roadmap is a sales artifact and writes nothing back.

---

## What I'd like back

1. What conflicts with what you've already built?
2. Is the shared-vs-per-option split workable in the current viewer, or does it need
   restructuring?
3. Anything in the technology rules that doesn't match how the catalog actually behaves in
   the UI — you know that data better than I do.
4. Anything here that is more work than it looks, or that you'd do differently.
