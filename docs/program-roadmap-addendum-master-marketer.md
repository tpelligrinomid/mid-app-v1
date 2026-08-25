> **SUPERSEDED by `program-roadmap-spec.md` v5.** Kept for history only; do not build from this.

# Addendum for Master Marketer — what changed after your v2 review

All four of your asks are in. Two of them changed shape slightly, and **one thing changed
that you should know about before building the executive summary call**, because it came
from the frontend after your review and it removes work you were planning.

Spec is v3. This addendum is the delta only.

---

## The one that changes your build: the recommendation is now an input

You flagged that `recommended_option_id` must be validated against real option ids, because
a hallucinated one leaves the downstream fallback chain unresolvable.

**It is no longer generated.** The generation form now has the strategist pick the
recommended option, and the backend resolves it and sends it to you:

```jsonc
"recommended_option_id": "opt_perform_authority_reach"
```

So the final call **writes the rationale for a choice already made** rather than making the
choice. Two consequences:

- No validation needed — the id is one you were given.
- The exec summary still runs last, because the rationale has to compare against the other
  options as generated.

This is a better division: the strategist knows the client, and it removes the one
hallucination that had nowhere safe to fail.

---

## Your four asks, as implemented

**§1 — overhead is (b), reserved outside the plan.** You allocate against `program_hours`
and emit no strategy or account management rows. `overhead_under_reserved` is **removed from
the vocabulary**, not shipped dead.

One addition: the backend **injects a standard overhead block after generation** so the
client still sees the reserve as its own line. The retainer model's value story depends on
that reserve being visible rather than absorbed, and a client looking at 22.2 hours against
a $4,000 fee will reasonably ask where the rest went. Nothing about it is yours to generate.

`config.overhead_in_plan` is `false` if you want to assert on it.

**§2a — tier cap, with one change: it is 4, not 3.** Execute / Reach rolls up to Paid media,
Analytics & reporting, Content and Design — four categories. A cap of 3 would flag the
archetype the spec recommends, which is the failure you warned about with the rollup.

Only Execute is capped. Perform composes more freely by design, and 86 program hours across
nine eligible categories is ~9.5 hours each, which is legitimate.

```
max_categories = min(program_hours / 6, tier_cap)
tier_cap: execute 4 · perform null · grow null
```

Served as `config.flag_codes.month_thin_spread.tier_category_cap`.

**§2b — archetypes are restated in three classes** in spec v3, with your month-one
arithmetic as the reason. Production-scales-to-fill is written as a requirement rather than
implied, along with the consequence you named: a fixed 21.5 at the top of Execute sits at
56% allocated and would trip `month_under_capacity` every month.

**§3 — flag envelope and vocabulary.**

```ts
{ level: 'soft', code, message, severity?: 'review' | 'notice', option_ids?: string[] }
```

`row_above_baseline` added at `baseline × 2` with no reason — you were right that the
direction which inflates a client's invoice was the unpoliced one. Both baseline flags skip
`process_id: null` rows. `config.cross_option_flags` lists the two that attach at document
level.

---

## Smaller things you raised, and where they landed

| Your point | Landed |
|---|---|
| `hours_available` means two things | Month fields renamed `program_hours_available` / `program_hours_allocated` |
| `total_hours` ambiguous | Now `total_hours_allocated` + `total_hours_available` |
| `stage` should be the enum | Typed `'Foundation' \| 'Execution' \| 'Analysis'` in the payload |
| Repair loop needs a terminal state | Two attempts, then emit with a loud flag — your recommendation |
| Separate `ProgramRoadmapInputSchema` | Agreed; no fake `points_budget` |
| Gantt categories differ per option | Confirmed. Months 4–12 directional, introducing no category the priced quarter lacks |
| Lovable response missing from `docs/` | It is there — `program-roadmap-review-response-from-lovable.md`, committed in `b40b8fa`. Your checkout was stale |

---

## Two new fields on each option

From the generation form, echoed through and onto the generated document:

```jsonc
"term_months": 12,        // proposed contract length; narrative only
"commitment": "annual",   // monthly | quarterly | semiannual | annual
"notes": "..."            // strategist free text, generation context
```

`term_months` and `commitment` should inform the **term and renewal framing** in the
narrative. Neither affects capacity, tier, or any flag.

Note the naming: `commitment` here is the **contract** commitment. The goal commitment
ladder from §3 of the spec is now `goal_commitment_ladder` — they were colliding on the word
and the frontend had already wired the wrong one into a picker.

---

## `program_allocation` is derived, not asked for

You suggested the form collect it at Perform and Grow. It is instead **derived by the
backend** from the option's `programs` array: where a category is eligible for more than one
sold program, it goes to the **first program in the strategist's own ordering**.

Deterministic and reviewable, and it keeps a question off a form that is already long. The
limitation you identified stands unchanged — the map still cannot express Content split
across Authority and Reach — and it is documented in the spec as a v1 simplification.

Worth knowing the ordering is load-bearing: reordering `programs` changes the allocation,
and therefore `content_share_off_pattern`. If that turns out to matter in practice, making
it an explicit input is a small change.

---

## Config endpoint

`GET /api/compass/roadmap-config` is live and is the same module the backend validates
against. **Payload is snake_case throughout** — `tier_bands.execute.min_capacity_hours`,
`flag_codes.month_thin_spread.hours_per_category`, and so on.

`monthly_hours` is now the form's primary input rather than a fee — tier bands are hours, so
the strategist picks capacity and the fee falls out of the contract rate. You still receive
`monthly_budget`, `hours_available` and `program_hours` fully resolved; nothing changes on
your side.
