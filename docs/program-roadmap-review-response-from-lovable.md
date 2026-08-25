# Program Roadmap — Frontend Review Response

**From:** MiD App frontend (Lovable)
**Re:** `program-roadmap-brief-lovable.md` + `program-roadmap-spec.md`
**Status:** Review only. Nothing built. Agreement needed on items marked **DECISION** before we sequence work.

---

## Verdict

The model is sound and the split of shared vs per-option sections is the right call. We also confirm that
**points remain the underlying currency** — ClickUp hours are converted to points by the team before they
reach the database, and the frontend's points→hours display layer stays unchanged for the client portal.
Two things in the spec are wrong as written against the live app, and three are underestimated in effort.
Everything else we can build without restructuring the viewer.

The single biggest risk is not the viewer — it's that **two different hours conversions will exist in the
app at the same time** and quote different numbers for the same work. That has to be resolved first.

---

## 1. Conflicts with what already exists

### 1.1 Two hours formulas — must be reconciled (**DECISION**)

**Confirmed architecture: points remain the underlying currency everywhere.**

- ClickUp records hours, but the MiD team manually converts those hours to **points** before they land in the database.
- The database (invoices, credits, task logs, deliverables, ClickUp sync) stores and reconciles everything in points.
- The frontend converts points → hours only at display time for contracts with `customer_display_type = 'hours'`.
- Client portal metrics — hours balance, hours purchased, hours delivered, hours burden — all stay exactly as they are today.
- The Program Roadmap is an **estimate** tool; actual client billing continues to run through the existing points/hours ledger.

That said, the app already converts points→hours today, in `src/hooks/useDisplayUnits.ts`, for every contract with
`customer_display_type = 'hours'`:

```
hours = (points * 100) / dollar_per_hour
```

That formula bakes in the old **$100/point** price. At $125/hr it yields **0.80 hrs/pt**. The spec's
measured constant is **0.78 hrs/pt** (derived from library effort, not price).

These are two different claims:

- `useDisplayUnits` answers *"what did the client buy in hours at their rate?"* — a **billing** conversion.
- `0.78` answers *"how long does this task actually take?"* — an **effort** conversion.

They will disagree on every screen where both are in play (ToDos, Deliverables, client Dashboard,
Points/Hours views all run through `useDisplayUnits` today). A client on the program roadmap will see a
task quoted at 0.78 hrs in the roadmap and the same task rendered at 0.80 hrs in their task list.

**What we'd like agreed:** the program roadmap stores authored `hours` directly and must **never** be
re-derived through `useDisplayUnits`. `useDisplayUnits` stays as the legacy points→hours display layer
for points contracts only. We'll centralise both constants in one module (`src/lib/hoursModel.ts`) so
`0.78`, `9.8`, and `$129` break-even live in one place and can be recomputed when the library changes.

### 1.2 Routing off `customer_display_type` is fragile (**DECISION**)

The spec routes the viewer on `contracts.customer_display_type`. Problem: that field is a **presentation**
setting a human can change in the contract UI at any time. Flip an hours contract to `'points'` after a
program roadmap is generated and the viewer will try to render an options document through the flat
points renderer — that's a blank section list, not a graceful fallback.

`content_structured` needs to be self-describing. Please emit a discriminator on the document:

```jsonc
{ "schema": "program_roadmap_v1", "hourly_rate": 125, "shared": {...}, "options": [...] }
```

The viewer branches on `schema`, not on the contract. `customer_display_type` still gates *generation*
(which form you get, whether the generator will run) — that part is fine.

Also note the spec's own edge case: a contract priced in hours but displayed as `'none'` routes to the
points path. With a document-level discriminator that stops mattering for the viewer.

### 1.3 The `{shared, options[]}` shape breaks four existing consumers

Everything downstream of roadmaps today reads the **flat** `GeneratedRoadmapOutput` shape
(`data.goals`, `data.points_plan`, `data.annual_plan`, …):

