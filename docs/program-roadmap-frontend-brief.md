# Program roadmap — frontend brief

**The live document for the form and viewer.** Tracks `program-roadmap-spec.md` v7; where
they disagree the spec wins, but everything here is current.

Master Marketer is finished. The backend is finished apart from soft-flag computation, which
runs on the webhook and does not block you. **The frontend is the critical path.**

All values come from `GET /api/compass/roadmap-config` — live, served from the same module
the backend validates against. Nothing below should be hardcoded.

---

## Part 1 — Form: two items left

Everything else you built is correct: read-only rate, programs multi-select with
matrix-sourced categories and tier-enforced counts, Pursuit rules, `growth` → `grow`.

### 1.1 The option display describes the old model

You show **monthly fee · overhead reserved · program hours**. Overhead is no longer
reserved — strategy and account management is billed to tasks like everything else and
appears in the plan as ordinary rows. The plan allocates against **full capacity**.

```
Monthly fee                 $7,000
Capacity                    40.0 hrs      ← what the plan allocates against
  typical coordination      ~9.8 hrs      ← expectation, planned as rows
```

Capacity is the headline. Coordination is guidance, not a subtraction — dropping it entirely
is fine. `program_hours` stays in the payload but is guidance only; never present it as a
budget being spent against.

`config.overhead_in_plan` is `true`.

### 1.2 Technology picker — three things to confirm

Your summary said "billable-only", which covers `is_client_billable`. Also needed:

- **`is_active`** filtered out, or strategists quote platforms no longer running
- **`one_time` cadence** reported as `technology_one_time`, **never amortised** into the
  monthly figure — `total_monthly` stays strictly monthly and comparable across options
- **A billable item with a null `default_client_price` fails loudly** rather than
  contributing $0

---

## Part 2 — The document you'll receive

The adapter needs this concretely, so here it is in full.

```jsonc
{
  "schema": "program_roadmap_v1",     // branch on THIS, never on customer_display_type
  "type": "program_roadmap",
  "title": "…", "summary": "…", "metadata": { },
  "hourly_rate": 125,
  "options_are_alternatives": true,   // never sum across options
  "selected_option_id": null,         // display-only label, set after the SOW is signed
  "flags": [],                        // document scope

  "shared": {                          // generated once
    "executive_summary": {
      "body": "…",
      "recommended_option_id": "opt_perform_authority_reach",
      "recommendation_rationale": "…"
    },
    "overview": "…",
    "target_market": { },
    "brand_story": "…",
    "products_and_solutions": { },
    "competition": { }
  },

  "options": [{
    "option_id": "opt_execute_authority",
    "label": "Execute — Authority",
    "tier": "execute",
    "programs": ["authority"],
    "program_allocation": { "Content": "authority" },
    "monthly_budget": 4000,
    "technology_monthly": 150,
    "technology_one_time": 0,
    "total_monthly": 4150,
    "hours_available": 32.0,
    "overhead_hours": 9.8,
    "program_hours": 22.2,
    "term_months": 12,
    "commitment": "annual",
    "notes": "…",
    "flags": [],                       // option scope
    "technology": [                    // optional; absent when no billable tools were selected
      { "technology_id": "…", "name": "HubSpot", "vendor": "HubSpot", "quantity": 1 }
    ],

    "goals": { },                      // each goal carries commitment_type
    "roadmap_phases":        { "section_description": "…", "phases": [] },
    "quarterly_initiatives": { "section_description": "…", "initiatives": [] },
    "annual_plan":           { "categories": [ ] },      // 12-month Gantt, boolean[12]

    "hours_plan": {
      "section_description": "…",
      "total_hours_allocated": 93.9,
      "total_hours_available": 96.0,
      "months": [{
        "month": 1,
        "month_label": "Month 1",
        "hours_available": 32.0,
        "hours_allocated": 31.3,
        "overhead_hours_allocated": 9.0,
        "flags": [],                   // month scope
        "tasks": [{
          "task": "Develop SEO blog post",
          "description": "…",
          "stage": "Execution",              // Foundation | Execution | Analysis
          "service_category": "Content",
          "program": "authority",            // or "overhead"
          "process_id": "uuid|null",         // null = strategist added it by hand
          "baseline_hours": 5.08,            // what the library says
          "hours": 5.08,                     // what counts
          "adjustment_reason": null,
          "flags": []                        // row scope
        }]
      }]
    }
  }]
}
```

**Three things about this shape:**

**Three months of task rows, twelve months of Gantt.** `hours_plan` holds the editable rows
and mirrors `points_plan` field for field. `annual_plan` is the Gantt and always was — they
are separate sections.

**Overhead rows are ordinary rows.** `program: "overhead"`, category
`Strategy & account management`, editable hours. Not a separate block, not injected.

**The document is a snapshot.** `hourly_rate`, `hours_available`, `hours_allocated`,
`overhead_hours` and both totals are **read, never recomputed**. A viewer deriving capacity
from `monthly_budget / dollar_per_hour` would silently rewrite a signed roadmap the moment
the contract's rate changed.

---

## Part 3 — Dual-shape adapter

Your largest item, and the one thing that depends on nobody else. **Start here.**

Four consumers read the flat `GeneratedRoadmapOutput` shape today and break on
`{shared, options[]}`:

