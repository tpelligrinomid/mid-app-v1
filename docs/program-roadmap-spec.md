# Program Roadmap — Generator Spec

Hours-based, program-based, tier-based roadmap. Runs **alongside** the existing points
roadmap; nothing about the points path changes.

---

## Scope

**New engagements only.** Existing contracts stay on `pricing_model = 'points'`, keep
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

Two columns already exist and need no work:

- `dollar_per_hour` — the blended rate. **Populated on 3 of 36 contracts today; this is
  the hard blocker.** The generator has nothing to divide by without it.
- `customer_display_type` — `'points' | 'hours' | 'none'`, already drives client display.

New:

```sql
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS pricing_model text DEFAULT 'points',   -- 'points' | 'programs'
  ADD COLUMN IF NOT EXISTS tier text,                             -- 'execute' | 'perform' | 'grow'
  ADD COLUMN IF NOT EXISTS programs text[];                       -- {'authority','reach','pursuit'}
```

`pricing_model` selects the generation path. Defaulting to `'points'` means every
existing contract keeps its current behaviour with no data migration.

`tier` and `programs` are written by the strategist at roadmap submission and persisted
on approval, so downstream reporting knows what was sold.

### `compass_process_library`

`time_estimate_ms` is the baseline effort and is already synced (81 of 85 items
populated, rolled up from subtasks to match ClickUp's displayed total).
`service_category` is already synced and classified.

One field is missing, and it matters for scheduling:

```sql
ALTER TABLE compass_process_library
  ADD COLUMN IF NOT EXISTS cadence text;   -- 'one_time' | 'monthly' | 'per_deliverable'
```

The library has three cadences and they schedule differently:

| Cadence | Items | Scheduling rule |
|---|---|---|
| `one_time` | 13 | Month 1 only. "Set up paid media", "Set up SEO" |
| `monthly` | 10 | Every month, unchanged. "Manage paid media", "Manage SEO" |
| `per_deliverable` | 48 | Scheduled as needed. "Develop SEO blog post" |

**Source it from a ClickUp dropdown**, same pattern as Service Category. Name-prefix
derivation (`Set up…` / `Manage…` / everything else) is correct for the current 85 items
and can serve as an interim fallback, but it is guessing from a string and will break the
first time someone names an item "Ongoing SEO management". Populate the field.

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
| **Category maintained, not delivered** | A category with `monthly` rows but no `per_deliverable` row that month | The direct guard against three categories at an hour each. A 1-hour `Manage performance reporting` line is fine when something in that category ships; three manage lines and no deliverable means the month produces nothing. |
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

| Task | Cadence | Hours |
|---|---|---|
| Manage content | monthly | 0.75 |
| Manage SEO | monthly | 5.00 |
| Manage performance reporting | monthly | 1.00 |
| Develop SEO blog post × 2 | per_deliverable | 10.16 |
| Optimize existing SEO article | per_deliverable | 4.58 |
| | | **21.49** |

**Execute / Reach** — the client already has content and needs paid run

| Task | Cadence | Hours |
|---|---|---|
| Manage paid media | monthly | 4.00 |
| Manage performance reporting | monthly | 1.00 |
| Develop Google Ads text ad creative package | per_deliverable | 5.33 |
| Develop image ad creative package | per_deliverable | 9.83 |
| | | **20.16** |

Perform (38.2 hrs) composes more freely within its two programs. Grow (86.2 hrs) can run
full breadth.

### Month one

`one_time` items land in month 1 and are heavy relative to Execute's capacity. An
Execute / Reach engagement opens with `Set up paid media` (5.5h) and `Set up performance
reporting` (7.0h) — 12.5 hours, **56% of the month's program capacity.**

Month 1 therefore delivers roughly half a steady-state month of production. That is the
retainer model's ramp period showing up in the arithmetic rather than a fault, but the
generator should say so in the roadmap's own narrative so the SOW can carry it. A client
expecting two pieces in month one gets one.

---

## Generation payload

`processor.ts` branches on `pricing_model`. The points path is untouched.

New submission fields on `DeliverableSubmission`, mirroring the roadmap block that
already assembles `research`, `transcripts`, `process_library`, and `previous_roadmap`:

```ts
/** Program roadmap: hours available per month, after overhead reserve */
hours_budget?: number;
/** Program roadmap: contract blended rate, for value display */
hourly_rate?: number;
/** Program roadmap: tier gates program count and archetype breadth */
tier?: 'execute' | 'perform' | 'grow';
/** Program roadmap: programs sold, chosen by the strategist at submission */
programs?: Array<'authority' | 'reach' | 'pursuit'>;
/** Program roadmap: reserved monthly hours for strategy + account management */
overhead_hours?: number;
/** Program roadmap: library items with hours and cadence, filtered to eligible categories */
process_library_hours?: Array<{
  task: string;
  description: string;
  stage: string;
  service_category: string;
  cadence: 'one_time' | 'monthly' | 'per_deliverable';
  baseline_hours: number;
}>;
```

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
  "total_hours_budget": 266.4,
  "hourly_rate": 125,
  "tier": "perform",
  "programs": ["authority", "reach"],
  "months": [
    {
      "month": 1,
      "hours_available": 38.2,
      "hours_allocated": 37.4,
      "tasks": [ /* row schema above */ ],
      "flags": [
        { "level": "soft", "code": "ramp_month", "message": "12.5 hrs of one-time setup; production is roughly half a steady-state month." }
      ]
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

Technology rows never appear — technology is billed outside the fee and never consumes
hours.

**When an edit pushes a month over capacity, let it go red rather than blocking the
keystroke.** The number the strategist is reaching for is usually right; what needs to
happen is the budget conversation, not a rejected input.

Where `baseline_hours` and `hours` differ, show the baseline quietly beside the field so
the strategist can see what standard was.

---

## Sequencing

1. Populate `dollar_per_hour` across contracts — **blocks everything else**
2. Add the `cadence` dropdown in ClickUp and let the library sync carry it
3. Migration: `pricing_model`, `tier`, `programs` on contracts
4. Eligibility matrix as configuration
5. `processor.ts` branch + payload assembly
6. Master Marketer `/api/generate/program-roadmap`
7. Lovable editing UI

Steps 1 and 2 are data work and can start now. Nothing downstream is worth building until
the rate is populated, because the generator has nothing to divide by.

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
