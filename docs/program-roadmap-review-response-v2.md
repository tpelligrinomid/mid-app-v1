# Program Roadmap — Master Marketer's response, v2

Reviewed against spec v2 and brief v2, and against the current generator:
`trigger/generate-roadmap.ts`, `src/prompts/roadmap.ts`, `src/types/roadmap-output.ts`,
`src/types/roadmap-input.ts`.

**v2 resolves everything from the first pass.** Three of the four decisions we'd have made
the same way; the hours-denominated tier bands are better than what we proposed, because
they hold the scope promise constant instead of the fee.

This document covers one contradiction that has to be settled before a flag can ship, then
the three things the brief asked for, then five smaller implementation notes.

Nothing here blocks us starting.

---

## 1. Blocking: `overhead_hours` is defined twice, incompatibly

`program_hours = hours_available − overhead_hours` subtracts overhead **before** allocation.
Strategy & account management is explicitly "not a program category — it is the overhead
reserve." And the example month block carries `"hours_available": 22.2`, which is program
hours, not the option's 32.0.

Taken together, the generator never emits a strategy or AM row. But:

> `overhead_under_reserved` — strategy + AM below `overhead_hours`

fires whenever those rows are absent — which is **every option, every month, always**. No
valid plan can satisfy it.

The two documents point at different resolutions:

| | Behaviour | Evidence |
|---|---|---|
| **(a)** Overhead is in the plan | Model emits rows with `program: 'overhead'` totalling ≥ 9.8 and allocates against 32.0 | The row schema's `'overhead'` enum value |
| **(b)** Overhead is reserved outside the plan | Model allocates only 22.2 and never emits overhead rows; backend injects a synthetic overhead block for display | The month example's `hours_available: 22.2` |

**We recommend (b).** It keeps the model composing only what it can actually choose, and
"reserve 9.8 hours for coordination" is not a decision worth spending a generation call on.
If (b) is taken, `overhead_under_reserved` should be **removed from the closed vocabulary**
rather than shipped dead — a flag that always fires trains strategists to ignore the flag
column.

### Same neighbourhood: `hours_available` means two things

It is `32.0` on the option and `22.2` on the month. One key, two meanings, one document.

Request: rename the month-level field to **`program_hours_available`** (and
`program_hours_allocated` for symmetry). Otherwise the first strategist to compare the two
numbers files a bug, and they will be right to.

---

## 2. What the hours-denominated bands break

The bands themselves are sound, and "published pricing reads from $4,000" resolves the
promise question cleanly. Two things downstream of them do not survive the change.

### 2a. The thin-spread flag stops protecting Execute at the top of its band

`month_thin_spread` fires when active rolled-up categories exceed `program_hours / 6`. That
threshold now scales across a band that is 1.7× wide:

| Execute at | Program hours | Threshold | Max categories | Authority has |
|---|---|---|---|---|
| Floor | 22.2 | 3.7 | 3 | 5 |
| Ceiling | 38.1 | 6.35 | 6 | 5 |

At the top of Execute the flag **cannot fire for a single-program option** — Authority only
has five eligible categories to spend. Reach is worse: seven eligible categories against a
threshold of 6.35, so a six-way spread passes silently.

So the guardrail that enforces "Execute is one program run deliberately narrow" evaporates
precisely where the archetype has ~16 spare hours to spread into, and precisely where the
tier is still supposed to mean one narrow program.

**Proposed fix — floor the threshold by tier, not by hours alone:**

```
max_categories = min(program_hours / 6, tier_category_cap)

tier_category_cap:  execute 3   perform 5   grow uncapped
```

Narrowness then becomes a property of the tier, which is what the spec says it is, rather
than a property of the fee.

### 2b. "Task lists, not fixed totals" is right, but the list needs three classes

Composing against a floor works fine. Composing **month one** does not.

Execute / Reach setup is 12.5 hours. The archetype is 20.16. Together that is 32.7 against
22.2 of capacity — the archetype cannot run in month one at all, and a flat task list gives
the generator nothing principled to decide what to drop.

