# Program Roadmap — Master Marketer's response, v3

Reply to `program-roadmap-addendum-master-marketer.md`.

| Response | Replies to | Covers |
|---|---|---|
| `program-roadmap-review-response.md` (v1) | brief v1, spec v1 | `annual_plan` collision, call structure, flag ownership, `commitment_type` |
| `program-roadmap-review-response-v2.md` | brief v2, spec v2 | Overhead double-definition, tier-band consequences, flag vocabulary |
| **this document (v3)** | **addendum, spec v3** | **Three corrections, one housekeeping item, build sequencing** |

v1 keeps its unsuffixed filename because spec v2's header cites it by name — renaming it
would break that reference. Everything from here is numbered.

---

## Verdict

The addendum lands. **`recommended_option_id` as an input is a straight improvement** — it
removes the one hallucination with nowhere safe to fail, and the strategist is better placed
to make that call than the generator is. Overhead resolving to (b), with
`overhead_under_reserved` removed from the vocabulary rather than shipped dead, is right.
The envelope, `row_above_baseline`, the field renames and the repair-loop terminal state are
all as we'd build them.

Three things need correcting before they are settled, and one file isn't where the addendum
thinks it is. None of it blocks us starting — see the sequencing at the end.

---

## 1. The tier cap cannot do what it was added to do

As specified:

```
max_categories = min(program_hours / 6, tier_cap)     // tier_cap: execute 4
```

`min()` only ever tightens. It can pull the threshold below 4; it can never raise it to 4.
So across the bottom of the Execute band the cap is inert:

| Execute at | Capacity | Program hours | `ph / 6` | `min(·, 4)` | Execute/Reach at 4 categories |
|---|---|---|---|---|---|
| Floor | 32.0 | 22.2 | 3.7 | **3.7** | **fires** |
| — | 33.8 | 24.0 | 4.0 | 4.0 | passes |
| Ceiling | 47.9 | 38.1 | 6.35 | 4.0 | passes |

`month_thin_spread` therefore fires on the **Execute / Reach archetype the spec itself
recommends**, for any Execute engagement with program hours below 24 — capacity 32 to 33.8,
which is **$4,000 to $4,225 at $125** and $5,600 to $5,915 at $175.

That is the published entry price, the most common Execute engagement, and the exact failure
the cap was introduced to prevent — relocated from the top of the band to the bottom.

**Fix — make the Execute cap flat rather than a `min`:**

```
max_categories = tier_cap ?? (program_hours / 6)
tier_cap:  execute 4 · perform null · grow null
```

Four categories at every point in the Execute band. The archetype passes at the floor, and
narrowness still holds at the ceiling where `ph / 6` would otherwise permit six.

Execute / Authority is unaffected either way — it rolls up to Content and
Analytics & reporting, two categories.

---

## 2. Derived `program_allocation` makes `content_share_off_pattern` fire on nearly every Perform option

First-program-in-ordering wins any category eligible for more than one sold program. At
Perform = Authority + Reach, three categories are shared — **Content, Design, and
Analytics & reporting** — so all three go to whichever program the strategist listed first.
Reach retains only its exclusives: Development, Marketing operations, Paid media,
Email & nurture.

Content, Design and Analytics are the bulk of hours in most plans. So:

| Ordering | Effect | Result |
|---|---|---|
| `['authority', 'reach']` | Authority owns the bulk, ≈ 80% of hours | **Authority > 65% fires** |
| `['reach', 'authority']` | Reach owns the same bulk | **Reach > 45% fires** |

**Both orderings trip the flag, on correctly-composed plans.** It becomes noise at exactly
the tier where composition judgement matters most, and a flag column that is usually wrong
is a flag column strategists stop reading.

**Recommended fix: compute content share off `service_category`, not `program`.** The
question the flag actually asks — how much of this month is content production versus
everything else — is answered by the category directly, without routing through an
allocation that cannot represent a split. That also makes the flag independent of the
ordering, which removes the load-bearing sequencing the addendum flags as a known risk.

Failing that, suppress `content_share_off_pattern` on multi-program options for v1.

Worth saying plainly: `program_allocation` was our suggestion in v1. It removed the
label-to-satisfy-the-flag problem and introduced this one. Computing the flag off category
sidesteps both, and leaves the allocation doing only what it is good at — labelling rows for
display.

