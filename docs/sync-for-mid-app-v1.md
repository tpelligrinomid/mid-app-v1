# Sync Update: Master Marketer API — For MiD App v1 Session

**Date: January 29, 2026**

This document summarizes the current state of Master Marketer and the architectural decisions made today. Use this to inform MiD App v1 development so both services stay in sync.

---

## Architecture Rule: Master Marketer Never Touches the Database

Master Marketer is a pure processing service. It does not connect to Supabase. It does not read from or write to any database. All data comes in through the HTTP request payload and goes out through the HTTP response.

This means:

- **MiD App v1 owns all data retrieval.** It gathers context from Supabase (structured queries + RAG vector search), packages it into the JSON schema Master Marketer expects, and sends it in the request body.
- **MiD App v1 owns all data storage.** When Master Marketer returns output, MiD App v1 writes it to the appropriate Compass tables (deliverables, versions, reports, etc.).
- **Reference libraries (ad examples, visual styles) currently live as JSON files inside the Master Marketer repo.** When these move to Supabase tables for team CRUD, MiD App v1 will fetch the relevant examples from Supabase and include them in the request payload alongside the rest of the context. Master Marketer will not query Supabase for them.
- **Master Marketer has no environment variables for Supabase.** Only `ANTHROPIC_API_KEY`, `TRIGGER_SECRET_KEY`, `API_KEY` (for service-to-service auth), and `PORT`.

This keeps the boundary clean: MiD App v1 is the orchestrator that handles all platform logic. Master Marketer is a stateless brain that processes input and returns output.

---

## What Master Marketer Does

Four categories of endpoints, all following the same pattern: receive structured JSON, process with Claude, return structured JSON.

| Category | Pattern | Purpose | Example |
|----------|---------|---------|---------|
| **Intake** | `POST /intake/*` | Convert unstructured documents into standardized JSON schemas | PDFs/DOCX of old roadmaps → structured roadmap JSON |
| **Generate** | `POST /generate/*` | Produce new content from structured input | Campaign JSON → ad copy with visual direction |
| **Analyze** | `POST /analyze/*` | Interpret data and produce recommendations | Weekly metrics → performance analysis |
| **Export** | `POST /export/*` | Format structured data into presentation-ready output | Generation output JSON → branded markdown/PDF |

---

## What's Built and Working Today

The **Paid Media ad generation pipeline** works end-to-end. Currently runs as CLI scripts, not yet exposed as HTTP endpoints. Here's what exists:

### 1. Document Intake (`src/intake.ts`)

Takes unstructured source documents and produces a structured campaign input JSON.

**Input:** One or more files (PDF, DOCX, markdown, plain text) containing strategy docs, meeting notes, planning materials. Also accepts optional guidance text to steer extraction.

**Output:** Two files:
- A structured campaign JSON conforming to the `CampaignInputSchema` (see below)
- A review JSON with the same campaign input plus confidence level, gaps found, assumptions made, and suggestions for the strategist

**What MiD App v1 will send (when this becomes an HTTP endpoint):**
```json
{
  "documents": [
    { "filename": "strategy-doc.md", "content": "extracted text content..." },
    { "filename": "meeting-notes.pdf", "content": "extracted text content..." }
  ],
  "guidance": "This is for a LinkedIn lead gen campaign targeting IT directors"
}
```

**Note:** MiD App v1 is responsible for extracting text from PDFs/DOCX before sending. Master Marketer currently handles extraction internally (using pdf-parse and mammoth), but for the HTTP API, MiD should send pre-extracted text so Master Marketer stays truly stateless (no file uploads, no binary processing).

### 2. Ad Copy Generation (`src/generate.ts`)

Takes a structured campaign input JSON and generates ad copy across platforms and ad types.

**Input:** A campaign JSON with company context, target audience, campaign objectives, platform/ad-type preferences, and tone guidelines.

**Output:** Structured JSON containing ad variations for each platform × ad type combination. Each variation includes:
- **Post text** (LinkedIn) — the body copy above the image
- **Image copy** — primary text, supporting text, CTA text (what goes ON the ad image)
- **Headline** — platform-specific field
- **Visual direction** — concept, style notes, and reference description for the designer (pulled from a 12-format visual styles library)
- **Strategic rationale** — why this variation works for the target role
- **Character count validation** with warnings for limit violations

**Platforms supported:** LinkedIn Sponsored Content, Display/Banner (AdRoll, GDN, programmatic)

**Ad types supported:** Pain Point, Statement, Question, Comparison, Numbers, Testimonial, Social Proof, How-To

