# Brief for Master Marketer — Program Roadmap generator

**This is a review request, not a build request.** Read it, tell me what's wrong, what's
underspecified, and what you'd do differently. Nothing gets built until the backend,
Lovable and you all agree.

Full spec: `docs/program-roadmap-spec.md`.

---

## What this is

A new deliverable type — `program_roadmap` — served at `/api/generate/program-roadmap`,
alongside the existing `/api/generate/roadmap`. **The existing roadmap generator does not
change.** Existing clients stay on points; new engagements use hours.

The unit changes from points to hours, and one roadmap now carries **1–3 priced options**
the client chooses between rather than a single plan.

---

## What you receive

Existing roadmap fields — `research`, `transcripts`, `instructions`, `client`,
`previous_roadmap` — plus:

```ts
hourly_rate: number;                 // one rate across every option

roadmap_options: Array<{             // 1–3, validated by the backend before submission
  option_id: string;
  label: string;                     // "Execute — Authority"
  tier: 'execute' | 'perform' | 'grow';
  programs: Array<'authority' | 'reach' | 'pursuit'>;
  monthly_budget: number;            // services only
  technology_monthly: number;        // billed separately; never consumes hours
  total_monthly: number;
  hours_available: number;           // monthly_budget / hourly_rate
  overhead_hours: number;            // reserve for strategy + account management
  program_hours: number;             // hours_available − overhead_hours
}>;

program_matrix: Record<'authority'|'reach'|'pursuit', string[]>;   // eligible categories

process_library_hours: Array<{       // union of all options' eligible categories
  task: string;
  description: string;
  stage: string;                     // Foundation | Execution | Analysis
  service_category: string;
  baseline_hours: number;
}>;
```

Apply `program_matrix` **per option** — the library is sent as a union, so a Reach-only
option must not draw an Authority category that's present for another option.

**Program is never inferred from service category.** Five categories sit in more than one
program, so the category cannot name the program that paid for it. Assign `program`
explicitly on every row.

---

## What you produce

```jsonc
{
  "hourly_rate": 125,
  "options_are_alternatives": true,
  "selected_option_id": null,

  "shared": {                                  // generated ONCE, not per option
    "executive_summary": { "body": "…", "recommended_option_id": "…", "recommendation_rationale": "…" },
    "overview": "…", "target_market": {}, "brand_story": "…",
    "products_solutions": {}, "competition": {}
  },

  "options": [{
    "option_id": "…", "label": "…", "tier": "…", "programs": ["…"],
    "monthly_budget": 4000, "technology_monthly": 150, "total_monthly": 4150,
    "hours_available": 32.0, "overhead_hours": 9.8, "program_hours": 22.2,

    "goals": {},                 // per option — see below
    "roadmap_phases": [], "quarterly_initiatives": [], "hours_plan": {},
    "annual_plan": { "months": [{
      "month": 1,
      "hours_available": 22.2,
      "hours_allocated": 21.5,
      "tasks": [{
        "task": "…", "description": "…",
        "stage": "Execution",
        "service_category": "…",
        "program": "authority",
        "baseline_hours": 5.08,
        "hours": 5.08,
        "adjustment_reason": null
      }],
      "flags": []
    }]}
  }]
}
```

**Shared sections generate once.** Three options should cost roughly 1.5× a single
roadmap, not 3× — the research synthesis does not repeat.

**Goals must differ per option.** This is the most important requirement here. Identical
goals across three prices would be three prices for one promise. Scale them to what each
option can actually commit to: Execute commits to delivery, Perform adds the leading
indicators we control, Grow owns the plan and the measurement behind it.

**Executive summary ends on a determination, not a menu** — "Your roadmap requires $9,000
a month plus roughly $600 in platform. That's Perform." Quote the **total**, services plus
technology.

---

## Hours

`baseline_hours` is what the process library says the work takes. **You may deviate from
it** where the research or instructions justify — three systems and custom attribution
should push "Manage performance reporting" well above its 1-hour baseline. When you do,
set `hours` and populate `adjustment_reason`. That flexibility is the entire reason for
leaving points; use it.

Both numbers are stored so deviation stays measurable, and the library improves from real
use over time.

Reference constants, measured from the live library and 39 contracts:

| | |
|---|---|
| Hours per point | 0.78 |
| Monthly overhead | 9.8 hrs, roughly constant at every tier |
| Program hours at $125 | Execute 22.2 · Perform 38.2 · Grow 86.2 |

---

## Guardrails

The backend refuses hard-rule violations before submission, so you should not see them.
Soft flags are yours to emit on the row or month they belong to — **they never block
generation**, they prompt the strategist.

| Flag | Threshold |
|---|---|
| Row well below baseline | `hours < baseline_hours × 0.5` with no `adjustment_reason` |
| Month spread too thin | active categories > `program_hours / 6` |
| Overhead under-reserved | strategy + account management below `overhead_hours` |
| Month under capacity | allocated < 85% of available |
| Content share off-pattern | Authority <35% or >65%; Reach >45%; Pursuit >40% |
| Ramp month | month 1 carrying heavy setup — say so in the narrative too |

**Month one is roughly half a steady-state month of production.** An Execute/Reach option
opens with "Set up paid media" (5.5h) and "Set up performance reporting" (7.0h) — 12.5
hours against 22.2 of capacity. That's the ramp period, not a fault, but the narrative
should say it so the SOW can carry it.

---

## Two structural rules

**Execute is narrow by design.** One program run deliberately narrow, not one program
spread across its eligible categories. Authority has five eligible categories; free
composition at 22.2 hours gives each about four and produces nothing. Generate from a
named shape:

- *Execute / Authority* — content production: manage content, manage SEO, manage
  reporting, 2 × SEO blog post, optimize existing article ≈ 21.5h
- *Execute / Reach* — pure paid, client already has content: manage paid media, manage
  reporting, Google Ads text ad package, image ad creative package ≈ 20.2h

Perform (38.2h) composes more freely. Grow (86.2h) can run full breadth.

**Technology never consumes hours.** `hours_available` derives from `monthly_budget`, never
`total_monthly`.

---

## What I'd like back

1. Is the shared-plus-options output shape workable, or would you rather emit options as
   separate documents?
2. Is one call per roadmap right, or one shared call plus one per option?
3. Are the soft flags better computed by you or by the backend after you return?
4. Anything underspecified — particularly around goals scaling per option, which is the
   part I'm least sure translates cleanly into a prompt.
