# Program Roadmap — Generator Spec

Hours-based, program-based, tier-based roadmap. Runs **alongside** the existing points
roadmap; nothing about the points path changes.

**v2** — incorporates the Master Marketer and Lovable review responses
(`program-roadmap-review-response.md`, `program-roadmap-review-response-from-lovable.md`)
and the four decisions taken against them.

---

## Scope

**New engagements only.** Existing contracts keep `customer_display_type = 'points'`, keep
`monthly_points_allotment`, and keep generating the current `roadmap` deliverable. No
migration, no backfill, no change to their output.

**What the generator produces is a draft scope of work, not a final plan.** It reads the
research, transcripts, and instructions, draws tasks from the process library, and proposes
hours per task. The strategist then edits task descriptions and hours row by row — the same
affordance the points roadmap already has.

The generator's job is therefore *not* to be precisely right. It is to produce a defensible
starting point and to make it impossible to ship an incoherent one. Every constraint below
serves that second half.

### Points remain the system's ledger

Worth stating plainly, because it governs what "pricing in hours" does and does not mean:

1. ClickUp records **hours** on tasks.
2. The team converts those to **points** in ClickUp via a calculated field.
3. Points sync to the database. Invoices, credits, task logs and burden all reconcile in
   points.
4. The frontend converts points back to **hours** at display time, using the contract's
   rate, for contracts set to `'hours'`.

The program roadmap does not change any of that. **It is an estimate instrument.** Billing
continues to run on the points ledger.

The direct consequence, and a hard rule for the frontend: **roadmap hours are authored on
the document and must never be re-derived through `useDisplayUnits`.** That helper answers
"what did the client buy in hours at their rate" — a billing conversion of
`points × 100 / rate`, which is 0.80 h/pt at $125. The library's effort constant is 0.78.
Both are correct about different questions, and a screen that mixes them quotes two numbers
for one task.

---

## Measured constants

From the live process library (71 in-scope items) and 39 active recurring contracts over
six months. Recompute if the library changes materially.

| Constant | Value | Use |
|---|---|---|
| Hours per point | `0.78` | Converting legacy points-denominated figures only |
| Monthly overhead reserve | `9.8 hrs` | 12.6 observed points × 0.78; near-constant at every tier |
| Points/hours break-even rate | `$129/hr` | Where hours bill the same as the old $100 point |

**Task hours come from `compass_process_library.time_estimate_ms`, not from 0.78.** The
conversion constant exists only to translate figures originally expressed in points, such as
the overhead reserve.

These, the tier bands, the eligibility matrix, the commitment ladder and the flag
vocabulary are all published at **`GET /api/compass/roadmap-config`**, served from
`backend/src/config/roadmap-model.ts`. That module is the single definition: backend
validation and flag computation import it directly, the frontend fetches it, and Master
Marketer receives the relevant slice inside the generation payload.

A second hardcoded copy in the UI would drift, and the first symptom is a roadmap that
passes the generation form and is refused on submit.

---

## Tier bands are hours, not dollars

A tier is defined by the capacity it buys, not the fee.
`capacity_hours = monthly_budget ÷ dollar_per_hour`.

| Tier | Capacity hours | Program hours | Programs |
|---|---|---|---|
| Execute | 32 – 47.9 | 22.2 – 38.1 | 1 |
| Perform | 48 – 95.9 | 38.2 – 86.1 | 2 |
| Grow | 96+ | 86.2+ | 3 |

Which prices out, at the same tier, as:

| Tier | @ $125 | @ $150 | @ $175 |
|---|---|---|---|
| Execute | from $4,000 | from $4,800 | from $5,600 |
| Perform | from $6,000 | from $7,200 | from $8,400 |
| Grow | from $12,000 | from $14,400 | from $16,800 |

