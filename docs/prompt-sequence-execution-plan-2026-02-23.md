# Prompt Sequence Execution Engine + Brand Voice — Implementation Plan

**Date:** February 23, 2026
**Status:** Planning

## What We're Building

The missing piece between "strategist picks a prompt sequence" and "content appears on the asset." This is the execution engine that resolves variables, injects context from the knowledge base, runs steps sequentially, pipes outputs between steps, and writes the final result back to the content asset.

Also: a brand voice document system so each client's tone, style, and examples are stored and automatically injected into every generation.

## What Already Exists

| Component | Status | Location |
|-----------|--------|----------|
| `content_prompt_sequences` table | Done | `migrations/011_content_prompt_sequences.sql` |
| 6 global default sequences (blog, newsletter, case study, social, video) | Seeded | Same migration |
| Prompt sequence CRUD API (list, get, create, update, delete, duplicate) | Done | `routes/compass/content.ts` lines 2070-2401 |
| TypeScript types + validation | Done | `types/content.ts` |
| RAG search (for context injection) | Done | `services/rag/search.ts` |
| Content assets table with status workflow | Done | `migrations/010_content_module.sql` |
| AI categorization pipeline | Done | `services/claude/categorize.ts` |
| Lovable prompt for Prompts management UI | Written | `docs/content-ops-prompts-lovable.md` |

## Part 1: Brand Voice Storage

### Why
Every seeded prompt sequence references `{{brand_voice}}` in its system prompt. Currently there's nowhere to store this. We need a structured way for each client to define their brand voice with examples, so it gets injected into every content generation.

### Data Model

New table: `compass_brand_voice`

```sql
CREATE TABLE compass_brand_voice (
  brand_voice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(contract_id),

  -- Core voice definition
  voice_summary text NOT NULL,          -- 1-3 sentence summary ("Professional but approachable, data-driven...")
  tone text[],                          -- Array: ["authoritative", "approachable", "technical"]
  personality text[],                   -- Array: ["innovative", "pragmatic", "empathetic"]

  -- Detailed guidelines
  writing_style text,                   -- Paragraph: sentence structure, vocabulary level, perspective (1st/3rd)
  do_guidelines text[],                 -- Array: ["Use data to support claims", "Include practical takeaways"]
  dont_guidelines text[],              -- Array: ["Don't use jargon without explaining it", "Don't be salesy"]

  -- Examples
  example_excerpts jsonb DEFAULT '[]',  -- Array of {"text": "...", "source": "Blog Title", "why": "Shows our authoritative but accessible tone"}

  -- Audience context
  target_audience text,                 -- Who the content is for
  industry_context text,                -- Industry-specific language notes

  -- Metadata
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(contract_id)                   -- One active brand voice per contract
);
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/compass/brand-voice?contract_id={id}` | Get brand voice for a contract |
| PUT | `/api/compass/brand-voice` | Create or update brand voice (upsert) |

### Brand Voice Resolution for `{{brand_voice}}`

When a prompt sequence is executed, `{{brand_voice}}` gets resolved to a formatted block:

```
Voice: Professional but approachable, data-driven with practical focus
Tone: authoritative, approachable, technical
Style: {{writing_style}}

DO:
- Use data to support claims
- Include practical takeaways

DON'T:
- Use jargon without explaining it
- Be salesy

Example of our voice:
"[excerpt]" — from "Blog Title"
```

This gives Claude rich context about how to write, not just a one-liner.

### Brand Voice in RAG Chat

Bonus: the brand voice document should also be embedded into compass_knowledge (source_type: `note` or a new `brand_voice` type) so the chat can answer questions like "What's our brand voice?" or "How should we write about X?"

---

## Part 2: Content Generation Execution Engine

### The Flow

