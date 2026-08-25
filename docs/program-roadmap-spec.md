# Program Roadmap — Generator Spec

Hours-based, program-based, tier-based roadmap. Runs **alongside** the existing points
roadmap; nothing about the points path changes.

---

## Scope

**New engagements only.** Existing contracts keep `customer_display_type = 'points'`, keep
`monthly_points_allotment`, and keep generating the current `roadmap` deliverable. No
migration, no backfill, no change to their output.

**What the generator produces is a draft scope of work, not a final plan.** It reads the
research, transcripts, and instructions, draws tasks from the process library, and
proposes hours per task. The strategist then edits task descriptions and hours row by
row — the same affordance the points roadmap already has.

The generator's job is therefore *not* to be precisely right. It is to produce a
defensible starting point and to make it impossible to ship an incoherent one. Every
constraint below exists to serve that second half.

---

## Measured constants

Derived from the live process library (71 in-scope items) and 39 active recurring
contracts over six months. Recompute rather than assume if the library changes materially.

| Constant | Value | Source |
|---|---|---|
| Hours per point | `0.78` | Library, Foundation/Execution/Analysis items |
| Monthly overhead (Strategy + AM) | `9.8 hrs` | 12.6 observed points × 0.78 |
| Points/hours break-even rate | `$129/hr` | Where hours bill the same as the old $100 point |

At a $125 blended rate:

| Tier | Fee | Capacity | Overhead | Program hours |
|---|---|---|---|---|
| Execute | $4,000 | 32.0 | 9.8 | **22.2** |
| Perform | $6,000 | 48.0 | 9.8 | **38.2** |
| Grow | $12,000 | 96.0 | 9.8 | **86.2** |

Overhead is roughly constant in absolute hours, so its share falls as the fee rises —
31% / 20% / 10%, against the retainer model's predicted 30 / 20 / 12.

---

## Data model

### `contracts`

**No schema change. Both fields already exist.**

- `customer_display_type` — `'points' | 'hours' | 'none'`. This *is* the pricing model,
  and it already selects what the client sees. `'hours'` routes to the program roadmap;
  `'points'` and `'none'` keep the existing points path, so every contract on the book
  today is unaffected by default.
- `dollar_per_hour` — the blended rate, set per contract. Not backfilled: existing
  contracts stay on points and never need one, and the generator refuses to run without
  it, which is a validation at generation time rather than a migration.

**One rate per contract, not per option.** The rate reflects how demanding an account is
to serve — seniority required, review depth, system complexity — and is a judgement made
once, at contract level. It does not vary between the options on a roadmap.

That is a deliberate limit on explanation. The blended rate already covers every skill
set; the tier minimums already enforce "two programs costs at least this much". Making
the rate move between options too would mean explaining to a client why their hourly rate
changes with the size of the plan, which is one variable more than the model can carry.

*Edge case worth knowing:* a contract priced in hours but set to `'none'` display would
route to the points path. If you ever need to price in hours while hiding the unit from
the client, that is the point at which display and pricing have to separate into two
fields.

**Tier and programs are deliberately NOT on the contract.** They are generation inputs —
a roadmap presents several priced options and the client chooses, so recording them
beforehand would record a decision nobody has made.

*Deferred by decision:* with programs off the contract, nothing in the database says
which programs an account runs, so portfolio questions ("how many clients run Pursuit?")
stay answerable only by inference from task service categories, the way the sizing
analysis does today. Accepted for now; if it becomes a real reporting need, the place to
record it is the approved option.

### `compass_process_library`