**Model:** Claude Opus 4 (`claude-opus-4-20250514`). Each platform × ad type combination is a separate Claude call. A campaign with 4 ad types × 2 platforms = 8 Claude calls, run sequentially.

### 3. Markdown Export (`src/export-markdown.ts`)

Takes the generation output JSON and produces a designer-ready markdown creative brief.

**Output format:** Clean markdown with table of contents, each ad variation showing post text, image copy table, headline, visual direction (concept + style + reference), and strategic rationale.

---

## The Campaign Input Schema

This is the contract between MiD App v1 and Master Marketer for ad generation. MiD's context assembly function for the Paid Media app needs to produce a JSON payload conforming to this schema.

```typescript
{
  campaign_name: string,

  company: {
    company_name: string,              // required
    company_website?: string,
    product_summary: string,           // one-liner, required
    differentiators: string[],         // at least 1, required
    proof_points?: string[],           // metrics, customer results
    customer_references?: string[],    // named customers
    category?: string,                 // e.g. "observability platform"
    pricing_hook?: string              // if relevant to ad
  },

  audience: {
    job_titles: string[],              // specific titles, at least 1, required
    seniority: string[],               // c_suite | vp | director | manager | individual_contributor
    pain_points: string[],             // in their language, at least 1, required
    buying_triggers?: string[],        // what would make them act now
    verticals?: string[],              // industry verticals
    company_size?: string,             // startup | smb | mid_market | enterprise
    decision_criteria?: string[],      // what they evaluate on
    current_tools?: string[]           // tools they use today
  },

  objectives: {
    primary_cta: string,               // e.g. "Request a Demo"
    offer: string,                     // what the audience gets
    goal: string,                      // awareness | lead_generation | demo_requests | etc.
    funnel_stage: string,              // top | middle | bottom
    primary_message: string,           // key message to lead with
    supporting_messages?: string[]
  },

  platform: {
    platforms: string[],               // linkedin | display
    ad_types: string[],                // pain_point | statement | question | comparison | numbers | testimonial | social_proof | how_to
    variations_per_type: number        // 1-5, default 3
  },

  tone?: {
    voice?: string,                    // professional | conversational | authoritative | provocative | empathetic
    guidelines?: string[],
    blacklist?: string[],              // words to avoid
    must_include?: string[]            // words to include
  },

  additional_context?: string          // free-form extra context
}
```

### How MiD App v1 Should Assemble This

When a user triggers ad generation in the Paid Media Compass App, MiD App v1 should:

1. **Direct fetch** the contract metadata, the active plan/creative brief, campaign details, and target personas from Supabase
2. **RAG search** `compass_knowledge` for relevant context: brand voice notes, past creative feedback, competitive creative observations, audience insights
3. **Map** the fetched data into the schema above
4. **Include reference examples** from the ad reference library (once it moves to Supabase). Send relevant examples filtered by ad type and platform as part of the payload.
5. **POST** to Master Marketer's `/generate/ads` endpoint

---

## Reference Libraries (Currently JSON, Moving to Supabase)

Master Marketer currently ships with two JSON data files that are injected into prompts as few-shot examples and creative guidance:

### Ad Reference Library (`data/ad-reference-library.json`)
28 curated B2B ad examples categorized by type and platform. Each entry has:
- Ad type (pain_point, numbers, testimonial, statement, comparison, question, social_proof, how_to)
- Platform (linkedin, display)
- Headline, body, CTA copy
- Target role
- "Why it works" annotation

### Visual Styles Library (`data/visual-styles-library.json`)
12 proven ad visual formats with:
- Name and description
- Which ad types they work best for
- Layout guidance
- Design notes
- Reference description (for designers)

### Migration Plan
When these move to Supabase tables, MiD App v1 will:
1. Store them in platform-level tables (not contract-scoped — these are shared across all contracts)
2. Provide CRUD endpoints so the team can add/edit examples through the Lovable UI
3. When assembling context for a `/generate/ads` call, query the relevant examples (filtered by ad type and platform) and include them in the payload under a `reference_examples` field and a `visual_styles` field
4. Master Marketer will accept these optional fields and inject them into the prompt. If not provided, it falls back to its built-in JSON files.

---

## Async Pattern for Long-Running Tasks

Ad generation with Opus across 8 combinations (4 ad types × 2 platforms) takes 2-3 minutes. MiD App v1 needs an async pattern for this.

**Recommended approach: Trigger.dev on the Master Marketer side, polling from MiD.**