**Why hours and not dollars.** Under dollar bands, Execute at $175 buys 22.9 capacity hours
against 32 at $125 — two contracts on the same tier differing by 40% in delivered work, and
the Execute archetypes below would not fit at all at the higher rate. Hours bands hold the
scope promise constant and let a harder account cost more for it, which is what the rate
variable is for. Published pricing reads "from $4,000", so a higher floor at a higher rate
breaks no promise.

The rate is **fixed per contract** on `contracts.dollar_per_hour`. It never varies between
the options on a roadmap.

---

## Data model

### `contracts`

**No schema change. Both fields already exist.**

- `customer_display_type` — `'points' | 'hours' | 'none'`. Gates **generation**: `'hours'`
  offers the program roadmap form. It does **not** gate rendering — see the schema
  discriminator below.
- `dollar_per_hour` — the blended rate. Set per new-model contract at creation, defaulting
  to $125. Not backfilled: existing contracts stay on points and never need one. The
  generator refuses without it, which is a validation at generation time, not a migration.

**Tier and programs are deliberately NOT on the contract.** They are generation inputs — a
roadmap presents several priced options and the client chooses, so recording them beforehand
would record a decision nobody has made.

*Deferred by decision:* nothing in the database will say which programs an account runs, so
portfolio questions stay answerable only by inference from task service categories, the way
the sizing analysis does today.

### `compass_process_library`

