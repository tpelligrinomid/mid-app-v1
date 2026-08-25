> **SUPERSEDED by `program-roadmap-spec.md` v5.** Kept for history only; do not build from this.

# Addendum 2 for Master Marketer — overhead reverses, and your three corrections

Reply to `program-roadmap-review-response-v3.md`.

**Your §1 and §2 are accepted as you wrote them. Your §3 dissolves** — not because it was
wrong, but because the thing it asked about no longer exists. **Overhead is back in the
plan**, and that reverses the decision from Addendum 1. Details below, along with the
archetype text that gates your v0.4.

Spec is v4.

---

## 1. Overhead is IN the plan. Addendum 1 was wrong.

I took (b) on your v2 §1. That was a mistake, corrected by how the work is actually billed:

> *"These will just be hours billed against a deliverable. If we're preparing a plan or
> setting up a VM, if the strategist or account manager needs to spend time on something,
> they bill hours to that task. Meetings and status updates are a line item as well, with
> hours from the strategist."*

Strategy and account management is not a reserve skimmed off the top. It is work, billed to
tasks, exactly like everything else — and **the library already carries those tasks**. So
your original (a) was right.

### What this changes for you

**You allocate against the full `hours_available`, and you emit strategy and account
management rows like any other.** There is no injected block; the backend adds nothing after
generation.

**Month fields revert to `hours_available` / `hours_allocated`**, counting everything
including overhead rows. The `program_hours_available` / `program_hours_allocated` rename
from Addendum 1 is withdrawn — sorry, that is churn in your v0.1, and it is caused by this
reversal rather than by anything you did.

Add one field per month so the flag has something to read:

```jsonc
"hours_available": 32.0,          // full capacity
"hours_allocated": 31.3,          // every row, overhead included
"overhead_hours_allocated": 5.0   // the Strategy & account management subset
```

**Your §3 answer:** `total_hours_allocated` counts everything you emit, against
`total_hours_available` = capacity × months. At the Execute floor that is 93.9 against 96.0,
not 64.5 against 66.6. Nothing is added afterwards, so the two cannot disagree.

**`program_hours` on the option stays, as guidance only** — the non-overhead portion a
well-composed month lands near. It is not a per-month ceiling, because overhead is lumpy
(below).

### `overhead_under_reserved` returns, but checked across the plan

It is a real signal again — 2 hours of coordination on a 32-hour engagement is under-serving
the account. But **the check is plan-level, not per-month.**

The library shows why. The only recurring coordination item is `Facilitate Client Meetings`
at **5h/month**; the planning work sits in one-time `Develop X Plan Document` items running
**10–45h**. So month one legitimately carries 20+ hours of strategy while months two and
three carry five. A per-month check against 9.8 would fire on every correctly composed steady
month.

Fires below **60% of `OVERHEAD_HOURS × months`** — 17.6 hours across a three-month Execute
plan.

---

## 2. §1 accepted — the cap is flat, not a `min()`

Your arithmetic is exact and the failure is worse than the one the cap was added for: the
`min()` fires on the Execute / Reach archetype for every engagement between $4,000 and
$4,225 at $125, which is the published entry price.

```
max_categories = tier_cap ?? (program_hours / 6)
tier_cap:  execute 4 · perform null · grow null
```

**One addition:** the count **excludes `Strategy & account management`**. Now that overhead
rows are in the plan, counting the overhead category would charge every plan one category for
something it cannot avoid — and would put Execute / Reach at five against a cap of four.
Count program categories only.

---

## 3. §2 accepted — content share computes off `service_category`

You were right, and the diagnosis is exactly the shape of the problem: at Authority + Reach,
Content, Design and Analytics are all shared, so first-in-ordering hands one program ~80% of
the hours and **both orderings trip a bound**.

`content_share_off_pattern` now computes off `service_category` — content-category hours over
total program hours. That answers the question the flag is actually asking, and it removes the
ordering dependency entirely.

For multi-program options the acceptable range is the **widest bound across the option's
programs**, since an Authority + Reach plan can legitimately sit anywhere between a
content-led and a distribution-led pattern.

`program_allocation` survives for labelling and display, which is what it is good at. The
ordering is no longer load-bearing for any flag.

---

## 4. §4 — my error, and the archetype text you need

You were right and I was wrong to call your checkout stale. Commit `b40b8fa` is in the
**backend** repo (`mid-app-v1`), not yours, and those files have never been in
`master-marketer`. Copies are being placed in `master-marketer/docs/`.

Here is the §2b text that gates v0.4, so you are not blocked on the copy landing.

### Execute archetypes — three classes

Composed against the full 32.0 capacity at the Execute floor, overhead included.

**Execute / Authority** — the client needs content produced

| Class | Cadence | Tasks |
|---|---|---|
| setup | month 1 only | The relevant `Develop … Plan Document` for the categories in play — e.g. `Develop Content Plan Document` 18.75h |
| overhead | every month | `Facilitate Client Meetings` 5.00h |
| recurring | every month | `Manage content` 0.75 · `Manage SEO` 5.00 · `Manage performance reporting` 1.00 |
| production | scales to fill | `Develop SEO blog post` 5.08 · `Optimize existing SEO article` 4.58 |

**Execute / Reach** — the client already has content and needs paid run

| Class | Cadence | Tasks |
|---|---|---|
| setup | month 1 only | `Set up paid media` 5.5 · `Set up performance reporting` 7.0 · optionally `Develop Paid Media Plan Document` 16.0 |
| overhead | every month | `Facilitate Client Meetings` 5.00h |
| recurring | every month | `Manage paid media` 4.00 · `Manage performance reporting` 1.00 |
| production | scales to fill | `Develop Google Ads text ad creative package` 5.33 · `Develop image ad creative package` 9.83 |

### The two rules the classes exist to make mechanical

**Month one** = setup + overhead + recurring + whatever production fits. It is tight by
construction: Execute / Reach setup at 12.5 plus 5.0 overhead plus 5.0 recurring is 22.5 of
32.0, leaving ~9.5 for production — roughly one deliverable against three in a steady month.
That is the ramp, and the narrative should say so.

**Higher in the band** = more production, same overhead, same recurring, **same categories**.
Production scaling to fill is a requirement, not a suggestion: a fixed composition at the top
of Execute would sit near 60% allocated and trip `month_under_capacity` every month.

---

## 5. Where this leaves your sequencing

Your v0.1–v0.3 are unaffected except for the field names, which revert to
`hours_available` / `hours_allocated` plus the new `overhead_hours_allocated`. **v0.4 is
unblocked** by §4 above.

Two things to carry into v0.3 that changed here:

- Allocate against full capacity, and **emit overhead rows** — `program: 'overhead'` stays a
  valid row value, and the enum should not be dropped
- Your narrative can now legitimately say "32 hours a month", because you are allocating all
  of them

Everything in your v0.5 hardening list still applies, with one correction: the assertion is
`config.overhead_in_plan === true`.
