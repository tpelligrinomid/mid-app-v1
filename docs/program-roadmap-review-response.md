# Program Roadmap — Master Marketer's response

Reviewed against the current generator: `trigger/generate-roadmap.ts`,
`src/prompts/roadmap.ts`, `src/types/roadmap-output.ts`,
`src/routes/generate.routes.ts`.

**Verdict: buildable, and the model is sound.** Hours, per-option goals, storing
`baseline_hours` beside `hours` — all of that translates cleanly into a prompt and is
worth doing. Nothing below argues with the shape of the product.

What follows is one blocking naming collision, one unanswered question that changes the
cost estimate by an order of magnitude, answers to the four questions asked, and a list of
smaller things that will bite during implementation.

---

## 1. Blocking: `annual_plan` means two different things

The current roadmap output has **two** separate sections, and the spec's output shape
merges them under one key.

| Key today | Shape | What it is |
|---|---|---|
| `annual_plan` | `categories[].initiatives[].months: boolean[12]` | The 12-month Gantt |
| `points_plan` | `months[].tasks[]`, `month_total`, `total_points` | The editable task rows |

The spec puts monthly task rows at `options[].annual_plan.months[].tasks[]`, while also
listing `hours_plan` in the per-option table as "replaces Points Plan on this path" — and
then never populating `hours_plan` in the example JSON. Read literally, the Gantt has
disappeared and the row table has taken its key.

**Proposed fix — rows go where points rows go today:**

```jsonc
"options": [{
  "annual_plan": { "categories": [ /* Gantt, boolean[12], unchanged */ ] },
  "hours_plan": {
    "section_description": "…",   // injected by the assembler, not generated
    "total_hours": 64.5,
    "months": [{
      "month": "Month 1",
      "hours_available": 22.2,
      "hours_allocated": 21.5,
      "tasks": [ /* row schema from the spec */ ],
      "flags": []
    }]
  }
}]
```

`hours_plan` then mirrors `points_plan` field for field, and the viewer's existing editing
table binds to the same shape it already binds to.

### Same family — keep the existing key names

The spec's `shared` block renames `products_and_solutions` to `products_solutions`, and
omits `type`, `title`, `summary` and `metadata` entirely. Those four are on every
deliverable we emit and the callback/viewer path keys off `type`. Requested:

- `type: "program_roadmap"`, plus `title`, `summary`, `metadata` at the top level
- `products_and_solutions`, `roadmap_phases`, `quarterly_initiatives`, `target_market`,
  `brand_story`, `competition`, `goals` keep their current names exactly

Divergence here costs the viewer its section components and buys nothing.

### Boilerplate is injected, not generated

`section_description` on all ten sections comes from `ROADMAP_BOILERPLATE` in the
assembler — the model never writes it. Per-option sections need the same injection, per
option. Worth stating in the spec so nobody budgets tokens for it or expects the model to
vary it between options.

---

## 2. Unanswered: three months, or twelve?

The spec is written as though the plan runs twelve months (`annual_plan.months`, month-1
ramp, per-month capacity flags). The points path generates **three** — `points_plan` is a
quarterly allocation, budget is per-month, quarterly total is budget × 3.

This is the single biggest driver of generation cost and quality:

- **3 months × 3 options** = 9 month-blocks. Comparable to today's work. The "1.5×" claim
  holds.
- **12 months × 3 options** = 36 month-blocks of hour-level rows. That is not 1.5× — it is
  several times a full roadmap, it will strain the 32k output ceiling per call, and twelve
  months of task-level detail in a *sales proposal* is detail nobody reads and everybody
  has to maintain.

Our recommendation: **keep the task rows quarterly (3 months)** and keep the 12-month Gantt
as the annual view, exactly as the points path does. Month-1 ramp, capacity flags, and the
under-capacity check all still work. If twelve months of rows is genuinely wanted, say so
explicitly and we will re-cost.

---

## 3. Answers to the four questions

### Q1 — Is shared + options workable, or separate documents?