`time_estimate_ms` is the baseline effort and is already synced (81 of 85 items
populated, rolled up from subtasks to match ClickUp's displayed total).
`service_category` is already synced and classified.

**No new field is needed.** Everything in the process library is a deliverable —
`Manage ABM` produces notes and a record of work the same as `Develop SEO blog post`
produces an article. There is no ongoing-versus-artifact split to encode, and scheduling
is simply which months a row appears in.

### Roadmap rows

Each generated task row carries **both** numbers:

```ts
{
  task: string,
  description: string,
  stage: 'Foundation' | 'Execution' | 'Analysis',
  service_category: string,        // rolled up for display, stored at full granularity
  program: 'authority' | 'reach' | 'pursuit' | 'overhead',
  process_id: string | null,       // null when the strategist added a custom row
  baseline_hours: number,          // from the library, never overwritten
  hours: number,                   // generated or strategist-edited; what counts
  adjustment_reason: string | null
}
```

Storing `baseline_hours` alongside `hours` costs nothing now and buys two things: the
strategist can see how far a row has moved from standard, and after a few quarters you
can measure which library items are systematically adjusted upward and by how much. The
library then corrects itself from real use rather than a manual re-estimate. Points made
that deviation invisible — this is the main thing hours buy back.

`program` is assigned explicitly per row. **It is never inferred from
`service_category`** — five categories sit in more than one program, so the category
cannot name the program that paid for it. The eligibility matrix constrains what is
allowed; it does not derive.

---

## Roadmap options

A roadmap is generated from **one or more options**, each a complete priced scenario. The
strategist supplies a row per option:

| Field | Notes |
|---|---|
| `tier` | `execute` \| `perform` \| `grow` |
| `programs` | Which programs this option runs |
| `monthly_budget` | The fee this option assumes |

**Maximum three options.** Three reads as a proposal; more reads as indecision, and
multiplies generation cost with it.

The rate is not an option field — it comes from the contract and is the same across every
option. Options differ only in what is bought, never in what an hour costs.

Options are **alternatives, not phases.** They are not summed — each is a complete plan
for the same engagement at a different investment, and the client picks one. The output
must make that unmistakable, or someone will read three options as a $22,000 proposal.

### What varies between options

Most of a roadmap describes the client and does not change with the investment. Only the
plan does.

| Section | Scope | Why |
|---|---|---|
| Executive Summary | Shared + recommendation | See below |
| Overview | Shared | About the client |
| Target Market | Shared | About the client |
| Brand Story | Shared | About the client |
| Products & Solutions | Shared | About the client |
| Competition | Shared | About the client |
| **Goals** | **Per option** | What you can commit to depends on what is bought |
| **Roadmap Phases** | **Per option** | Sequence changes with capacity |
| **Quarterly Initiatives** | **Per option** | |
| **Annual Plan** | **Per option** | The monthly task rows |
| **Hours Plan** | **Per option** | Replaces Points Plan on this path |

**Goals being per-option is the most important line in this table.** It is what stops a
roadmap promising the same outcomes at three different prices — the exact failure the
retainer model opens with. It also makes the accountability ladder concrete: Execute goals
are delivery goals, Perform adds the leading indicators we control, Grow owns the plan and
the measurement behind it. Three options with identical goals would be three prices for
one promise.

**Executive Summary needs a decision.** The body is shared, but the retainer model says
the AGE should end on a determination — *"Your roadmap requires $9,000 a month. That's
Perform."* If that sentence belongs in the roadmap, the summary carries a short
recommendation block naming the options and which one is recommended, and is therefore not
purely shared. Recommended, but it is a judgement about how the proposal should read.

**Generation cost.** Shared sections are generated once, not once per option. Three
options is closer to 1.5× a single roadmap than 3×, because the expensive work — synthesis
of research into target market, competition, and brand story — does not repeat.

### Validation across options

Every option is validated **before** any generation runs, and generation refuses if any
option fails. Partially generating and silently dropping an invalid option would present
a two-option proposal where three were asked for, with nothing saying why.

Each option is checked independently against the hard rules below, plus one that only
exists because options are explicit:

| Rule | Message |
|---|---|
| Tier does not match budget band | "$4,000 is Execute. Grow starts at $12,000." |
| More than three options | "A roadmap carries at most three options." |

The bands are $4,000–5,900 Execute, $6,000–11,900 Perform, $12,000+ Grow. This is the
retainer model's "tiers are arithmetic, not policy" made enforceable — a strategist who
wants Grow treatment raises the budget rather than relabelling the tier.

### After the client chooses

The selected option is what becomes the plan of record. Nothing is written back to the
contract at generation time; the choice is recorded on the approved deliverable.

---

## Eligibility matrix

Which categories a program may draw from. Configuration, not code.

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

Strategy & account management runs under every engagement and is never sold on its own —
it is the overhead reserve, not a program category. Digital PR is subcontracted and
billed separately; it never consumes hours.

**Category granularity.** ClickUp stores 16 categories; this matrix uses 12. Roll up at
display time — `SEARCH & DISCOVERY` into Content, `ACCOUNT MANAGEMENT` into Strategy —
and keep the underlying value at full granularity. Splitting SEO back out later then
costs nothing.

---

## Guardrails

Two classes. Hard rules refuse; soft rules flag and let the strategist decide.

### Hard — refuse to generate, with a message naming the fix

| Rule | Message |
|---|---|
| Program count exceeds tier | "$6,000 is Perform — two programs. Select which two." |
| Pursuit selected at Execute | "Pursuit starts at Perform, paired with Authority or Reach." |
| Pursuit selected alone at any tier | "Pursuit is never sold on its own." |
| Category outside the sold programs' matrix | Names the category and the programs that would include it |
| `dollar_per_hour` unset | "Set the contract's hourly rate before generating." |
| Any month's allocated hours exceed capacity | Names the month and the overage |

These are refusals, not warnings. The retainer model's core complaint is that scope gets
negotiated deal by deal; a generator that declines is the only thing that makes the tiers
real rather than advisory.

### Soft — generate, flag on the row or month

| Flag | Threshold | Why |
|---|---|---|
| **Row scheduled well below its baseline** | `hours < baseline_hours × 0.5` and `adjustment_reason` is null | The direct guard against "one hour each". `Develop SEO blog post` at 1 hour against a 5.08-hour baseline will not produce the deliverable. Soft, because a shorter piece legitimately takes less — writing the reason answers the flag. Uses only what the library already knows, so it needs no new taxonomy. |
| **Month spread too thin** | Active categories > `program_hours / 6` | Catches the case the tier gate cannot: nine categories at 2.4 hours each inside a single program. Six hours is roughly the smallest library item that produces something substantial. |
| Overhead under-reserved | Strategy + AM < 9.8 hrs/month | Coordination is being borrowed against |
| Month under capacity | Allocated < 85% of available | Unspent capacity accrues as rollover |
| Breadth exceeds archetype | Active categories > tier's shape (see below) | Spread, not focus |
| Content share off-pattern | Authority < 35% or > 65%; Reach > 45%; Pursuit > 40% | Retainer model's composition check |

Soft flags must not block. The strategist may have a reason, and the goal is a draft they
can defend — not a machine that says no.

### Execute archetypes

Execute is one program run **deliberately narrow**, not one program spread across its
eligible categories. Authority has five eligible categories; free composition at 22.2
hours gives each about four, which is the exact failure the tier structure exists to
prevent.

At Execute, generate from a named shape rather than composing freely:

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

Perform (38.2 hrs) composes more freely within its two programs. Grow (86.2 hrs) can run
full breadth.

### Month one

Setup work lands in month 1 and is heavy relative to Execute's capacity. An
Execute / Reach engagement opens with `Set up paid media` (5.5h) and `Set up performance
reporting` (7.0h) — 12.5 hours, **56% of the month's program capacity.**

Month 1 therefore delivers roughly half a steady-state month of production. That is the
retainer model's ramp period showing up in the arithmetic rather than a fault, but the
generator should say so in the roadmap's own narrative so the SOW can carry it. A client
expecting two pieces in month one gets one.

---

## Generation payload

`processor.ts` branches on `customer_display_type`. The points path is untouched.

New submission fields on `DeliverableSubmission`, mirroring the roadmap block that
already assembles `research`, `transcripts`, `process_library`, and `previous_roadmap`:

```ts
/** Program roadmap: contract blended rate, one value across every option */
hourly_rate?: number;
/** Program roadmap: the priced options to generate, one plan each. Max 3. */
roadmap_options?: Array<{
  option_id: string;
  label: string;                     // "Execute — Authority" etc, shown to the client
  tier: 'execute' | 'perform' | 'grow';
  programs: Array<'authority' | 'reach' | 'pursuit'>;
  monthly_budget: number;
  hours_available: number;           // monthly_budget / hourly_rate
  overhead_hours: number;            // reserved for strategy + account management
  program_hours: number;             // hours_available - overhead_hours
}>;
/** Program roadmap: category eligibility per program, so options are enforced per option */
program_matrix?: Record<'authority' | 'reach' | 'pursuit', string[]>;
/** Program roadmap: library items with baseline hours, union of all options' eligible categories */
process_library_hours?: Array<{
  task: string;
  description: string;
  stage: string;
  service_category: string;
  baseline_hours: number;
}>;
```

The backend sends the **union** of items eligible across all options, plus the matrix.
Master Marketer applies the matrix per option, so a Reach-only option cannot draw an
Authority category even though that category is present in the payload for another
option.

The backend filters `process_library_hours` to categories eligible for the sold programs
before submitting. Master Marketer never sees ineligible items, so it cannot propose
them.

**Master Marketer may deviate from `baseline_hours`** where the research or instructions
justify it — three systems and custom attribution should raise `Manage performance
reporting` well above its 1-hour baseline. When it does, it must set `hours` and populate
`adjustment_reason`. That is the whole point of leaving points: the estimate flexes to
the client.

---

## Expected output

`content_structured` follows the existing roadmap shape — months containing task rows —
with hours replacing points and the fields above added per row.

```jsonc
{
  "hourly_rate": 125,                   // one rate, every option
  "options_are_alternatives": true,     // never summed; the client picks one

  // Generated once. Describes the client, not the investment.
  "shared": {
    "executive_summary": { "body": "…", "recommended_option_id": "opt_perform_authority_reach" },
    "overview": "…",
    "target_market": { /* … */ },
    "brand_story": "…",
    "products_solutions": { /* … */ },
    "competition": { /* … */ }
  },

  "options": [
    {
      "option_id": "opt_execute_authority",
      "label": "Execute — Authority",
      "tier": "execute",
      "programs": ["authority"],
      "monthly_budget": 4000,
      "hours_available": 32.0,
      "overhead_hours": 9.8,
      "program_hours": 22.2,

      "goals": { /* OKRs scaled to what this option can commit to */ },
      "roadmap_phases": [ /* … */ ],
      "quarterly_initiatives": [ /* … */ ],
      "hours_plan": { /* … */ },

      "annual_plan": {
        "months": [
          {
            "month": 1,
            "hours_available": 22.2,
            "hours_allocated": 21.5,
            "tasks": [ /* row schema above */ ],
            "flags": [
              { "level": "soft", "code": "ramp_month", "message": "12.5 hrs of setup; production is roughly half a steady-state month." }
            ]
          }
        ]
      }
    },
    {
      "option_id": "opt_perform_authority_reach",
      "label": "Perform — Authority + Reach",
      "tier": "perform",
      "programs": ["authority", "reach"],
      "monthly_budget": 6000,
      "hours_available": 48.0,
      "overhead_hours": 9.8,
      "program_hours": 38.2,
      "goals": { /* … */ },
      "annual_plan": { "months": [ /* … */ ] }
    }
  ]
}
```

---

## Frontend contract

The points roadmap's editing UI is already correct in shape — editable task, description,
stage and value per row, Add Task, Add Month, delete, and in-memory edit tracking until
save. The hours version is the same table with four changes:

1. **Pts → Hrs**, accepting one decimal place
2. **Month header** shows `hours allocated / hours available` rather than a bare total, so
   going over is visible while editing
3. **Total budget band** shows hours available, hours allocated, and variance — plus the
   dollar value at the contract rate, since that is the number under discussion
4. **Flags render inline** on the row or month they belong to
5. **Options switch only the plan sections.** Executive Summary through Competition render
   once; Goals, Roadmap Phases, Quarterly Initiatives, Annual Plan and Hours Plan switch
   with the selected option. In the contents sidebar the shared sections stay put and the
   option-scoped ones re-render, so the reader is not made to feel they changed document.
   The UI must never show a combined total across options; they are alternatives, and a
   summed figure would misrepresent the proposal.

Technology rows never appear — technology is billed outside the fee and never consumes
hours.

**When an edit pushes a month over capacity, let it go red rather than blocking the
keystroke.** The number the strategist is reaching for is usually right; what needs to
happen is the budget conversation, not a rejected input.

Where `baseline_hours` and `hours` differ, show the baseline quietly beside the field so
the strategist can see what standard was.

---

## Sequencing

1. Eligibility matrix as configuration
2. `processor.ts` branch on `customer_display_type` + payload assembly
3. Master Marketer `/api/generate/program-roadmap`
4. Lovable: option input rows on the generation form, option switch in the viewer, editing UI

**No schema change, no ClickUp work, no data migration.** Both contract fields already
exist, and the library already carries everything the generator needs — hours, service
category, description. Nothing at any step touches an existing contract.

---

## Open

- **Is $125 the standard rate with a defined ladder above it** ($150 senior-weighted,
  $175 custom build), and who may move a contract off it? A rate that only ever lands at
  $125 re-freezes the variable this change exists to free.
- **Are Authority-production and pure-paid the only Execute archetypes?** Writing the list
  down is what stops fifteen disciplines being promised at $4,000.
- **Does the rollover cap apply to hours?** Utilization runs at 1.12 today. That is a
  delivery-discipline problem, not a pricing one, and it persists under hours unless the
  cap goes into the MSA.
- **Four library items still carry no estimate**, and `Set up ABM` exists twice at 9h and
  18.08h. Worth a pass before the generator reads from this data.
- **Does the Executive Summary carry a recommendation** naming which option we advise, or
  does it present the options neutrally? The retainer model's "the roadmap names the
  number" argues for a recommendation; presenting neutrally puts the choice entirely with
  the client.
