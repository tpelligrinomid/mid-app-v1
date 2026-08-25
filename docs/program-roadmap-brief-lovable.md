# Brief for Lovable — Program Roadmap (v2)

**Your review is accepted in full.** Every item you raised is now in the spec, including all
nine in your "what we need to proceed" table. This brief replaces the first one; build
against `docs/program-roadmap-spec.md` v2.

---

## Your nine items, answered

| # | Item | Answer |
|---|---|---|
| 1 | Roadmap hours authored, never re-derived through `useDisplayUnits` | **Confirmed and written into the spec as a hard rule.** See below. |
| 2 | `"schema": "program_roadmap_v1"` discriminator | **Adopted.** The viewer branches on `schema`, never on the contract. |
| 3 | Which option downstream generators read | **Your proposed rule, adopted verbatim:** `selected_option_id` ?? `recommended_option_id` ?? refuse. Never `options[0]`. |
| 4 | Tier bands + eligibility matrix exposed as data | **Backend will publish them**, along with the constants (0.78, 9.8, $129). No second hardcoded copy. |
| 5 | Closed vocabulary for flag `code` values | **Published — eight codes, in the spec.** Backend computes and owns them. |
| 6 | Technology price resolution order | **Assignment override wins, catalog default is the fallback** — `COALESCE(assignment, catalog)` on every field. Backend resolves. |
| 7 | `one_time` cadence handled separately | **Adopted.** New `technology_one_time` field per option; `total_monthly` stays strictly monthly. |
| 8 | Month as number + optional label | **Adopted.** `month: 1` plus `month_label: "Month 1"`. |
| 9 | Library hygiene pass | **Now step 1 of sequencing**, ahead of any build. Both you and Master Marketer flagged it as blocking quality. |

---

## The points-as-ledger architecture is confirmed and written down

You were right, and it's now stated explicitly in the spec so nobody re-litigates it:

1. ClickUp records hours. 2. The team converts to points via a ClickUp calculated field.
3. Points sync to the database; invoices, credits, task logs and burden all reconcile in
points. 4. The frontend converts points back to hours at display time using the contract rate.

**The program roadmap is an estimate instrument and changes none of that.** Billing continues
to run on the points ledger.

Which makes your 1.1 concern a hard rule in the spec: **roadmap hours are authored on the
document and must never pass through `useDisplayUnits`.** That helper answers a billing
question (`points × 100 / rate` = 0.80 h/pt at $125); the library's 0.78 answers an effort
question. Both are right about different things, and any screen mixing them quotes two numbers
for one task. Centralising the constants in `src/lib/hoursModel.ts` is the right call — the
backend will publish them so that module reads rather than hardcodes.

---

## What changed since v1 that affects you

**Tier bands are now hours, not dollars.** Master Marketer found that at $175 an Execute
contract buys 22.9 capacity hours against 32 at $125 — two contracts on one tier differing by
40%, with the archetypes not fitting at all. Bands are now capacity hours (Execute 32–47.9,
Perform 48–95.9, Grow 96+), so form validation checks `monthly_budget / dollar_per_hour`
against an hours band, not a dollar band. Published pricing says "from $4,000", so the floor
rising with the rate breaks no promise.

**`annual_plan` and `hours_plan` are separate sections** — my error in v1, which merged them.
`annual_plan` is the 12-month Gantt; `hours_plan` holds the editable rows and mirrors
`points_plan` field for field. Your `PointsPlanEditor` binds to a shape it already knows.

**Three months of rows, twelve months of Gantt.** Matches the points path.

**Goals carry `commitment_type`** — `'output' | 'leading_indicator' | 'business_outcome'`,
constrained by tier. This needs to exist in the viewer, not just the schema: it's what makes
the difference between options legible to a client rather than three prices for one promise.

**Executive summary generates last** and carries `recommended_option_id` plus a rationale —
which is also the fallback your downstream-generator rule depends on.

---

## Your technology corrections, all adopted

`client_billable_override` was in the spec already but missing from the brief you read — sorry,
that's on me. The full resolution order is now explicit in both. Your three additions are in:

- **`is_active`** filtered from the picker
- **`one_time` cadence** reported as a separate `technology_one_time` figure, never amortised
- **A billable item with a null client price fails loudly**, never contributes $0

Everything else you confirmed as correct stayed as written.

---

## Effort items acknowledged

The **dual-shape adapter** is called out in the spec as the largest single frontend item,
roughly the size of the viewer changes themselves, touching the renderer, markdown export,
public share view and client viewer. Legacy documents wrap as a single unnamed option; program
roadmaps pass through. No migration of stored documents.

**Markdown export contains all options, clearly delimited** — your recommendation, adopted,
since it feeds LLMs and SOW drafting where the comparison is the point.

**The TOC re-derivation** is named as the fiddly part of the viewer work rather than assumed to
fall out of the section change.

Your snapshot point is now a spec rule: `hourly_rate`, `hours_available`, `hours_allocated`
and `overhead_hours` are **read from the document, never recomputed**. A viewer deriving
capacity from `monthly_budget / dollar_per_hour` would rewrite a signed roadmap the moment the
contract rate changed.

---

## Suggested sequence

Your proposed order stands: **adapter → viewer option switch → generation form + technology
picker → hours editing UI.**

The backend will have the bands, matrix, constants and flag vocabulary published as data before
you need them for form validation — say the word if you want that earlier than the adapter
work, and I'll move it up.

---

## What I'd still like from you

1. Does the hours-band change alter your form validation work materially — you're now checking
   a derived capacity figure rather than a raw dollar amount.
2. Is `commitment_type` renderable in the goals table without restructuring it?
3. Anything in the eight flag codes you'd want split, merged, or renamed before the backend
   fixes the vocabulary.