Request: state each archetype in three classes.

```
Execute / Reach
  setup       (month 1 only)      Set up paid media 5.5 · Set up performance reporting 7.0
  recurring   (every month)       Manage paid media 4.0 · Manage performance reporting 1.0
  production  (scales to fill)    Google Ads text ad package 5.33 · Image ad creative package 9.83

Execute / Authority
  setup       (month 1 only)      per library
  recurring   (every month)       Manage content 0.75 · Manage SEO 5.00 · Manage performance reporting 1.00
  production  (scales to fill)    Develop SEO blog post 5.08 · Optimize existing SEO article 4.58
```

That makes both required behaviours mechanical rather than inferred:

- **Month one** = setup + recurring + whatever production fits.
- **Higher in the band** = more production, same recurring, **same categories** — which is
  "more room and the same shape" made executable.

Without the split the generator has to guess which rows are fixed and which flex, and it
will guess differently between two options in the same document.

**One consequence worth writing into the spec:** an Execute engagement at 38.1 program hours
running the archetype's 21.5 sits at 56% allocated and trips `month_under_capacity` every
month. The production-scales-to-fill rule is what prevents that, so it needs stating
explicitly rather than being implied by "has more room."

---

## 3. Flag codes — narrative versus backend arithmetic

Three classes rather than two. Exactly one code is ours.

| `code` | Owner | In the narrative? |
|---|---|---|
| `ramp_month` | **Model + backend** | **Yes — the only one.** Month 1's phase text and month description say it in prose; the backend still emits the code so Lovable has something to style |
| `row_below_baseline` | Backend | No |
| `month_thin_spread` | Backend | No |
| `month_under_capacity` | Backend | No |
| `content_share_off_pattern` | Backend | No |
| `goal_commitment_mismatch` | Backend — **cross-option** | No |
| `goal_target_not_monotonic` | Backend — **cross-option** | No |
| `overhead_under_reserved` | — | **Remove** — see §1 |

The rest stay out of the narrative deliberately. A plan that describes its own thin spread
is a plan that should have been generated differently, and prose acknowledging a flag makes
it *harder* for the strategist to act on it — they now have to edit the copy as well as the
rows.

### Four things Lovable needs before styling

**`goal_target_not_monotonic` has no home in the envelope.** Flags attach "on the row or
month they belong to," but this one is a relation between two options. It needs a
**document-level `flags[]`**, plus `option_ids: string[]` on the envelope so the viewer can
highlight both sides of the comparison. `goal_commitment_mismatch` is per-option rather than
per-month — also homeless as the envelope stands.

Suggested envelope:

```ts
{ level: 'soft', code, message, option_ids?: string[], severity?: 'review' | 'notice' }
```

**Add `row_above_baseline`.** Upward deviation is allowed and requires `adjustment_reason`,
but only the downward direction is flagged. A row at 3× baseline with no reason is the one
that inflates a client's quote — the direction that costs money is currently unpoliced.
Suggested threshold: `hours > baseline_hours × 2` with `adjustment_reason` null.

**Both baseline flags must skip custom rows.** `process_id: null` means `baseline_hours` is
null or 0, so `row_below_baseline` either divides by zero or fires on every hand-added row.

**Two flags mean very different things to a strategist.** `content_share_off_pattern` says
*the generator composed this badly*; `row_below_baseline` after an edit says *you just did*.
Same `level: 'soft'`, opposite response. A `severity: 'review' | 'notice'` lets Lovable style
the first louder without inventing a hard level that blocks.

---

## 4. Three months of rows plus a 12-month Gantt — confirmed

Confirmed, per option. Three months of `hours_plan` rows, twelve months of `annual_plan`
Gantt. That lines up with `roadmap_phases` staying at three 90-day phases, so the whole
per-option block is internally consistent.

**On whether the Gantt differs per option: yes, and by more than "what the plan implies."**
At Execute one program runs; at Grow three do. So the Gantt's *categories* differ between
options, not only the density of its booleans. We will generate it that way.

