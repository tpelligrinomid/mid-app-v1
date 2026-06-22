# Messaging Plan — Master Marketer Integration Spec

## Overview

The MiD Platform is adding a new **Messaging Plan** deliverable to Compass. It is a StoryBrand-based brand messaging document (positioning, brand story, narrative, pillars, ICP messaging, language guide).

Master Marketer needs **one new endpoint**: a generator that takes a client's research + roadmap + meeting transcripts and produces a complete Messaging Plan as **markdown**.

It follows the exact same async pattern as the existing `research` / `roadmap` / `content-plan` generators:

1. MiD `POST`s the payload → MM returns `202` with a `jobId`.
2. MM runs the generation in the background (Trigger task).
3. MM `POST`s the result to the `callback_url` when done.

**Output is markdown-first** — like the research generator, not the roadmap. There is **no structured JSON schema** to produce. Return the full plan as `content_raw` markdown and set `content_structured` to `null`.

---

## Endpoint

### `POST /api/generate/messaging-plan`

MiD routes here automatically (deliverable type `messaging_plan` → slug `messaging-plan`, `/api/generate/` prefix).

**Auth:** existing `x-api-key` shared key (same as all other generators).

### Request Payload

All context fields are **optional** — generate the best plan from whatever is provided. None of them block generation.

```json
{
  "deliverable_type": "messaging_plan",
  "contract_id": "uuid",
  "title": "Acme Corp — Messaging Plan",
  "instructions": "Optional free-text guidance from the strategist.",

  "client": {
    "company_name": "Acme Corp",
    "domain": "acme.com"
  },

  "research": {
    "full_document_markdown": "Full text of the prior Research deliverable (competitive landscape, positioning analysis, etc.)...",
    "competitive_scores": { }
  },

  "roadmap": {
    "...": "Full content_structured object from the contract's latest roadmap deliverable (if one exists)"
  },

  "transcripts": [
    "Full transcript of a user-selected brand-story / kickoff / planning meeting...",
    "Another selected transcript..."
  ],

  "callback_url": "https://mid-app-v1.onrender.com/api/webhooks/master-marketer/job-complete",
  "metadata": {
    "deliverable_id": "uuid",
    "contract_id": "uuid",
    "title": "Acme Corp — Messaging Plan"
  }
}
```

**Field notes:**

| Field | Presence | How to use it |
|---|---|---|
| `research` | Usually present | Primary grounding for **Market Opportunity** and **Positioning** — competitive landscape, named competitors, the uncontested space. |
| `transcripts` | Usually present (user-selected) | Primary source for the **Brand Story** (customer, villain, problems, empathy/authority) and the brand's voice. These are the brand-story exercise / kickoff sessions. |
| `roadmap` | Sometimes present | Background context only — what the engagement is actually executing. **Not required.** Generate a full plan without it. |
| `client` | Sometimes present | Company name + domain. If absent, derive it from `research`. |
| `instructions` | Sometimes present | Strategist overrides — honor them. |

---

## What to generate

Produce a complete Messaging Plan in markdown, following the MiD template (`docs/Messaging-Plan-Template.md`). The spine is the **StoryBrand 7-part brand story**. Sections, in order:

1. **The Market Opportunity** — where the client sits in the competitive landscape and the gap they own. Ground in `research`; name competitors and the uncontested space.
2. **The Positioning Claim** — the single-sentence market position, plus 3 bullet points on what it accomplishes.
3. **Positioning Statement (Internal Use)** — `[Client] is a [category] for [audience]. Unlike [alternative], [Client] [differentiator] — [payoff].`
4. **Brand Story** (the StoryBrand arc):
   - Your Customer (the main character)
   - Has a Challenge — name the Villain; external / internal / philosophical problems
   - Finds / Meets the Guide — empathy + authority (use real numbers from research/transcripts where available)
   - Gets a Plan — 3 clear steps; optional commitment/guarantee
   - Takes Action — primary (direct) CTA + transitional CTAs
   - Experiences Success — bulleted "after" state
   - Avoids Failure — bulleted costs of inaction
   - Transformation — From → To, plus optional aspirational identity
5. **Brand Narrative** — the full arc in prose (situation, stakes, failed alternatives, guide, plan, outcome).
6. **One-Liners** — pain-point hooks + optional taglines.
7. **Messaging Pillars** — 3–5 pillars, each with a claim, explanation, proof points, and language to use/avoid.
8. **ICP-Specific Messaging** — one block per ICP/segment (what they feel, core message, fear to address, aspiration, offer language).
9. **Products & Solutions Matrix** — markdown table: Product | Challenges it solves | Picture of success | Failure it avoids.
10. **Language: Use vs. Avoid** — master vocabulary list.

**Guidance:**
- Fill in every section with client-specific content drawn from the provided context. Do not leave bracketed placeholders unless a fact is genuinely unavailable — if so, flag inline as `[PLACEHOLDER — owner to provide: …]`.
- Use real numbers, named competitors, and direct quotes from transcripts where they exist.
- This is the final deliverable a strategist will hand to a client, so the prose quality and specificity matter.

---

## Response (callback)

When the job completes, `POST` to the `callback_url` with this exact shape (same as every other deliverable generator):

```json
{
  "job_id": "mm-job-id",
  "status": "completed",
  "deliverable_id": "uuid (echo from metadata)",
  "contract_id": "uuid (echo from metadata)",
  "title": "Acme Corp — Messaging Plan (echo from metadata)",
  "output": {
    "content_raw": "# Messaging Plan\n**Acme Corp**\n\n...full markdown plan...",
    "content_structured": null
  }
}
```

On failure:

```json
{
  "job_id": "mm-job-id",
  "status": "failed",
  "deliverable_id": "uuid",
  "contract_id": "uuid",
  "title": "...",
  "error": "Human-readable error message"
}
```

The MiD webhook (`/api/webhooks/master-marketer/job-complete`) is already live and type-agnostic — it writes `content_raw` back to the deliverable, marks it delivered, and re-embeds it for RAG. No MiD-side changes are needed beyond what's already deployed.

---

## Summary for the MM engineer

- New route: `POST /api/generate/messaging-plan` (mirror the `research` generator's plumbing).
- Inputs: `research`, `transcripts`, `roadmap` (optional), `client` (optional), `instructions` (optional).
- Build a StoryBrand prompt from the 10-section structure above (full template: `docs/Messaging-Plan-Template.md`).
- Output: `{ content_raw: "<markdown>", content_structured: null }`.
- Callback to the standard `job-complete` webhook, echoing `deliverable_id` / `contract_id` / `title` from `metadata`.