```
Strategist clicks "Generate" on an asset
  │
  ├─ 1. Resolve prompt sequence
  │     → Find sequence by content_type_slug (contract-specific or global default)
  │     → Or accept a specific sequence_id override
  │
  ├─ 2. Gather context
  │     a. Client variables: company_name, industry from contract
  │     b. Brand voice: from compass_brand_voice table
  │     c. Strategist variables: topic, angle, audience (from request body)
  │     d. Reference content (two modes):
  │        - Manual: specific asset IDs selected by strategist
  │        - Auto: RAG search using the topic/angle as query
  │
  ├─ 3. Resolve all {{variable}} templates in step prompts
  │     → {{company_name}}, {{industry}}, {{brand_voice}}
  │     → {{topic}}, {{angle}}, {{audience}}, etc.
  │     → Context blocks injected into first step only
  │
  ├─ 4. Execute steps sequentially
  │     Step 1: Call Claude with resolved system_prompt + user_prompt
  │             → Capture output as step_outputs["draft"]
  │     Step 2: Resolve {{step:draft}} in prompts
  │             → Call Claude with resolved prompts
  │             → Capture output as step_outputs["review"]
  │     ... continue for all steps
  │
  ├─ 5. Parse final output
  │     → Extract markdown content_body
  │     → Extract structured metadata (if JSON block present)
  │
  └─ 6. Write back to asset
        → Update content_body, content_structured
        → Update metadata with generation info (sequence used, timestamp, tokens)
        → Asset stays in current status (strategist reviews before publishing)
```

### API Endpoint

```
POST /api/compass/content/assets/:id/generate
Authorization: Bearer <jwt>

{
  "sequence_id": "uuid",              // optional — override default sequence
  "variables": {                       // strategist-provided values
    "topic": "ABM strategies for B2B SaaS",
    "angle": "practical, budget-friendly",
    "audience": "marketing directors"
  },
  "reference_asset_ids": ["uuid1", "uuid2"],  // optional — manual context
  "auto_retrieve": true,              // optional — RAG context from knowledge base
  "additional_instructions": "Focus on companies under $10M revenue"  // optional
}

Response (SSE stream):
  data: {"type":"step_start","step":"draft","step_number":1,"total_steps":2}
  data: {"type":"delta","text":"# ABM Strategies..."}
  data: {"type":"step_complete","step":"draft","tokens":{"input":8500,"output":1200}}
  data: {"type":"step_start","step":"review","step_number":2,"total_steps":2}
  data: {"type":"delta","text":"# ABM Strategies (Revised)..."}
  data: {"type":"step_complete","step":"review","tokens":{"input":10200,"output":1400}}
  data: {"type":"done","total_tokens":{"input":18700,"output":2600}}
```

SSE streaming lets the frontend show progress as each step runs. The strategist sees the draft being generated, then the review pass happening in real time.

### New Files

| File | Purpose |
|------|---------|
| `backend/src/services/content-generation/engine.ts` | Core execution engine: variable resolution, step execution, output piping |
| `backend/src/services/content-generation/context.ts` | Context gathering: brand voice, reference content, RAG retrieval |
| `backend/src/services/content-generation/templates.ts` | Template variable resolution (`{{var}}` and `{{step:key}}` substitution) |
| `backend/src/routes/compass/brand-voice.ts` | Brand voice CRUD route |
| `backend/migrations/014_brand_voice.sql` | Brand voice table |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/routes/compass/content.ts` | Add `POST /assets/:id/generate` endpoint |
| `backend/src/index.ts` | Register brand-voice route |

---

## Part 3: Context Injection

Context is injected into the **first step only** (subsequent steps get the prior step's output).

### Context Block Format

```
## Reference Content

The following content from the client's library is provided as context.
Use it for inspiration, consistency, and to avoid contradicting existing content.

[1] "Blog Post Title" (content)
---
{chunk content}

[2] "Marketing Roadmap" (deliverable)
---
{chunk content}

## Additional Instructions

Focus on companies under $10M revenue. Emphasize practical, low-budget approaches.
```

### Context Sources

| Source | How It Gets There | What It Provides |
|--------|-------------------|-----------------|
| Manual reference assets | Strategist selects specific assets | Full content_body of selected assets |
| Auto RAG retrieval | Search knowledge base using topic as query | Top chunks relevant to the topic |
| Brand voice | Auto-loaded from compass_brand_voice | Injected via {{brand_voice}} variable |
| Contract info | Auto-loaded from contracts table | {{company_name}}, {{industry}} |
| Additional instructions | Strategist free-text input | Appended to first step's user_prompt |

### RAG Context for Generation vs Chat

For content generation, we want **higher quality, more focused** context than chat:
- `match_count: 20` (not 50, we want the most relevant)
- `match_threshold: 0.4` (moderate, avoid noise)
- `source_types: ['content']` for blog generation (draw from published content for consistency)
- `source_types: ['deliverable', 'note']` for strategy-oriented content (draw from plans and notes)

---

## Part 4: Idea Generation

Separate from content generation. Uses a single prompt (not a sequence) to brainstorm ideas.

### API Endpoint

```
POST /api/compass/content/ideas/generate
Authorization: Bearer <jwt>