**The thing to be deliberate about: months 4–12 are governed by nothing.** No rows price
them, no capacity check applies, no flag reaches them. Across three options that is three
unvalidated year-long projections rendered side by side — and the visual contrast between a
dense Grow Gantt and a thin Execute one is doing pricing work that no guardrail touches.

Our handling: the generator will treat months 4–12 as **directional continuation of the same
shape**, never as implied volume, and will not introduce categories in months 4–12 that the
priced quarter does not contain. Lovable should probably label the projection in the viewer
as well. Shortening the Gantt to the quarter would close this properly; we don't think it is
worth the frontend change for v1.

**One definition to pin down.** `hours_plan.total_hours: 64.5` is 3 × 21.5, so it is the sum
of *allocated*. The frontend contract wants a variance band, which needs available too.
Request `total_hours_available` alongside it, or rename to `total_hours_allocated` so the
pair is unambiguous.

---

## 5. Five implementation notes

### `program_allocation` cannot express a category split across programs

This was our suggestion in v1 and it comes back with a sharper edge. At Perform
(Authority + Reach) and at Grow, Content genuinely serves more than one program — blog posts
under Authority, ad copy under Reach, sequence copy under Pursuit. Forcing
`Content → authority` means `content_share_off_pattern` computes off a fiction at exactly the
tiers where composition matters most.

For v1 we'd keep the single-assignment map and document the limitation rather than adding
split weights — the flag is soft and the simplification is worth it. Two consequences should
be written down either way:

- Row-level `program` is **derived from the map and echoed**, not independently chosen. The
  spec should say so, or the field reads as a second, conflicting source of truth.
- `'overhead'` as a row `program` value has no entry in the allocation map. If §1 resolves to
  (b), it has no rows either, and the enum value can go.

### Who sets `program_allocation`?

It appears as an **input** on `roadmap_options`, so the generation form asks a strategist to
map categories to programs per option — before anyone has read the research. For
single-program options it is trivially derivable (every eligible category maps to that one
program) and the form should not ask at all. Only Perform and Grow need the input.

### The program path needs its own input schema

`RoadmapInputSchema` requires `points_budget: z.number().positive()`. Extending it would force
the backend to send a fake `points_budget` purely to pass validation. We'll build
`ProgramRoadmapInputSchema` as a separate schema at
`POST /api/generate/program-roadmap`; flagging so nobody plumbs `points_budget: 0`.

### `process_library_hours.stage` should be the enum

Typed `string` in the payload; the current library schema enums it to
`Foundation | Execution | Analysis`. Keep the enum so a bad value fails at the boundary
rather than producing a row the viewer cannot group.

### The repair loop needs a terminal state, and one field needs validating

"Repair against the offending option" — after how many attempts, and then what? Six calls is
expensive enough that failing the whole job on attempt three is worse than shipping the
option with an over-capacity month and a loud flag. **Our plan: two repair attempts, then
emit with a flag**, unless you'd rather it hard-fail.

Same category: `shared.executive_summary.recommended_option_id` must be validated as one of
the generated `option_id`s. It is the one hallucination that puts the downstream-consumer
rule (`selected_option_id ?? recommended_option_id ?? refuse`) into an unresolvable state.

---

## 6. Housekeeping

`program-roadmap-review-response-from-lovable.md` is referenced in the spec header but is not
in `docs/`. Worth having it in the repo — the dual-shape adapter is the item most likely to
change what we emit.

---

## What we need back

1. **§1 — is overhead (a) in the plan or (b) reserved outside it?** Everything about how the
   generator counts a month depends on the answer, and `overhead_under_reserved` lives or dies
   with it.
2. **§2a — tier caps on the thin-spread threshold?** Without them Execute's narrowness is
   unenforced above its floor.
3. **§2b — archetypes restated as setup / recurring / production?** This is what we compose
   month one and band-position from.
4. **§3 — document-level `flags[]` with `option_ids`,** plus `row_above_baseline` added to the
   closed vocabulary.

Everything else in spec v2 we are happy to build to as written.