**Keep it as one document with `shared` + `options[]`.** Separate documents would force the
viewer to duplicate or diff the client sections across three files and hope they stay
identical, and the stated viewer behaviour (shared sections stay put, plan sections swap)
is exactly the single-document shape.

### Q2 — One call, or one shared call plus one per option?

Neither as posed. The generator is already **four sequential calls** with accumulated
context carried forward. The split for the program roadmap falls out cleanly:

| Call | Produces | Scope |
|---|---|---|
| 1 | `target_market` + `brand_story` | shared — unchanged |
| 2 | `products_and_solutions` + `competition` | shared — unchanged |
| 3 … 3+N | `goals` + `roadmap_phases` + `quarterly_initiatives` + `annual_plan` + `hours_plan` | **once per option** |
| last | `executive_summary` + recommendation | shared, short |

Call 3 today already bundles goals / phases / OKRs — and all three are per-option in the
spec's table. So the refactor is: calls 1–2 stay as they are, calls 3–4 merge and repeat
per option. **Three options = 6 calls against today's 4**, which is where the ~1.5×
estimate lands.

Two consequences the spec doesn't currently account for:

**The executive summary cannot be generated "once, up front."** It carries
`recommended_option_id` and `recommendation_rationale`, which require every option to
exist. It is shared, but it runs **last**, as a short final call.

**Options must be generated in ascending tier order, each seeing the ones before it.**
Options generated blind to each other read as three unrelated plans, and nothing makes the
accountability ladder visible. Sequential generation also lets us hold Perform's goals
strictly above Execute's rather than hoping.

Operationally: `maxDuration` is currently 1800s sized for four calls. Six needs a bump.

### Q3 — Should soft flags be computed by the model or the backend?

**Backend, after we return.** Every soft flag except `ramp_month` is arithmetic over rows
we have already emitted:

- `hours < baseline_hours × 0.5` and no reason
- active categories vs `program_hours / 6`
- strategy + AM sum vs `overhead_hours`
- allocated vs 85% of available
- content share percentages per program

Models compute that inconsistently across thirty-plus rows and will flag two options
differently for the same defect. Computed in the backend they are deterministic, identical
on every regeneration, and thresholds can move without redeploying a prompt. It also keeps
tokens out of an already-large output.

We keep responsibility for the **narrative** — month 1 saying in the phase text that it is
a ramp period, so the SOW can carry it. The backend attaches `flags[]`.

**One thing to fix on our side while we are here:** roadmap output is currently *not*
validated — `GeneratedRoadmapOutput` is a plain interface, the model's JSON is cast, and
nothing checks `month_total` against its tasks or `total_points` against the months. That
has been survivable for points. It is not survivable once those sums are hours that
multiply by a rate into a client-facing dollar figure. The program roadmap path will get a
real output schema plus a repair re-ask before it ships. Flagging it because it is
generator work that the spec's sequencing does not currently include.

### Q4 — Goals scaling per option

Right instinct, and it is the most important requirement in the brief. It will not survive
contact with the prompt as written.

The goals schema is `business_outcome / metric / description / benchmark / annual_goal /
data_source`. Nothing in it encodes **what class of commitment a goal is**. So "scale the
goals to the tier" produces the same MQL goal at three different numbers — which is the
failure the requirement exists to prevent, with different digits.

**Make it structural.** Add a required field per goal:

```ts
commitment_type: 'output' | 'leading_indicator' | 'business_outcome'
```

constrained by tier:

| Tier | Permitted | Example |
|---|---|---|
| `execute` | `output` only | "24 published articles, 12 optimized" |
| `perform` | `output` + `leading_indicator` | organic sessions, MQL volume, CPL |
| `grow` | all three, plus measurement ownership | pipeline sourced, with attribution owned |

That turns "goals must differ" into something checkable — an Execute option carrying a
`business_outcome` goal is a flag, not a matter of prompt tone.

Two supporting details: `benchmark` should come from the shared research synthesis so it
is identical across options while only the targets differ, otherwise three options invent
three baselines for the same client. And targets should be required to increase
monotonically with tier; a Perform target at or below Execute's is a flag.