| Consumer | File | Breakage |
|---|---|---|
| Markdown export | `src/lib/converters/roadmapToMarkdown.ts` | Emits nothing for the new shape; every section guard misses |
| Public share view | `src/pages/public/SharedDeliverable.tsx` | Builds its own TOC from `d.overview`, `d.points_plan`, etc. — TOC comes back empty |
| Client viewer | `DeliverableContentRenderer` → `RoadmapRenderer` | Renders an empty document rather than erroring |
| Downstream generators | Content plan / ABM plan | They read the roadmap's structured content as input context — see 1.4 |

**Our plan:** an adapter that normalises *both* shapes to one internal view model — legacy docs get
wrapped as a single unnamed option, program roadmaps pass through. Then the renderer, the markdown
converter, and the share view all consume the normalised form. No migration of stored documents, no
change to the points path's output.

That adapter is a real piece of work, and it is the honest answer to "anything more work than it looks."
It is roughly the same size as the viewer changes themselves.

### 1.4 Downstream generators need a rule for *which* option to read (**DECISION**)

Content plan and ABM plan generation use the roadmap as source context. With three options, "read the
roadmap" is ambiguous. `selected_option_id` is null until the SOW is signed — which is exactly the window
in which someone may want a content plan for the recommended option.

Proposed rule, needs your sign-off: **`selected_option_id` if set, else
`shared.executive_summary.recommended_option_id`, else refuse and tell the strategist to pick.** Silent
fallback to `options[0]` is the failure mode to avoid — it would quietly plan against the cheapest tier.

---

## 2. Shared vs per-option in the current viewer — workable, with one caveat

Yes, workable. The renderer is already section-composed and the TOC is already built from a section list
(`extractToc` / `HierarchicalToc`, sticky sidebar). Adding an option switch above the plan sections and
re-keying only those sections is a normal React change, not a restructure.

The caveat is the **contents sidebar**. Today the TOC is derived once from the document. If option A has
four roadmap phases and option B has six, the sidebar's option-scoped entries have to re-derive on switch
while the shared entries hold their position and scroll-spy state. Doable, but it's the fiddly part —
budget for it explicitly rather than assuming it falls out of the section change.

Two things we'll enforce in the UI, per the brief:

- No summed total across options anywhere. Ever. Each option card shows services / technology / total for
  **that** option only.
- `selected_option_id` collapses to one option with a persistent "compare all options" affordance, and
  writes nothing — no contract update, no `contract_technologies` insert.

---

## 3. Technology rules vs how the catalog actually behaves

Mostly right. Corrections and additions, from the live data model:

| Spec rule | Verdict | Note |
|---|---|---|
| Price from `default_client_price`, never `default_internal_cost` | **Correct** | Internal cost is already excluded from every client-facing view |
| Include only when `is_client_billable` | **Correct** | Default is `true`; the flag is on `technologies` |
| `is_agency_plan` ≠ non-billable | **Correct** | These are independent flags; agency plans are billable unless flagged otherwise |
| Multiply by `quantity`, normalise cadence to monthly | **Correct** | Cadence lives in `default_billing_cadence` on the catalog and `billing_cadence` on the assignment |
| `payment_sources` never surfaced to a client | **Correct** | It's already Owner/Admin-only in the UI |

**Missing from the spec:**

1. **`contract_technologies.client_billable_override`** exists and is a nullable boolean. It is the
   per-contract override we shipped alongside the catalog flag — so a tool can be globally non-billable
   (Dojo, AI costs) and still be billed to one specific client. Resolution order is
   `client_billable_override ?? technologies.is_client_billable`. A picker that reads only the catalog
   flag will get this wrong for exactly the accounts the override was built for.

2. **`is_active`.** The catalog carries inactive tools. Filter them out of the picker, or strategists will
   quote a platform we no longer run.

3. **One-time cadence.** Some items are `one_time` (setup / implementation fees). Amortising those into
   `technology_monthly` overstates the recurring number. Recommend `technology_monthly` covers recurring
   cadences only, and one-time items are reported as a separate `technology_one_time` figure on the
   option. The brief's `total_monthly` should stay strictly monthly.

4. **Per-assignment price overrides.** Assignments can override the catalog price. For a roadmap on a
   *prospective* engagement there are usually no assignment rows yet, so the catalog default is the right
   source — but if a contract already has assignments, the override should win. Please confirm which the
   backend resolves.