---

## 3. One definition the addendum leaves open

The backend now injects the overhead block **after** generation. So which does
`hours_plan.total_hours_allocated` count?

| | Three months at Execute floor |
|---|---|
| Program hours only — what we emit | **64.5** |
| Program + injected overhead | **93.9** |

We emit the first; we cannot total a block we never receive. If the frontend's variance band
assumes the second, the two disagree by 29.4 hours and nobody notices until a strategist
checks the arithmetic against the fee.

Whichever it is, the injector and our totals need to agree explicitly, and
`total_hours_available` needs the same treatment (66.6 versus 96.0).

Related, and ours to get right: our narrative will describe the plan in **program hours**.
It will not claim "32 hours a month" anywhere, because we did not allocate 9.8 of them.

---

## 4. Housekeeping — v3 and the Lovable response are not in this repo

`docs/program-roadmap-spec.md` in `master-marketer` still reads **v2** at the header, with
`month_thin_spread` at the uncapped `program_hours / 6` and no three-class archetypes.

Commit `b40b8fa` does not exist in this repository, and
`program-roadmap-review-response-from-lovable.md` is not in the working tree or anywhere in
history. Our checkout is current — those files are in the backend repo.

This matters for one specific reason: **§2b's three-class archetype tables are the literal
content of the Execute per-option prompt.** The addendum confirms they exist in v3 but not
what they say. Everything else we can build from the addendum; that one we need the text of.

Either copy spec v3 and the Lovable response into `master-marketer/docs/`, or tell us where
to read them and we'll stop expecting them here.

---

## 5. Build sequencing

Isolating the blocked item so it stalls one version rather than the path. Each version is
independently testable.

### v0.1 — Scaffold *(no external dependency)*

- `ProgramRoadmapInputSchema` — separate schema, no `points_budget`
- `POST /api/generate/program-roadmap`, mirroring the existing route pattern
- `trigger/generate-program-roadmap.ts` shell, `maxDuration` 1800 → 2700 for six calls
- `program_roadmap_v1` zod **output** schema, plus the repair re-ask: two attempts, then
  emit with a loud flag
- Assembler: per-option `ROADMAP_BOILERPLATE` injection, `program_allocation` echoed through,
  `program_hours_available` / `program_hours_allocated` renames,
  `total_hours_allocated` / `total_hours_available`

### v0.2 — Shared calls *(no external dependency)*

- Calls 1–2 reused verbatim from the points path — `target_market` + `brand_story`,
  `products_and_solutions` + `competition`
- Executive summary call, running **last**, writing rationale for the
  `recommended_option_id` it was given rather than choosing one
- `term_months` and `commitment` feeding term and renewal framing

### v0.3 — Per-option plan, Perform and Grow *(no external dependency)*

- `goals` with `commitment_type`, shared benchmarks, monotonic targets across options
- `roadmap_phases`, `quarterly_initiatives`, `annual_plan` Gantt, `hours_plan` rows
- Options sequential in ascending tier order, each seeing the ones before it
- Perform and Grow compose freely, so **this ships without the v3 archetype text**

### v0.4 — Execute path *(blocked on §4)*

- Three-class composition: setup (month 1 only), recurring (every month), production (scales
  to fill)
- Month-one ramp narrative
- Production-scales-to-fill so a high-band Execute does not sit at 56% allocated

### v0.5 — Hardening

- Repair-loop terminal behaviour under real over-capacity output
- Cross-option goal checks end to end
- Assertion on `config.overhead_in_plan === false`
- Fixture run across all three tiers and one, two and three-option documents

**§1, §2 and §3 are backend-side and do not gate any version above.** We would rather they
were settled before v0.5, so the fixture run asserts against final thresholds.

---

## What we need back

| | Item | Gates |
|---|---|---|
| 1 | **Spec v3 + the Lovable response in `master-marketer/docs/`**, or a path | **v0.4** |
| 2 | **§1** — flat Execute cap of 4, replacing the `min()` | v0.5 fixtures |
| 3 | **§2** — content share computed off `service_category`, or suppressed at multi-program options | v0.5 fixtures |
| 4 | **§3** — does `total_hours_allocated` include the injected overhead block? | v0.5 fixtures |

Everything else in the addendum we are building to as written. v0.1 starts now.