{
  "contract_id": "uuid",
  "prompt": "Generate blog post ideas about ABM for B2B SaaS companies",
  "content_type_slug": "blog_post",   // optional — focus on specific type
  "count": 5,                          // number of ideas to generate
  "avoid_topics": ["ABM basics"]       // optional — topics already covered
}

Response:
{
  "ideas": [
    {
      "title": "ABM on a Bootstrap Budget: 5 Strategies That Don't Require Demandbase",
      "description": "Practical ABM approaches using HubSpot, LinkedIn, and Clay...",
      "reasoning": "Your existing content covers enterprise ABM but nothing for startups with limited budgets",
      "suggested_category": "abm",
      "suggested_content_type": "blog_post"
    },
    ...
  ]
}
```

### How It Works

1. Load existing content titles + categories (to avoid duplicates)
2. Load competitive intel digests (for gap analysis)
3. RAG search for existing content on the topic (to identify gaps)
4. Call Claude with all context + the strategist's prompt
5. Return structured idea objects
6. Frontend lets strategist approve/reject ideas, which creates `content_ideas` records

---

## Implementation Order

### Phase A: Brand Voice (1 session)
1. Migration: `compass_brand_voice` table
2. Route: `routes/compass/brand-voice.ts` (GET + PUT upsert)
3. Register in `index.ts`
4. Embed brand voice into compass_knowledge on save
5. Lovable prompt for brand voice editor UI

### Phase B: Template Engine (1 session)
1. `services/content-generation/templates.ts` — {{variable}} and {{step:key}} resolution
2. `services/content-generation/context.ts` — gather brand voice, contract info, reference content, RAG context
3. Unit test with a sample sequence to verify piping works

### Phase C: Execution Engine (1-2 sessions)
1. `services/content-generation/engine.ts` — sequential step execution with Claude streaming
2. `POST /assets/:id/generate` route with SSE streaming
3. Write results back to asset (content_body, content_structured, metadata)
4. Test end-to-end: pick a sequence, provide variables, generate content on an asset

### Phase D: Idea Generation (1 session)
1. `POST /ideas/generate` route
2. Context loading (existing titles, competitive intel, RAG search)
3. Structured idea output parsing
4. Test with real contract data

### Phase E: Frontend (Lovable)
1. Brand voice editor page
2. Content generation UI (sequence picker, variable inputs, streaming output display)
3. Idea generation UI (prompt input, idea cards with approve/reject)

---

## Cost Estimates Per Generation

| Content Type | Steps | Estimated Input Tokens | Estimated Output Tokens | Cost |
|-------------|-------|----------------------|------------------------|------|
| Blog Post (standard) | 2 (draft + review) | ~15K + ~12K | ~1.5K + ~1.5K | ~$0.10 |
| Blog Post (thought leadership) | 2 | ~15K + ~12K | ~2K + ~2K | ~$0.12 |
| Newsletter | 2 | ~10K + ~8K | ~1K + ~1K | ~$0.07 |
| Case Study | 2 | ~12K + ~10K | ~1.5K + ~1.5K | ~$0.09 |
| Social Media | 1 | ~8K | ~800 | ~$0.03 |
| Video Script | 2 | ~10K + ~8K | ~1.5K + ~1.5K | ~$0.08 |
| Idea Generation | 1 | ~15K | ~1K | ~$0.05 |

All costs based on Claude claude-sonnet-4-20250514 pricing ($3/M input, $15/M output).

---

## Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Brand voice: separate table vs contract column | **Separate table** | Rich structured data (examples, do/don't lists) doesn't fit in a single column |
| Brand voice: one per contract | **Yes (UNIQUE constraint)** | Simplest model. Multiple brand voices per contract adds complexity we don't need yet |
| Generation: streaming vs batch | **SSE streaming** | Strategist sees progress in real-time, matches chat pattern |
| Context injection: every step vs first only | **First step only** | Subsequent steps already have the draft. Adding context again wastes tokens and confuses Claude |
| Step execution: parallel vs sequential | **Sequential** | Steps depend on prior outputs. No parallelism possible |
| Model | **claude-sonnet-4-20250514** | Fast, cost-effective, good writing quality. Opus available as upgrade path |
| Output storage | **content_body (markdown) + content_structured (JSON)** | Matches existing asset schema. Structured data for meta descriptions, tags, etc. |