| Consumer | Breakage |
|---|---|
| `RoadmapRenderer` | Renders an empty document rather than erroring |
| `roadmapToMarkdown` | Every section guard misses; emits nothing |
| `SharedDeliverable` | Builds its TOC from `d.overview`, `d.points_plan` — comes back empty |
| Content plan / ABM plan generators | Read the roadmap as source context |

Normalise **both** shapes to one view model: legacy documents wrap as a single unnamed
option, program roadmaps pass through. No migration of stored documents, no change to the
points path's output.

**Which option downstream generators read:**

```
selected_option_id
  ?? shared.executive_summary.recommended_option_id
  ?? refuse, and tell the strategist to choose
```

**Never fall back to `options[0]`** — that silently plans against whichever option happens to
be first, usually the cheapest.

---

## Part 4 — Viewer

**Shared sections render once; plan sections switch.**

| Section | Scope |
|---|---|
| Executive Summary, Overview, Target Market, Brand Story, Products & Solutions, Competition | Shared |
| Goals, Roadmap Phases, Quarterly Initiatives, Annual Plan, Hours Plan | Per option |

The option switch changes **only** the plan sections. Shared sections hold position and
scroll-spy state, so someone toggling options watches the plan change against a fixed picture
of their business rather than feeling they changed document.

**The TOC is the fiddly part** — option-scoped entries re-derive on switch while shared
entries hold. You flagged this; budget for it explicitly.

**Never show a summed total across options.** They are alternatives. Three options are not a
$22,000 proposal. Each option card shows services / technology / total for that option only.

**Name the technology, don't price it.** Each option may carry `technology[]` — the tools
that option's `technology_monthly` pays for, with vendor and quantity but no per-tool price.
Render it beside the technology figure on the option card: *Platform: HubSpot, Clay, HeyReach
— $1,912/mo*. Per-tool prices are withheld on purpose; a breakdown invites a negotiation over
a $40 tool. The array is absent when an option selected no billable tools, so treat it as
optional and show only the figure in that case.

**`selected_option_id`** collapses to one option with a persistent "compare all options"
affordance. It is a label — it writes nothing to the contract or its technology.

**Goals need `commitment_type` rendered**, not just stored. It is what makes the difference
between options legible: Execute commits to outputs, Perform adds leading indicators, Grow
adds business outcomes. Without it, three options look like three prices for one promise.

**Label months 4–12 of the Gantt as projection.** No rows price them and no capacity check
reaches them; they are directional continuation, not implied volume.

---

## Part 5 — Hours editing UI

`PointsPlanEditor` is the right shape already — rows, drag-reorder, add/delete, in-memory
tracking until save. Four changes:

- **Pts → Hrs**, one decimal place
- **Month header** shows `allocated / available`, not a bare total, so going over is visible
  while editing
- **Total band** shows available, allocated, variance, and dollar value at the contract rate
- **Flags render inline** on the row or month they belong to, styled on `code` and `severity`

Show `baseline_hours` quietly beside each edited value so the strategist can see what standard
was.

**When an edit pushes a month over capacity, let it go red — do not block the keystroke.** The
number they are reaching for is usually right; what needs to happen is a budget conversation,
not a rejected input.

---

## Part 6 — Markdown export and share view

`roadmapToMarkdown` needs an options-aware rewrite. **All options, clearly delimited** — the
export feeds LLMs and SOW drafting, where the comparison is the point.

`SharedDeliverable` builds its own TOC and needs the same shared-vs-per-option treatment as
the main viewer.

---

## Part 7 — Flags: eleven codes, four scopes

```ts
{
  level: 'soft',
  code,
  message,
  scope: 'row' | 'month' | 'option' | 'document',
  severity?: 'review' | 'notice',
  option_ids?: string[],
}
```

| Scope | Codes | Renders on |
|---|---|---|
| `row` | `row_below_baseline`, `row_above_baseline` | the offending task row |
| `month` | `month_thin_spread`, `month_under_capacity`, `month_over_capacity`, `ramp_month` | the month block |
| `option` | `overhead_under_reserved`, `goal_commitment_mismatch`, `content_share_off_pattern` | the option header |
| `document` | `goal_target_not_monotonic`, `recommendation_unresolved` | above the option comparison |

`config.row_level_flags`, `config.option_level_flags` and `config.cross_option_flags` list the
groups so nothing is hardcoded.

**`row` scope matters most for the editor.** `row_below_baseline` is the flag most likely to
appear the instant a strategist edits a row, and a month-level flag cannot point at which row
caused it.

**`severity` separates two different messages.** `content_share_off_pattern` says *the
generator composed this badly*; `row_below_baseline` after an edit says *you just did*. Same
level, opposite response — style `review` louder than `notice`.

**`option_ids`** appears on document-scope flags so you can highlight both sides of a
comparison.

Flags never block. The arrays exist at all four levels in every document, empty when there is
nothing to say.

---

## Suggested order

1. **Form: the two items above** — small, and unblocks a real generation test
2. **Adapter** — largest item, no dependencies, start immediately
3. **Viewer option switch** — best validated against a real generated document
4. **Hours editing UI**
5. **Markdown export and share view**

Steps 3 onward are easier once a real document exists. Ask for a generated example rather than
building against this JSON alone — the backend can produce one on a test contract as soon as
your form posts a valid payload.