```
MiD App v1                          Master Marketer
    │                                    │
    │  POST /generate/ads                │
    │  { campaign JSON payload }         │
    │──────────────────────────────────> │
    │                                    │  Creates Trigger.dev task
    │  { jobId: "abc123",               │
    │    status: "accepted" }           │
    │ <──────────────────────────────── │
    │                                    │
    │  (MiD stores jobId, shows         │  Trigger.dev task runs
    │   "generating..." in UI)           │  (calls Claude per platform/type)
    │                                    │
    │  GET /jobs/abc123                  │
    │──────────────────────────────────> │
    │  { status: "processing",          │
    │    progress: "4/8 complete" }     │
    │ <──────────────────────────────── │
    │                                    │
    │  GET /jobs/abc123                  │
    │──────────────────────────────────> │
    │  { status: "complete",            │
    │    output: { ... full result } }  │
    │ <──────────────────────────────── │
    │                                    │
    │  MiD stores output in Supabase    │
    │  Updates UI                        │
```

**MiD App v1's responsibilities:**
- Store the `jobId` in Supabase (link it to the contract and the Compass App that triggered it)
- Poll Master Marketer at intervals (e.g., every 5 seconds) until status is `complete` or `failed`
- Write the final output to the appropriate Compass deliverable table
- Surface progress in the Lovable UI

**Master Marketer's responsibilities:**
- Accept the request, validate the payload, return a `jobId` immediately
- Run the generation via Trigger.dev
- Expose a `GET /jobs/:jobId` endpoint for status polling
- Return the full output when complete

---

## Document Hierarchy Recap

Both services operate on the same four-tier content hierarchy. MiD App v1 stores and retrieves documents at each tier. Master Marketer processes them.

```
Research (foundational intelligence, refreshed quarterly)
    → intake/research, generate/research-summary

Roadmap (strategic direction, reviewed quarterly)
    → intake/roadmap, generate/roadmap

Plan (tactical execution, per campaign/channel)
    → intake/plan, generate/plan

Creative Brief / Execution (ad copy, content assets, landing pages)
    → intake/campaign, generate/ads, generate/creative-brief, generate/content

Meeting Notes + Maintenance Notes (weekly)
    → intake/meeting-notes (structured extraction)
    → Embedded into compass_knowledge for RAG (MiD's job)
```

Each generation type has a specific set of required context (direct fetch) and supplementary context (RAG search). The context assembly tables in `rag-and-context-strategy.md` define exactly what MiD should fetch and what RAG queries to run for each endpoint.

---

## What Needs to Happen Next (Sequenced)

### Master Marketer Side
1. Convert CLI pipeline to HTTP endpoints (Express routes calling the same underlying logic)
2. Wire up Trigger.dev for async ad generation
3. Add `/jobs/:jobId` status polling endpoint
4. Add optional `reference_examples` and `visual_styles` fields to the generate payload schema (for when libraries move to Supabase)
5. Build remaining intake endpoints (research, roadmap, plan, meeting-notes)
6. Build analyze endpoints (weekly-performance, channel-effectiveness, competitive)
7. Build export endpoints (creative-brief PDF, client-report, slide-deck)

### MiD App v1 Side
1. Build a Master Marketer HTTP client service (handles API key auth, async job polling)
2. Build context assembly functions for ad generation (first Compass App)
3. Build Compass App routes that Lovable calls to trigger generation and retrieve results
4. Store generation results in Compass deliverable tables with version history
5. Build embedding utility (OpenAI text-embedding-3-small) and ingestion hooks for compass_knowledge
6. Build vector search function for RAG retrieval
7. Expand context assembly functions for other generation types as Master Marketer adds endpoints

### Integration Touchpoint
The first integration point is: **MiD App v1 calls `POST /generate/ads` with a campaign JSON payload and handles the async response.** Everything else builds from there.

---

## Service Communication Summary

```
MiD App v1 → Master Marketer
  Auth: x-api-key header (shared secret)
  Protocol: HTTPS JSON
  Pattern: POST payload → receive jobId → poll for result

Master Marketer does NOT:
  - Connect to Supabase
  - Know about contracts, users, or permissions
  - Store any state between requests
  - Handle file uploads (MiD extracts text before sending)

Master Marketer DOES:
  - Validate incoming payloads (Zod schemas)
  - Call Claude API (Opus for generation, Sonnet for intake)
  - Run long tasks via Trigger.dev
  - Maintain built-in reference libraries (fallback when MiD doesn't send them)
  - Return structured JSON with character limit validation
```
