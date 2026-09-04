# Program roadmap — show the technology stack

**One section to add to the roadmap viewer, plus one field the strategist can write.**
Small, self-contained, and it does not touch the adapter, the option switch or the hours
editor. It can ship before or after any of them.

Builds on `program-roadmap-frontend-brief.md`; the document shape there is current.

---

## The problem

Every option carries a platform cost:

```jsonc
"technology_monthly": 1912.08,
"technology_one_time": 0,
"total_monthly": 10662.08
```

A client reads *$1,912 a month of platform* and has no way to see what it buys. The tools
were picked on the form, so the answer has always existed — it just never reached the
document. **It does now.**

---

## 1. The data you already receive

Each option may now carry `technology[]`, alongside the totals it already had:

```jsonc
"technology_monthly": 1912.08,
"technology_one_time": 0,
"technology": [
  { "technology_id": "…", "name": "HubSpot",  "vendor": "HubSpot",  "quantity": 1 },
  { "technology_id": "…", "name": "Clay",     "vendor": "Clay",     "quantity": 2 },
  { "technology_id": "…", "name": "HeyReach", "vendor": "HeyReach", "quantity": 1 }
]
```

Three things about it:

**No per-tool price, and that is deliberate.** `technology_monthly` is the one client-facing
figure. A line-by-line breakdown turns a proposal review into a negotiation over a $40 tool,
and the client portal already itemises the durable billing record per contract. **Do not add
a price column, and do not divide the total across the items.**

**It is optional.** An option with no billable tools selected has no `technology` key at all.
Render the figure alone in that case — never an empty list or a "no technology" empty state.

**It is per option**, like every other plan section. Options are alternatives with different
stacks; the section switches with the option, it is not shared.

`quantity` is `1` almost everywhere today. Show it only when it is greater than 1 —
*"Clay ×2"* — so the common case stays clean.

---

## 2. The section to build

A per-option **Technology** section in the viewer, in the option-scoped half of the TOC
(same treatment as Goals and Hours Plan — re-derives on option switch).

```
Technology                                          $1,912 / mo

[strategist narrative, when written]

HubSpot     HubSpot
Clay        Clay ×2
HeyReach    HeyReach
```

- **Headline is `technology_monthly`**, formatted like every other money figure in the
  document. Add `technology_one_time` as a separate line when it is non-zero — *"plus $2,500
  one-time setup"*. **Never fold it into the monthly figure**; `total_monthly` is strictly
  monthly so options stay comparable.
- **Names carry the section.** Vendor is supporting detail — show it quietly where the name
  and vendor differ, and drop it where they are the same word rather than printing *HubSpot
  HubSpot*.
- A compact list, not a data table. This is three to eight rows, not a grid.

**On the option card**, where the comparison happens, keep it to one line — the names inline
after the figure:

```
Technology     $1,912/mo    HubSpot, Clay, HeyReach
```

Truncate with a count past four (*"+3 more"*), and let the full list live in the section.

---

## 3. The strategist narrative

The list says *what*. It does not say *why this stack*, and that is the part a strategist
sometimes needs to write in their own words — that the client already owns the HubSpot seat,
that the outbound tooling is the reason the pursuit option costs what it does.

**Add an editable narrative on each option**, stored on that option in the document:

```jsonc
"technology_note": "Outbound for named accounts runs on Clay for enrichment and HeyReach for
sequencing. HubSpot is the seat you already own — we configure it rather than replace it."
```

- **Plain text, one field, no field on the form.** It is written against a real generated
  document while looking at the stack, not guessed at submission time.
- **Optional and empty by default.** Nothing generates it — no placeholder text, no "click
  to add" ghost row in the client-facing render. When it is empty the section is simply the
  figure and the list.
- **Renders above the list**, as prose, in the same voice as `section_description` elsewhere
  in the document.
- **Per option**, like the stack it describes. Do not share one note across options.

### Saving it

Same write the hours editor uses — `PATCH /api/compass/deliverables/:deliverable_id` with the
whole document:

```jsonc
{ "content_structured": { …document with the edited option… } }
```

The backend writes `content_structured` as posted and re-embeds. Nothing on the server reads
or generates `technology_note`, so it is yours to own end to end.

**Two things this implies, both worth surfacing in the UI:**

- **Regenerating replaces the document**, and the note goes with it. Same as every other
  in-document edit — worth a word in the regenerate confirmation, not a special case.
- **Editing is a strategist action, not a client one.** The note renders in the shared/client
  view; it is only editable in the internal viewer.

---

## 4. Markdown export

`roadmapToMarkdown` gains the section per option, in the same order as the viewer:

```markdown
### Technology

$1,912 / mo

Outbound for named accounts runs on Clay for enrichment…

- HubSpot (HubSpot)
- Clay (Clay) ×2
- HeyReach (HeyReach)
```

The export feeds LLMs and SOW drafting, where naming the stack is exactly the detail that
otherwise gets asked for in a follow-up email.

---

## What not to do

- **No per-tool prices**, anywhere — not in the viewer, the card, the export or a tooltip.
- **No summed technology across options.** They are alternatives; the rule that governs
  every other figure governs this one.
- **Don't derive the total from the items.** The document is a snapshot. `technology_monthly`
  is read, never recomputed — a viewer that re-adds the items would silently rewrite a signed
  roadmap the day a catalog price changed.
- **Don't render the section when both the figure and the list are absent.** An option can
  legitimately include no billable platform at all.
