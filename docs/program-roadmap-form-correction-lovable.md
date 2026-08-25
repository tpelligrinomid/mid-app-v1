> **SUPERSEDED by `program-roadmap-spec.md` v5.** Kept for history only; do not build from this.

# Program roadmap form — one correction, and two flag changes

All three changes landed correctly. **One thing I told you in the last prompt has since
changed**, and it affects the per-option display you just built. The cause is a decision
reversal on our side, not anything you did.

---

## Correction: overhead is not reserved

The last prompt said:

> `overhead_hours` is `9.8`… It is reserved for strategy and account management and is not
> available for program work.

**That is no longer true.** Strategy and account management is billed to tasks like
everything else — preparing a plan, standing up a VM, running a monthly status call are all
library items with hours against them. They appear in the plan as ordinary rows.

So the generator allocates against the **full capacity**, not capacity minus 9.8, and nothing
is held back.

### What to change in the option display

You currently show **monthly fee · overhead reserved · program hours**. Two problems: nothing
is reserved, and program hours is not the number the plan is built against.

```
Monthly fee                 $7,000
Capacity                    40.0 hrs        ← what the plan allocates against
  typical coordination      ~9.8 hrs        ← expectation, planned as rows
```

- **Capacity** (`monthly_hours`) is the real figure. Show it as the headline.
- **Coordination** is guidance for what a month's strategy and AM rows usually come to — not
  a subtraction. Phrase it as an expectation, not a reservation. Dropping it entirely is fine
  too; it is no longer load-bearing.
- **`program_hours`** stays in the payload but is guidance only. Do not present it as a
  budget the strategist is spending against — the month's ceiling is the full capacity.

`config.overhead_in_plan` is now `true` if you want to assert on it.

**Nothing about tier bands changes** — they were always capacity hours, and your validation
against `tier_bands[tier]` is correct as built.

---

## Flag change 1: `overhead_under_reserved` is back

The last prompt said it was removed. It is restored, because with overhead planned as rows a
month with two hours of coordination on a 32-hour engagement is a real signal.

**It is option-scoped, not month-scoped.** Overhead is lumpy: the only recurring coordination
item in the library is `Facilitate Client Meetings` at 5h/month, while planning sits in
one-time `Develop … Plan Document` items running 10–45h. Month one legitimately carries 20+
hours of strategy where month three carries five, so it is only meaningful summed across the
plan.

---

## Flag change 2: flags now carry an explicit `scope`

There are three levels, because three different things go wrong:

```ts
{
  level: 'soft',
  code,
  message,
  scope: 'month' | 'option' | 'document',
  severity?: 'review' | 'notice',
  option_ids?: string[],
}
```

| Scope | Means | Codes |
|---|---|---|
| `month` | This month is composed badly | `row_below_baseline`, `row_above_baseline`, `month_thin_spread`, `month_under_capacity`, `content_share_off_pattern`, `ramp_month` |
| `option` | This option is wrong across its whole plan | `overhead_under_reserved`, `goal_commitment_mismatch` |
| `document` | These options disagree with each other | `goal_target_not_monotonic` |

`config.option_level_flags` and `config.cross_option_flags` list the last two groups, so the
sets stay readable from the endpoint rather than hardcoded.

`option_ids` appears on `document`-scope flags so you can highlight both sides of a
comparison.

---

## Two other things settled since your last prompt

**Overhead rows appear in the plan with `program: 'overhead'`** and a service category of
`Strategy & account management`. They should render like any other row in the editor — they
are editable hours the same as anything else.

**The month's totals now include overhead.** At the Execute floor a three-month plan totals
roughly 93.9 allocated against 96.0 available, not 64.5 against 66.6. If your variance band
assumed the smaller pair, it needs the larger — but since you read
`total_hours_allocated` / `total_hours_available` from the document rather than computing
them, this should need no change.

---

Everything else in your build is correct as described. The read-only rate, the programs
multi-select with matrix-sourced categories and tier-enforced counts, the Pursuit rules, and
the `growth` → `grow` normalisation are all exactly right.
