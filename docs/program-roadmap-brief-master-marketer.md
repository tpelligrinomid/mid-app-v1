# Brief for Master Marketer — Program Roadmap generator (v2)

**Your review is accepted in full.** Every item you raised is now in the spec. This brief
replaces the first one; build against `docs/program-roadmap-spec.md` v2.

Answers to your five open questions are below, then what changed, then the two things still
on you.

---

## Your five decisions, answered

**1. Three months of task rows, or twelve?** — **Three.** You were right that twelve across
three options is 36 month-blocks, strains the output ceiling, and is detail nobody reads in a
sales proposal. `hours_plan` carries three months; `annual_plan` stays the 12-month Gantt.

**2. Is `hours_plan` the row container and `annual_plan` the Gantt?** — **Yes, confirmed, and
this was my error.** I merged two sections that have always been separate. `hours_plan`
mirrors `points_plan` field for field so the viewer's editing table binds to the shape it
already binds to. Existing key names are kept exactly — `products_and_solutions`,
`roadmap_phases`, `quarterly_initiatives`, `target_market`, `brand_story`, `competition`,
`goals` — plus `type`, `title`, `summary`, `metadata` at the top level.

**3. Is the rate fixed at $125 for v1?** — **The rate is fixed per contract, and the tier
bands are now defined in hours rather than dollars.** Your $175 arithmetic exposed a real hole:
under dollar bands, two Execute contracts differ by 40% in delivered hours and the archetypes
don't fit at all. Bands are now capacity hours:

| Tier | Capacity hours | Program hours | @ $125 | @ $175 |
|---|---|---|---|---|
| Execute | 32 – 47.9 | 22.2 – 38.1 | from $4,000 | from $5,600 |
| Perform | 48 – 95.9 | 38.2 – 86.1 | from $6,000 | from $8,400 |
| Grow | 96+ | 86.2+ | from $12,000 | from $16,800 |

Published pricing reads "from $4,000", so a higher floor at a higher rate breaks no promise.
The archetypes are now stated as **task lists, not fixed totals**, and they fit Execute's
22.2-hour floor at any rate.

**4. Soft flags — yours or the backend's?** — **Backend.** Your reasoning stands: deterministic,
identical on regeneration, thresholds movable without a prompt redeploy. You keep the ramp
narrative in the phase text. The backend attaches `flags[]` and owns the closed `code`
vocabulary (Lovable needs it fixed to style on).

**5. Does `commitment_type` go into the goals schema?** — **Yes.** This was the best thing in
your review — it turns the requirement I was least confident about into something checkable.
`'output' | 'leading_indicator' | 'business_outcome'`, constrained by tier, with your two
supporting rules: benchmarks come from the shared research synthesis so all options share one
baseline, and targets increase monotonically with tier. Both are now flag codes
(`goal_commitment_mismatch`, `goal_target_not_monotonic`).

---

## Everything else you raised, and where it landed

| Your point | Resolution |
|---|---|
| Boilerplate is injected, not generated | Stated in the spec — `section_description` from `ROADMAP_BOILERPLATE`, per option |
| Exec summary can't be generated up front | Confirmed: it runs **last**, as a short final call |
| Options must generate in ascending tier order, each seeing prior | Adopted |
| `maxDuration` sized for four calls | Noted as yours to raise |
| Month-over-capacity can't be a pre-generation refusal | Now a **repair loop** against the offending option, never a refusal |
| `ramp_month` + `month_under_capacity` double-fire | `month_under_capacity` is suppressed when `ramp_month` fires |
| Thin-spread needs a granularity decision | Counts run on the **12 rolled-up** categories, not the 16 |
| `program` unverifiable, content-share flag self-satisfying | Each option carries a `program_allocation` map, decided once; row `program` derives from it |
| Don't send `technology_items` | Removed. You get `technology_monthly` and `total_monthly` only |
| `previous_roadmap` undefined for options | Backend flattens the **selected option** into the flat shape before submitting, and passes nothing when none is selected |

---

## Two things that remain yours

**Output validation.** Your catch, and it's the right one. `GeneratedRoadmapOutput` is cast,
not validated, and nothing checks `month_total` against its rows. Survivable for points, not
once those sums multiply by a rate into a client-facing dollar figure. Real output schema plus
a repair re-ask ships with this path.

**The per-option call structure.** Calls 1–2 unchanged, calls 3–4 merged and repeated per
option in ascending tier order, exec summary last. Six calls for three options.

---

## What I'd still like from you

1. Anything in the hours-denominated tier bands that breaks a prompt assumption — the
   archetypes are now task lists rather than totals, and I want to be sure that reads cleanly
   when you're composing a month against a floor rather than a fixed target.
2. A first cut of the flag `code` values you'd want to see in the narrative versus the ones
   that are purely backend arithmetic, so Lovable can style them.
3. Confirmation that three months of rows plus a 12-month Gantt is what you'll emit per
   option, and that nothing in the Gantt needs to differ per option beyond what the plan
   implies.