5. **Empty `default_client_price`.** The spec correctly says don't infer billability from a blank price.
   The other half of that: a billable item with a null client price should **fail loudly** in the picker,
   not silently contribute $0.

---

## 4. Things that are more work than they look

1. **The dual-shape adapter (1.3).** Largest single item. Touches renderer, markdown export, public share
   view, and the client-facing viewer.
2. **Markdown export.** `roadmapToMarkdown` is ~140 lines of flat-shape traversal and needs a full
   options-aware rewrite — including a decision on whether the export contains all three options or only
   the selected/recommended one. **DECISION** — our recommendation: all options, clearly delimited, since
   the export feeds LLMs and SOW drafting.
3. **The technology picker.** Multi-select over 73 catalog rows with billability resolution, cadence
   normalisation, quantity, active filtering, and a live per-option total. This is a small feature in its
   own right, not a form field.
4. **Editing UI capacity display.** `PointsPlanEditor` already does rows, drag-reorder, add/delete, and
   in-memory tracking — that carries over. The new part is `allocated / available` per month with
   variance and dollar value at the contract rate, plus inline flags, plus quiet baseline display next to
   each edited value. Straightforward, but it's four coordinated changes to a dense table.
5. **Validation on the generation form.** Tier↔budget bands, program counts per tier, the Pursuit rules,
   and "rate must be set" are all cheap individually. What isn't cheap is keeping them in sync with the
   backend's copy of the same rules. Please expose the bands and the eligibility matrix as data the
   frontend can read, rather than us hardcoding a second copy that drifts.

---

## 5. Things we'd do differently

- **Store `hours_available`, `hours_allocated` and `overhead_hours` on the document, as you spec'd** —
  good, keep that. Do *not* have the frontend recompute capacity from `monthly_budget / hourly_rate`. If
  the rate changes on the contract later, a recomputing viewer silently rewrites history on a signed
  roadmap. The document should be a snapshot.
- **`hourly_rate` belongs on the document too** (you have it — confirming it's load-bearing for us for the
  same reason).
- **Flags need a fixed vocabulary.** `{level, code, message}` is right; please publish the closed set of
  `code` values so we can style them and, where useful, render an affordance rather than only prose.
- **Month numbering.** The spec's example uses `"month": 1` (number) while the existing points plan uses
  `"month": "Month 1"` (string label). Pick one — we'd prefer a number plus an optional display label, so
  sorting is reliable.
- **Ramp-month narrative.** Agreed it should be in the roadmap's own prose, not only a flag. We'll render
  the soft flag inline as well so it's visible while editing.

---

## 6. Confirmed: no schema change needed on our side

`contracts.customer_display_type` and `contracts.dollar_per_hour` both exist and are already populated
where relevant. `compass_process_library` already carries `time_estimate_ms` and `service_category`
(added and indexed in migration 019). `technologies`, `contract_technologies` and `payment_sources` are
allowlisted in `backend-proxy` — that unblocks the picker on the backend side.

One data hygiene item from your Open list that we'd flag as blocking generation quality, not just nice to
have: **`Set up ABM` existing twice at 9h and 18.08h**, and four items with no estimate. A generator
drawing from that library will produce a defensible-looking number from an undefended row. Worth the pass
before step 3 in your sequencing.

---

## 7. What we need to proceed

| # | Item | Owner |
|---|---|---|
| 1 | Confirm program roadmap hours are authored, never re-derived through `useDisplayUnits` | All three |
| 2 | Add `"schema": "program_roadmap_v1"` discriminator to `content_structured` | Backend / Master Marketer |
| 3 | Rule for which option downstream generators read | All three |
| 4 | Tier bands + eligibility matrix exposed as data, not hardcoded twice | Backend |
| 5 | Closed vocabulary for flag `code` values | Master Marketer |
| 6 | Confirm technology price resolution order (assignment override vs catalog default) | Backend |
| 7 | `one_time` cadence handling — separate figure, not amortised | Backend |
| 8 | Month field: number + optional label | Backend |
| 9 | Library hygiene pass (duplicate `Set up ABM`, four missing estimates) | MiD |

Once 1–3 are settled the frontend work sequences cleanly: adapter → viewer option switch → generation
form + technology picker → hours editing UI.