---

## 4. Things that will bite during implementation

### The archetypes and hour constants only hold at $125

`overhead_hours` is fixed at 9.8 while `hours_available = monthly_budget / rate`. At $175:

| | $125 | $175 |
|---|---|---|
| Execute capacity | 32.0 | 22.9 |
| Overhead | 9.8 | 9.8 |
| **Program hours** | **22.2** | **13.1** |

The Execute / Authority archetype is 21.5 hours. At $175 it does not fit at all. Meanwhile
the tier bands are dollar-denominated, so two contracts both labelled Execute can differ by
40% in delivered hours.

The rate-ladder open question is therefore not only a pricing question — every hour
constant in both documents, and both Execute archetypes, are conditional on $125. Suggest:
express archetypes as **task lists without fixed hour totals**, and decide whether the
bands move with the rate before the generator is allowed to refuse anything on band
grounds.

### One "hard rule" can't be enforced where the spec puts it

> Any month's allocated hours exceed capacity — refuse

is listed among rules validated *before* generation. But the allocation is our output, so
this can only be evaluated after. It needs to be a **repair loop** against the offending
option, not a refusal — otherwise a six-call generation is thrown away over one month being
0.4 hours over.

### Two flags fire on one intended condition

Execute / Reach, month 1: setup paid media 5.5 + setup reporting 7.0 + manage paid 4.0 +
manage reporting 1.0 = 17.5 against 22.2 = **79% allocated**. That trips `ramp_month` and
`month_under_capacity` together, for the same, expected, documented situation. Suppress
under-capacity in month 1 when ramp is set.

### "Month spread too thin" needs a granularity decision

At Execute the threshold is 22.2 / 6 ≈ 3 categories. Whether Execute / Authority passes
depends on whether the count runs against the 16 stored ClickUp categories or the 12
rolled-up ones — `SEARCH & DISCOVERY` rolling into Content is the difference between 3 and
4. **Count on the rollup**, or the named archetypes flag themselves.

### `program` is unverifiable on multi-program options, and a flag depends on it

For Perform = Authority + Reach, Content is eligible in both. We assign `program` per row
and nothing downstream can check it. The content-share flag (Authority 35–65%) is computed
off exactly that field — so a generator that labels rows to land inside the band makes the
flag self-satisfying.

Suggestion: have each option carry a small `program_allocation` map decided once
(`{"Content": "authority", "Paid media": "reach"}`) and derive row-level `program` from it.
Fewer degrees of freedom, and the allocation itself becomes reviewable.

### Don't send `technology_items`

Technology never becomes a row and never consumes hours. The only thing we need it for is
the executive summary sentence quoting total investment, which needs `technology_monthly`
and `total_monthly` and nothing else. Sending resolved catalog items is pure token cost on
every call. Send the two numbers.

### `previous_roadmap` is undefined for this path

A previous program roadmap has options. Which option does next quarter evolve from —
presumably the one on `selected_option_id`, but that field is explicitly optional and may
be null. Also, the existing helper slices each prior section at 3,000 characters, so a
nested `options[]` blob would be cut mid-option and arrive as broken JSON in the prompt.

Request: the backend flattens the **selected option's** sections into the existing flat
shape before submitting, and passes nothing if no option was selected.

---

## 5. What we need decided before we build

1. **Three months of task rows, or twelve?** Changes cost materially. We recommend three.
2. **Is `hours_plan` the row container and `annual_plan` the Gantt?** Confirm, and we will
   match the points path field for field.
3. **Is the rate fixed at $125 for v1?** If a ladder exists at launch, the archetypes and
   the band table need re-expressing first.
4. **Are soft flags ours or the backend's?** We recommend backend; we keep the ramp
   narrative.
5. **Does `commitment_type` go into the goals schema?** This is the mechanism that makes
   per-option goals real rather than aspirational, and it needs to exist in the viewer too.

Everything else in the spec we are happy to build to as written.