No schema change. `time_estimate_ms` (81 of 85 items, rolled up from subtasks to match
ClickUp's displayed total) and `service_category` (all 85, migration 019) are both synced.

**Hygiene pass required before generation quality can be trusted** — both reviewers flagged
this as blocking rather than cosmetic:

- `Set up ABM` exists twice at 9h and 18.08h
- Four active items carry no estimate

A generator drawing from that library produces a defensible-looking number from an
undefended row.

### Roadmap rows

```ts
{
  task: string,
  description: string,
  stage: 'Foundation' | 'Execution' | 'Analysis',
  service_category: string,        // stored at full granularity, rolled up for display
  program: 'authority' | 'reach' | 'pursuit' | 'overhead',
  process_id: string | null,       // null when the strategist added a custom row
  baseline_hours: number,          // from the library, never overwritten
  hours: number,                   // generated or strategist-edited; what counts
  adjustment_reason: string | null
}
```

Storing `baseline_hours` beside `hours` lets the strategist see how far a row has moved from
standard, and lets you measure over a few quarters which library items are systematically
adjusted upward. The library then corrects itself from real use. Points made that deviation
invisible — this is the main thing hours buy back.

---

## Eligibility matrix

Which categories a program may draw from. Configuration, exposed as data.

| Service category | Authority | Reach | Pursuit |
|---|:---:|:---:|:---:|
| Content | ● | ● | ● |
| Design | ● | ● | ● |
| Development | | ● | ● |
| Marketing operations | | ● | ● |
| Analytics & reporting | ● | ● | ● |
| Organic social | ● | | |
| Podcast & video | ● | | |
| Paid media | | ● | ● |
| Email & nurture | | ● | |
| Outbound | | | ● |

Strategy & account management runs under every engagement and is never sold on its own — it
is the overhead reserve, not a program category. Digital PR is subcontracted and billed
separately; it never consumes hours.

**Category granularity.** ClickUp stores 15 categories; this matrix uses 12. Roll up at
display time — `SEARCH & DISCOVERY` into Content, `ACCOUNT MANAGEMENT` into Strategy — and
keep the stored value at full granularity.

**Category counts are made on the rollup, not the 15.** The thin-spread flag below depends
on it: at Execute the threshold is ~3 categories, and counting Search & Discovery separately
from Content would make the Execute/Authority archetype flag itself.

### `program_allocation`

Five categories sit in more than one program, so a row's `program` is an assignment, not a
derivation — and nothing downstream can verify it. Since the content-share flag is computed
off that field, a generator free to label rows could satisfy the flag by labelling.

Each option therefore carries a **`program_allocation` map**, decided once, from which
row-level `program` is derived:

```jsonc
"program_allocation": { "Content": "authority", "Design": "authority", "Paid media": "reach" }
```

Fewer degrees of freedom, and the allocation itself becomes reviewable.

---

## Roadmap options

A roadmap is generated from **one to three options**, each a complete priced scenario.

| Field | Notes |
|---|---|
| `tier` | `execute` \| `perform` \| `grow` |
| `programs` | Which programs this option runs |
| `monthly_budget` | The **service** fee this option assumes |
| technology | Multi-select from the Pulse catalog |

**Maximum three options.** Three reads as a proposal; more reads as indecision and
multiplies generation cost with it.

The rate is not an option field — it comes from the contract and is identical across every
option. Options differ only in what is bought, never in what an hour costs.

Options are **alternatives, not phases.** They are never summed. Three options are not a
$22,000 proposal, and any UI that totals them says otherwise.

### What varies between options

| Section | Scope |
|---|---|
| `executive_summary` | Shared, generated **last**, carries the recommendation |
| `overview`, `target_market`, `brand_story`, `products_and_solutions`, `competition` | **Shared** |
| `goals`, `roadmap_phases`, `quarterly_initiatives`, `annual_plan`, `hours_plan` | **Per option** |

**Goals being per-option is the most important line in this table.** Identical goals across
three prices would be three prices for one promise — the failure the retainer model opens
with. See the commitment ladder below, which makes it structural rather than a matter of
prompt tone.

**Shared sections generate once.** Three options costs roughly 1.5× a single roadmap, not
3×, because the research synthesis does not repeat.

### Validation across options

Every option validates **before** any generation runs, and generation refuses if any option
fails. Partially generating would present a two-option proposal where three were asked for,
with nothing saying why.

| Rule | Message |
|---|---|
| Tier does not match the capacity-hours band | "$4,000 at $175/hr is 22.9 hours — below Execute's 32." |
| Program count exceeds tier | "Perform is two programs. Select which two." |
| Pursuit at Execute | "Pursuit starts at Perform, paired with Authority or Reach." |
| Pursuit sold alone at any tier | "Pursuit is never sold on its own." |
| Category outside the sold programs' matrix | Names the category and the programs that include it |
| `dollar_per_hour` unset | "Set the contract's hourly rate before generating." |
| More than three options | "A roadmap carries at most three options." |

**A month exceeding capacity is not in this table.** Allocation is the generator's output, so
it can only be evaluated afterwards. It is a **repair loop against the offending option**,
never a refusal — a six-call generation must not be discarded because one month is 0.4 hours
over.

### The roadmap never writes back

**There is no approval step on a deliverable.** Statuses are `planned`, `working`,
`waiting_on_client`, `delivered` — and `delivered` means the document reached the client,
not that they accepted the deal. Acceptance happens in the deal room, contract and SOW.

So the roadmap writes nothing to `contracts` and nothing to `contract_technologies`, ever. A
document that can be regenerated, edited and re-sent must not be able to change what a
client is billed, and with no approval event there is no safe moment to do it.

**One display-only exception.** `selected_option_id` may be set on the deliverable once the
SOW is signed; the viewer then collapses to that option. It is a label — it triggers
nothing, changes no billing, and can be changed or cleared freely.

### Which option downstream consumers read

Content plan and ABM plan generation take the roadmap as source context, so "read the
roadmap" is ambiguous with three options. The rule:

```
selected_option_id
  ?? shared.executive_summary.recommended_option_id
  ?? refuse, and tell the strategist to choose
```

**Never fall back to `options[0]`** — that silently plans against whichever option happens to
be first, usually the cheapest.

`previous_roadmap` needs the same resolution plus flattening: the existing helper slices each
prior section at 3,000 characters, so a nested `options[]` blob arrives at the prompt cut
mid-option as broken JSON. **The backend flattens the selected option's sections into the
existing flat shape before submitting, and passes nothing when no option is selected.**

---

## Goals — the commitment ladder

The goals schema is `business_outcome / metric / description / benchmark / annual_goal /
data_source`. Nothing in it encodes *what class of commitment* a goal is, so "scale the goals
to the tier" yields the same MQL goal at three different numbers — the failure the
requirement exists to prevent, with different digits.

Add a required field per goal:

```ts
commitment_type: 'output' | 'leading_indicator' | 'business_outcome'
```

| Tier | Permitted | Example |
|---|---|---|
| `execute` | `output` only | "24 published articles, 12 optimized" |
| `perform` | `output` + `leading_indicator` | organic sessions, MQL volume, CPL |
| `grow` | all three, plus measurement ownership | pipeline sourced, with attribution owned |

An Execute option carrying a `business_outcome` goal is now a flag rather than a matter of
tone. Two supporting rules:

- **`benchmark` comes from the shared research synthesis**, so it is identical across options
  and only the targets differ. Otherwise three options invent three baselines for one client.
- **Targets increase monotonically with tier.** A Perform target at or below Execute's is a
  flag.

This field must exist in the viewer too, not only the schema.

---

## Technology

Billed as a separate line item and **never consumes hours**. `hours_available` derives from
`monthly_budget`, never `total_monthly`.

It appears per option because the tooling a program needs differs — Pursuit requires sending
domains, warming, enrichment and rotation before anything sends; Authority needs almost none
of it. Comparing options on the service fee alone would make a Pursuit option look cheaper
than it is.

| | |
|---|---|
| `monthly_budget` | Services |
| `technology_monthly` | Recurring platform cost at **client price** |
| `technology_one_time` | Setup and implementation fees, reported separately |
| **`total_monthly`** | `monthly_budget + technology_monthly` |

### Tables

| Table | Rows | Purpose |
|---|---|---|
| `technologies` | 73 | The catalog. Defaults per tool. |
| `contract_technologies` | 227 | Assignments to a contract, with optional overrides |
| `payment_sources` | 3 | Which agency card pays. **Internal finance, not client billing.** |

`payment_sources` holds agency cards — "MiD Tech Stack Card (Mercury)" — so it answers *which
of our cards is charged*, not *who holds the contract*. Owner/Admin-only in the UI already,
and it must never reach a client-facing roadmap.

### Resolution

Assignments inherit from the catalog: in the live data the override columns are almost always
null. Every field resolves as `COALESCE(assignment, catalog default)`.

```
for each technology on the option:
    if not t.is_active                            -> skip   # retired tool
    billable = COALESCE(ct.client_billable_override, t.is_client_billable)
    if not billable                               -> skip   # agency-absorbed
    if ct.status != 'active' or ct.deactivated_on -> skip
    price   = COALESCE(ct.client_price, t.default_client_price)
    if price is null                              -> FAIL LOUDLY, do not contribute 0
    cadence = COALESCE(ct.billing_cadence, t.default_billing_cadence)
    qty     = COALESCE(ct.quantity, 1)
    if cadence == 'one_time':  technology_one_time += price * qty
    else:                      technology_monthly  += to_monthly(price, cadence) * qty
```

Six things here are quietly wrong if missed, and each has a real cost:

**`is_client_billable`, not a missing price.** The flag is authoritative.
`client_billable_override` is the per-contract exception — a tool globally non-billable can
still be billed to one account, which is exactly what that column was built for.

**`default_client_price`, never `default_internal_cost`.** They diverge — Factors.ai is $450
internal against $600 client price. Internal cost is a margin figure and must never reach a
client-facing proposal.

**`quantity`.** Cost is price × quantity. Everything defaults to 1, so this stays invisible
until the first multi-seat tool, then the quote is silently short.

**`is_agency_plan` is not non-billable.** n8n is an agency plan billed on at $50. Excluding
agency plans under-quotes.

**`is_active`.** The catalog carries retired tools. Filter them or strategists quote platforms
you no longer run.

**One-time cadence is not amortised.** Setup fees reported separately keep `total_monthly`
strictly monthly and comparable across options.

Nothing here creates `contract_technologies` rows. Assigning technology to a contract is a
billing change and happens through the SOW process.

---

## Generation payload

`processor.ts` branches on `customer_display_type`. The points path is untouched.

```ts
/** Program roadmap: contract blended rate, one value across every option */
hourly_rate?: number;
/** Program roadmap: the priced options to generate. 1–3, ascending tier order. */
roadmap_options?: Array<{
  option_id: string;
  label: string;                     // "Execute — Authority", shown to the client
  tier: 'execute' | 'perform' | 'grow';
  programs: Array<'authority' | 'reach' | 'pursuit'>;
  program_allocation: Record<string, 'authority' | 'reach' | 'pursuit'>;
  monthly_budget: number;            // services only
  technology_monthly: number;        // for the executive summary's total
  total_monthly: number;
  hours_available: number;           // monthly_budget / hourly_rate
  overhead_hours: number;            // 9.8
  program_hours: number;             // hours_available − overhead_hours
}>;
/** Program roadmap: category eligibility per program, enforced per option */
program_matrix?: Record<'authority' | 'reach' | 'pursuit', string[]>;
/** Program roadmap: library items, union of all options' eligible categories */
process_library_hours?: Array<{
  task: string;
  description: string;
  stage: string;
  service_category: string;
  baseline_hours: number;
}>;
```

**Resolved technology line items are not sent.** They never become rows and never consume
hours; the only generator need is the executive summary's total-investment sentence, which
takes `technology_monthly` and `total_monthly`. The backend stores the resolved items on the
deliverable for display. Sending them would be pure token cost on every call.

The library is sent as a **union** across options; Master Marketer applies `program_matrix`
per option so a Reach-only option cannot draw an Authority category present for another.

---

## Expected output

**Three months of task rows; twelve months of Gantt.** The points path is quarterly and this
matches it. Twelve months of hour-level rows across three options is 36 month-blocks — it
strains the output ceiling, and it is detail nobody reads in a sales proposal and everybody
maintains afterwards.

`annual_plan` and `hours_plan` are **separate sections and always have been**:

| Key | Shape | What it is |
|---|---|---|
| `annual_plan` | `categories[].initiatives[].months: boolean[12]` | The 12-month Gantt |
| `hours_plan` | `months[].tasks[]`, totals | The editable task rows — mirrors `points_plan` |

```jsonc
{
  "schema": "program_roadmap_v1",       // viewer branches on THIS, not the contract
  "type": "program_roadmap",
  "title": "…", "summary": "…", "metadata": { /* … */ },
  "hourly_rate": 125,
  "options_are_alternatives": true,
  "selected_option_id": null,

  "shared": {
    "executive_summary": {
      "body": "…",
      "recommended_option_id": "opt_perform_authority_reach",
      "recommendation_rationale": "…"
    },
    "overview": "…", "target_market": {}, "brand_story": "…",
    "products_and_solutions": {}, "competition": {}
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

    "goals": { /* commitment_type per goal */ },
    "roadmap_phases": [],
    "quarterly_initiatives": [],
    "annual_plan": { "categories": [ /* 12-month Gantt */ ] },
    "hours_plan": {
      "section_description": "…",        // injected by the assembler, not generated
      "total_hours": 64.5,
      "months": [{
        "month": 1,
        "month_label": "Month 1",
        "hours_available": 22.2,
        "hours_allocated": 21.5,
        "tasks": [ /* row schema above */ ],
        "flags": []                       // attached by the backend, not the model
      }]
    }
  }]
}
```

**Key names match the existing roadmap family exactly** — `products_and_solutions`,
`roadmap_phases`, `quarterly_initiatives`, `target_market`, `brand_story`, `competition`,
`goals`. Divergence costs the viewer its section components and buys nothing.

**`section_description` is injected from `ROADMAP_BOILERPLATE` by the assembler, per option.**
The model never writes it; nobody should budget tokens for it or expect it to vary between
options.

**Month is a number with an optional display label**, so sorting is reliable. The points
path's `"Month 1"` string stays as `month_label`.

### Generation sequence

The generator is four sequential calls today with accumulated context. The split:

| Call | Produces | Scope |
|---|---|---|
| 1 | `target_market` + `brand_story` | shared — unchanged |
| 2 | `products_and_solutions` + `competition` | shared — unchanged |
| 3 … 3+N | `goals`, `roadmap_phases`, `quarterly_initiatives`, `annual_plan`, `hours_plan` | **once per option** |
| last | `executive_summary` + recommendation | shared, short |

Three options is six calls against today's four — where the ~1.5× estimate lands.
`maxDuration` is sized for four and needs raising.

**The executive summary runs last, not first.** It carries `recommended_option_id` and its
rationale, which require every option to exist.

**Options generate in ascending tier order, each seeing the ones before it.** Options
generated blind to each other read as three unrelated plans and nothing makes the
accountability ladder visible. Sequential generation is also what holds Perform's goals
strictly above Execute's rather than hoping.

### Output validation

Roadmap output is currently unvalidated — `GeneratedRoadmapOutput` is a plain interface, the
model's JSON is cast, and nothing checks `month_total` against its tasks. Survivable for
points; not once those sums multiply by a rate into a client-facing dollar figure. **This path
ships with a real output schema and a repair re-ask.**

---

## Guardrails

### Soft flags are computed by the backend

Every soft flag except the ramp narrative is arithmetic over rows the generator has already
emitted. Computed in the backend they are deterministic, identical on every regeneration, and
their thresholds move without redeploying a prompt. A model computing them across thirty rows
will flag two options differently for the same defect.

Master Marketer keeps the **narrative** — month one saying in its phase text that it is a ramp
period, so the SOW can carry it. The backend attaches `flags[]`.

**Closed vocabulary.** The frontend styles on `code`, so the set is fixed:

| `code` | Threshold |
|---|---|
| `row_below_baseline` | `hours < baseline_hours × 0.5` with no `adjustment_reason` |
| `month_thin_spread` | active rolled-up categories > `program_hours / 6` |
| `overhead_under_reserved` | strategy + AM below `overhead_hours` |
| `month_under_capacity` | allocated < 85% of available |
| `content_share_off_pattern` | Authority <35% or >65%; Reach >45%; Pursuit >40% |
| `ramp_month` | month 1 carrying heavy setup |
| `goal_commitment_mismatch` | a goal's `commitment_type` exceeds what the tier permits |
| `goal_target_not_monotonic` | a higher tier's target at or below a lower tier's |

Flags are `{ level: 'soft', code, message }` and never block.

**`month_under_capacity` is suppressed when `ramp_month` fires.** An Execute/Reach month one
runs 17.5 of 22.2 hours — 79% — which trips both for the same expected, documented situation.

### Execute archetypes

Execute is one program run **deliberately narrow**, not one program spread across its eligible
categories. Authority has five; free composition at 22.2 hours gives each about four and
produces nothing.

**Execute / Authority** — the client needs content produced

| Task | Hours |
|---|---|
| Manage content | 0.75 |
| Manage SEO | 5.00 |
| Manage performance reporting | 1.00 |
| Develop SEO blog post × 2 | 10.16 |
| Optimize existing SEO article | 4.58 |
| | **21.49** |

**Execute / Reach** — the client already has content and needs paid run

| Task | Hours |
|---|---|
| Manage paid media | 4.00 |
| Manage performance reporting | 1.00 |
| Develop Google Ads text ad creative package | 5.33 |
| Develop image ad creative package | 9.83 |
| | **20.16** |

These are **task lists, not fixed totals.** They fit Execute's floor of 22.2 program hours; an
Execute engagement higher in the band has more room and the same shape.

Perform (38.2+) composes more freely. Grow (86.2+) can run full breadth.

### Month one

Setup work is heavy relative to Execute's capacity. An Execute / Reach engagement opens with
`Set up paid media` (5.5h) and `Set up performance reporting` (7.0h) — 12.5 hours, **56% of the
month's program capacity.** Month one therefore delivers roughly half a steady-state month of
production. That is the ramp period in the arithmetic rather than a fault, and the generator
says so in the narrative so the SOW can carry it.

---

## Frontend contract

### The document is a snapshot

`hourly_rate`, `hours_available`, `hours_allocated` and `overhead_hours` are stored on the
document and **read, never recomputed.** A viewer deriving capacity from `monthly_budget /
dollar_per_hour` would silently rewrite a signed roadmap the moment the contract's rate
changed.

### Rendering branches on `schema`, not the contract

`customer_display_type` is a presentation setting a human can change at any time. Flipping an
hours contract to points after generation would feed an options document to the flat renderer
— blank sections, not a graceful fallback. The viewer branches on
`schema: "program_roadmap_v1"`. `customer_display_type` still gates which generation form
appears.

### A dual-shape adapter is required

Four consumers read the flat `GeneratedRoadmapOutput` shape today and break on
`{shared, options[]}`: markdown export, the public share view, the client viewer, and the
downstream content/ABM generators. An adapter normalises **both** shapes to one internal view
model — legacy documents wrap as a single unnamed option, program roadmaps pass through.

This is the largest single frontend item, roughly the size of the viewer changes themselves.
No migration of stored documents and no change to the points path's output.

### Viewer

- Option switch above the plan sections; shared sections hold position and scroll-spy state
  while option-scoped TOC entries re-derive on switch. The TOC is the fiddly part — budget for
  it.
- **No summed total across options, anywhere.** Each option card shows services / technology /
  total for that option only.
- `selected_option_id` collapses to one option with a persistent "compare all options"
  affordance, and writes nothing.
- **Markdown export contains all options, clearly delimited** — it feeds LLMs and SOW
  drafting, where the comparison is the point.

### Editing

The existing `PointsPlanEditor` is the right shape — rows, drag-reorder, add/delete, in-memory
tracking until save. Four changes:

- **Pts → Hrs**, one decimal place
- **Month header** shows `allocated / available`, not a bare total
- **Total band** shows available, allocated, variance, and dollar value at the contract rate
- **Flags render inline** on the row or month they belong to, styled on `code`

Show `baseline_hours` quietly beside each edited value so the strategist can see what standard
was.

**When an edit pushes a month over capacity, let it go red — do not block the keystroke.** The
number they are reaching for is usually right; what needs to happen is a budget conversation,
not a rejected input.

### Technology picker

Multi-select over 73 catalog rows with billability resolution, cadence normalisation,
quantity, `is_active` filtering, and a live per-option total. This is a small feature, not a
form field. A billable item with a null client price **fails loudly** rather than contributing
$0.

---

## Sequencing

1. **Library hygiene pass** — duplicate `Set up ABM`, four missing estimates. Blocking on
   quality, not cosmetic.
2. Eligibility matrix, tier bands and constants exposed as configuration data
3. `processor.ts` branch, payload assembly, technology resolution, soft-flag computation
4. Master Marketer — per-option calls, output schema, repair re-ask, `maxDuration` raise
5. Lovable — dual-shape adapter, then viewer option switch, then generation form and
   technology picker, then hours editing UI

Steps 4 and 5 run in parallel against this document. **No schema change and no data
migration** — every field either exists or lives on the deliverable.

---

## Open

- **Should `selected_option_id` be set from the deal room** when a SOW is signed there, rather
  than by hand? It would keep the roadmap honest without anyone remembering — but it links two
  systems deliberately kept separate today.
