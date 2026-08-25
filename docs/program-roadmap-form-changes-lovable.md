> **SUPERSEDED by `program-roadmap-spec.md` v5.** Kept for history only; do not build from this.

# Program roadmap form — three changes

The backend now accepts your payload as posted (`options`, `name`, `monthly_hours`,
`hours_model`, `recommended_option_index`). Three things still need changing on the form.
Everything else lines up.

All values below come from `GET /api/compass/roadmap-config`, which is live. It is served
from one module the backend also validates against, so nothing here needs hardcoding.

---

## 1. Hourly rate becomes read-only, sourced from the contract

**The backend ignores `hours_model.hourly_rate` and uses `contracts.dollar_per_hour`.**
A field that can be edited but is then discarded is worse than no field — two sources for
one number is how a signed roadmap ends up quoting a rate nobody set.

**Show it, don't collect it.** The strategist needs to see it, because every derived figure
on the form depends on it:

```
Blended rate    $175 / hr        [read-only, from contract]
```

Greyed out, with a hint that it is set on the contract. If someone needs to change it, they
change the contract — that is a deliberate decision, not a per-roadmap one.

You can keep posting `hours_model.hourly_rate` or drop it; the backend ignores it either
way and logs a warning if it disagrees with the contract.

**When the contract has no rate**, block generation on the form with a message pointing at
the contract. The backend refuses with *"Set the contract's hourly rate before
generating"*, but catching it before submit saves a round trip.

**Derived figures worth showing live per option**, since they are what the strategist is
actually deciding between:

```
monthly_hours × rate            = monthly fee
monthly_hours                   → tier      (via tier_bands)
monthly_hours − overhead_hours  = program hours
```

`overhead_hours` is `9.8` from `config.constants`. It is reserved for strategy and account
management and is not available for program work — worth showing as its own line so the
gap between capacity and program hours never looks like a rounding error.

---

## 2. Add a `programs` multi-select — currently blocking

The form posts no `programs`, and nothing can generate without it. The eligibility filter,
the per-option allocation map, and the content-share flag all read it, and **tier gives only
the count, never which**.

```jsonc
"programs": ["authority", "reach"]
```

- Options come from `config.program_matrix` — the keys are the three programs
- Count is enforced by `config.tier_bands[tier].programs` — Execute 1, Perform 2, Grow 3
- **Pursuit is disabled at Execute** (`config.pursuit_min_tier` is `"perform"`)
- **Pursuit cannot be the only selection** at any tier (`config.pursuit_sold_alone` is `false`)

Useful to show what each selection unlocks: `config.program_matrix[program]` is the list of
service categories that program may draw from, which is the concrete answer to "what am I
buying."

---

## 3. Repoint the commitment picker

The picker currently reads `commitment_ladder`. **That field is not what it looks like, and
the naming was my fault.** It was the *goal* commitment ladder — what class of goal a tier
may promise — so the picker would offer a strategist:

> output · leading_indicator · business_outcome

where they expect *monthly · annual*.

It is renamed. Two separate fields now:

| Config field | What it is |
|---|---|
| `commitment_terms` | **Use this.** `[{ value, label }]` — monthly, quarterly, semiannual, annual |
| `goal_commitment_ladder` | Tier → permitted goal classes. Generator-side; not a form input |

Post the selected `value` as `options[].commitment`. The backend validates it against the
vocabulary and echoes it onto the generated option.

---

## Also worth knowing

**`tier` should be `"grow"`, not `"growth"`.** The config publishes `grow`. The backend
accepts `growth` as an alias rather than failing a generation over it, but the endpoint is
the source of truth.

**`recommended_option_index` works as you specified** — resolved to `recommended_option_id`
and sent *to* the generator, so Master Marketer writes the rationale for the strategist's
choice rather than making the choice itself. It is resolved before options are sorted into
tier order, so your index stays correct even though the generated document may reorder them.

**`term_months`, `commitment` and `notes` are echoed onto the generated option**, so the
editor and markdown export read them from the document as you asked.

**Config payload is snake_case throughout** — `tier_bands.execute.min_capacity_hours`,
`flag_codes.month_thin_spread.hours_per_category`, and so on.

---

## Two flag details for styling

The flag envelope gained two fields since the last brief:

```ts
{ level: 'soft', code, message, severity?: 'review' | 'notice', option_ids?: string[] }
```

**`severity`** separates two very different messages. `content_share_off_pattern` says *the
generator composed this badly*; `row_below_baseline` after an edit says *you just did*. Same
level, opposite response — style `review` louder than `notice`.

**`option_ids`** appears on cross-option flags, which attach to the **document** rather than
a month — `config.cross_option_flags` lists them. `goal_target_not_monotonic` is a relation
between two options and has nowhere else to live; use the ids to highlight both sides of the
comparison.

Two vocabulary changes: `overhead_under_reserved` is **removed** (overhead is reserved
outside the plan, so it would have fired on every option of every roadmap), and
`row_above_baseline` is **added** — a row at more than twice its baseline with no reason is
the direction that inflates a client's quote.
