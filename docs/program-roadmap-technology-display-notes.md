# Technology display in program roadmaps — settled

**Status: decided and built (2026-09-04). Option 1 — names, vendor and quantity per option,
no per-tool prices.** The options weighed are kept below for the reasoning.

## What was built

`attachTechnologyToOptions()` in `services/deliverable-generation/program-roadmap.ts` lifts
the resolution stored at submission time onto each option of the generated document, matched
on `option_id`, as the output is written. Both write paths call it — the webhook
(`routes/webhooks.ts`) and recovery (`recover.ts`) — so a recovered roadmap is not a lesser
one. It is a no-op for every other deliverable type and for a roadmap with no stored
resolution.

```jsonc
"technology": [
  { "technology_id": "…", "name": "HubSpot", "vendor": "HubSpot", "quantity": 1 }
]
```

`client_price_monthly` and `client_price_one_time` are dropped on the way through;
`technology_monthly` stays the one client-facing figure. The array is absent when an option
selected no billable tools, so the viewer must treat it as optional.

`/api/cron/passthrough-generate` now stores the resolution too, but only when the posted
option carries `technology_ids` — a captured MM payload has no ids, since they are never sent
to the generator. Add them to an option in the body and the passthrough matches the form
path; omit them and it behaves exactly as before.

Documented for Lovable in `program-roadmap-frontend-brief.md` (option shape plus a render
note) and in `program-roadmap-spec.md`.

**Option 4 was not built** — nothing sends the names to Master Marketer, so the narrative
still does not mention the stack. Still available and still cheap if the list on the card
reads as bolted on.

---

## Where it stood before (kept for context)

**The generated document carries totals only:**

```jsonc
"technology_monthly": 1912.08,
"technology_one_time": 0,
"total_monthly": 10662.08
```

No item list. That was deliberate — Master Marketer asked not to receive resolved items,
because they never become plan rows and never consume hours, so shipping them would be token
cost on all six generation calls.

**The itemisation exists but is not reaching anything.** The backend resolves each selected
tool to name, vendor, quantity and client price, and writes it to
`metadata.generation.context_summary.technology`. Two reasons it is not usable today:

- Roadmaps generated before the webhook fix (`f9aa89e`) had it wiped — the webhook replaced
  metadata wholesale on completion instead of merging.
- The **passthrough path never stores it at all** — `/api/cron/passthrough-generate` calls
  `submitDeliverable` directly and writes only status, job id and run id.

So there is currently nothing for the frontend to render, even if it wanted to.

Verified on `dd28fa1b` and `35f8da3b`: both show `context_summary: []`.

---

## The options

### 1. Names only, no prices — *preferred*

`Platform: HubSpot, Clay, HeyReach — $1,912/mo`

Costs nothing extra: the strategist already picked the tools on the form, so the names are
sitting in the resolution. Always accurate, cannot drift, answers "what am I paying for"
without inviting a line-by-line negotiation over a $40 tool.

### 2. A notes field on the form

Flexible, and lets a strategist say *why* the stack is what it is. But it is manual work on
a form that is already long, and it **will** drift — someone changes the picker and forgets
the note. Distinct from the existing per-option `notes`, which feeds generation rather than
the client.

### 3. Full itemisation with prices

More detail than a proposal probably wants, and the client portal already does this properly
against `contract_technologies` — which is the durable billing record, not a snapshot.

### 4. Send names to Master Marketer and let the narrative carry them

Cheap — just strings, not resolved items. The generator works them into prose:

> *"Outbound for named accounts runs on Clay for enrichment and HeyReach for sequencing,
> roughly $1,900 a month in platform."*

Reads better than a list, follows the pattern already established for `term_months` and
`commitment`, and **needs nothing from Lovable at all.**

---

## Recommendation *(taken: Option 1)*

**Option 1 or 4**, both for the same reason: the data is derived rather than typed.

The principle that has served this build: if the system already knows something, do not ask a
person to restate it. That is how `tier` ended up empty and killed a generation.

Option 4 is the lightest — no frontend change, no new document field, and the technology gets
explained rather than merely listed.

---

## What building it involves

Small in every version.

**Option 1** — roughly 30 lines in `webhooks.ts`: when MM's document lands, attach the
already-resolved technology onto each option in `content_structured`, the same way `flags`
are attached. Plus a fix so `/api/cron/passthrough-generate` stores the resolution.

**Option 4** — add `technology_names: string[]` per option to the generation payload in
`program-roadmap.ts`, and ask Master Marketer to use them in the technology framing.

**Regeneration:** not needed for anything future — new roadmaps carry it from first
generation. The existing test roadmaps (`dd28fa1b`, `35f8da3b`) cannot be backfilled: their
resolutions were wiped and `dd28fa1b`'s stored request is gone. They are throwaway tests.

---

## Also worth knowing

The **client portal already itemises technology** per contract from `contract_technologies`,
including who holds each contract. That is the durable record the retainer model promises the
client can see continuously. Whatever the roadmap shows is a proposal-time snapshot, not the
source of truth — which is an argument for keeping it light.
