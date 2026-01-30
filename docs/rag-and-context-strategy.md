# RAG and Context Assembly Strategy

**Last updated: January 29, 2026**

---

## Overview

When MiD App v1 calls Master Marketer to generate content, it needs to send the right context. The quality of the output depends entirely on the quality of the input. This document describes how context is gathered, stored, and assembled for AI generation tasks.

There are two types of context and three retrieval patterns.

---

## Two Types of Context

### Structured Context (No embedding needed)

Data that can be queried directly by known fields (contract ID, type, date, status). You always know where to find it.

Examples:
- Contract metadata (name, status, budget, engagement type, channels)
- Points balance (calculated from invoices, credit memos, tasks)
- Task lists and statuses from ClickUp
- Invoice amounts and dates from QuickBooks
- Active Compass Apps and module configuration
- Performance metrics and KPIs

Retrieved with normal SQL queries against Supabase tables.

### Unstructured Context (Needs embedding)

Free-form text where the *meaning* matters and you can't predict which pieces will be relevant to a future generation task.

Examples:
- Meeting notes and transcripts
- Strategy notes (weekly Compass notes)
- Research documents
- Creative briefs and deliverable content
- Client feedback
- Campaign post-mortems
- Uploaded PDFs and docs (after text extraction)
- Historical recommendations and analysis

Retrieved via vector similarity search (RAG) from the `compass_knowledge` table.

---

## What Is RAG

RAG (Retrieval-Augmented Generation) is the process of searching stored content by meaning, then including the most relevant pieces as context in an AI prompt.

### How It Works

```
1. STORE (when content is created or ingested)
   ──────────────────────────────────────────
   Text comes in (meeting note, research doc, strategy note)
       │
       ▼
   Break it into chunks (paragraphs, sections, logical units)
       │
       ▼
   Call an embedding API (e.g., OpenAI text-embedding-3-small)
   to convert each chunk into a vector (array of ~1,536 numbers
   that represents the meaning of that text)
       │
       ▼
   Store the chunk text + its vector in Supabase
   (compass_knowledge table, using pgvector)


2. RETRIEVE (at generation time)
   ─────────────────────────────
   Generation is triggered ("generate Q2 roadmap")
       │
       ▼
   Embed the query/intent into a vector
       │
       ▼
   Search Supabase for chunks whose vectors are closest
   to the query vector (cosine similarity via pgvector)
       │
       ▼
   Return the top N most relevant chunks


3. GENERATE (send to Master Marketer)
   ───────────────────────────────────
   Package the retrieved chunks as context alongside
   structured data in the JSON payload
       │
       ▼
   Master Marketer receives fully assembled context
   (it doesn't know or care that some came from RAG)
       │
       ▼
   Claude generates output grounded in real, specific context
```

### Key Concepts

- **Embedding** = the process of converting text into a numeric representation of its meaning. Also refers to the output (the numbers themselves).
- **Vector** = the data structure — an array of numbers (e.g., 1,536 floats). Same thing as an embedding, just the math/database term.
- **pgvector** = PostgreSQL extension (built into Supabase) that stores vectors and supports similarity search.
- **Cosine similarity** = the math for measuring how close two vectors are. Close = similar meaning.

### Why It Works

The embedding model places similar meanings near each other in number space:

- "Our Q1 paid media campaign drove 40% more leads" → `[0.02, -0.08, ...]`
- "First quarter advertising generated significant lead growth" → `[0.03, -0.07, ...]` (very close)
- "The office lunch menu needs updating" → `[0.91, 0.44, ...]` (completely different)

Searching by vector distance finds content that's *about* the same thing, regardless of exact wording.

---

## Embedding Infrastructure

### What Generates Embeddings

Supabase stores and searches vectors but does not generate them. MiD App v1 must call an external embedding API before storing.

- **Recommended model:** OpenAI `text-embedding-3-small` (cheap, fast, industry standard)
- **Anthropic does not offer an embedding model** — this is the one place a second AI provider is needed, but it's only for embeddings, not generation

### When Embeddings Are Generated

Any time unstructured content is saved that should be findable by meaning later:

| Event | What Gets Embedded |
|-------|--------------------|
| Compass note saved | Note content, chunked by section |
| Deliverable uploaded/created | Document content, chunked by section |
| Meeting transcript ingested | Transcript content, chunked by topic/segment |
| Research document imported | Research content, chunked by section |
| Client feedback recorded | Feedback text |
| Campaign post-mortem saved | Analysis content, chunked by section |

### What Does NOT Need Embedding

- Contract metadata (query by ID)
- Points balances (calculated values)
- Task lists (query by contract/status)
- Invoice data (query by contract/date)
- Module configuration (query by contract)
- Any data you retrieve by known fields rather than meaning

**Rule of thumb:** "Would I want an AI to find this based on what it's *about*, not just which contract it belongs to?" If yes, embed it.

---

## Three Retrieval Patterns

### Pattern 1: Direct Fetch

You know exactly what document you need. Query by type, contract, and recency.

```
Example: "Generate Q2 roadmap"
    → Fetch the current roadmap:
      SELECT * FROM compass_deliverables
      WHERE contract_id = x AND type = 'roadmap'
      ORDER BY created_at DESC LIMIT 1
```

No embedding involved. This is the document hierarchy at work — a roadmap always builds from the previous roadmap and the research document.

### Pattern 2: RAG Search

You don't know which specific pieces are relevant. Search by meaning.

```
Example: "Generate Q2 roadmap"
    → Find relevant meeting notes:
      Vector search on compass_knowledge
      WHERE contract_id = x
      Query: "strategic direction changes, client priorities,
              budget shifts, new market opportunities"
      LIMIT 20
```

Out of 50+ meeting notes for a contract, RAG surfaces the ones that discussed strategy shifts, new priorities, or direction changes — exactly what a roadmap update needs.

### Pattern 3: Hybrid (Direct Fetch + RAG)

This is the standard pattern for most generation tasks. Combine known required documents with meaning-based search for supplementary context.

```
Context payload = direct fetch (structured, predictable)
                + RAG search (unstructured, meaning-based)
```

---

## Context Assembly by Generation Type

Each generation type has a predictable set of "always include" documents (direct fetch) and a tailored RAG query for supplementary context.

### Roadmap Generation

| Direct Fetch (Always Include) | RAG Search (Find by Meaning) |
|-------------------------------|------------------------------|
| Contract metadata (budget, channels, engagement type) | Meeting notes mentioning strategy changes |
| Previous roadmap (latest version) | Client feedback on current direction |
| Research document (foundational) | Notes about new priorities or market shifts |
| Points balance and utilization trend | Post-mortems from recent campaigns |
| Active campaign list with performance summary | Competitive landscape observations |

**RAG query focus:** strategic direction, client priorities, budget shifts, market changes, competitive landscape

### Plan Generation

| Direct Fetch (Always Include) | RAG Search (Find by Meaning) |
|-------------------------------|------------------------------|
| Current roadmap | Meeting notes on tactics and execution |
| Research document | Past plan performance observations |
| Contract metadata and channel config | Client preferences on approach |
| Budget allocation | Team capacity notes |

**RAG query focus:** tactical execution, channel performance, implementation feedback, resource constraints

### Creative Brief Generation

| Direct Fetch (Always Include) | RAG Search (Find by Meaning) |
|-------------------------------|------------------------------|
| Current plan for the relevant channel | Brand feedback from client |
| Campaign details and objectives | Past brief performance notes |
| Target audience and personas | Client tone and voice preferences |
| Budget and timeline | Competitor creative observations |

**RAG query focus:** brand guidelines, creative feedback, audience insights, messaging preferences

### Ad Copy Generation

| Direct Fetch (Always Include) | RAG Search (Find by Meaning) |
|-------------------------------|------------------------------|
| Creative brief | Past winning ad performance data |
| Campaign input JSON | Client feedback on previous creative |
| Target personas | Competitor ad observations |
| Platform specs (LinkedIn, display, etc.) | Brand voice and messaging notes |

**RAG query focus:** ad performance, creative feedback, brand voice, competitive creative, audience response

### Weekly Performance Analysis

| Direct Fetch (Always Include) | RAG Search (Find by Meaning) |
|-------------------------------|------------------------------|
| Current period performance metrics | Notes on what to watch this period |
| Previous analysis and recommendations | Client concerns and priorities |
| Budget vs. actual spend | Strategic context and goals |
| Points utilization data | Historical trend observations |

**RAG query focus:** performance concerns, client priorities, strategic goals, previous recommendations

---

## Context Assembly Function Pattern

Each generation type gets its own assembly function in MiD App v1. The pattern is consistent:

```typescript
async function assembleRoadmapContext(contractId: string) {
  // 1. Direct fetch — always include
  const contract = await getContract(contractId)
  const currentRoadmap = await getLatestDeliverable(contractId, 'roadmap')
  const research = await getLatestDeliverable(contractId, 'research')
  const performance = await getPerformanceSummary(contractId)
  const campaigns = await getActiveCampaigns(contractId)

  // 2. RAG search — find relevant unstructured context
  const relevantNotes = await vectorSearch(contractId,
    "strategic direction, client priorities, budget shifts, " +
    "market changes, competitive landscape, new opportunities"
  )

  // 3. Package for Master Marketer
  return {
    contract,
    currentRoadmap,
    research,
    performance,
    campaigns,
    relevantContext: relevantNotes
  }
}
```

Each Compass App / generation type follows this same structure with:
- Its own list of direct-fetch documents (based on the document hierarchy)
- Its own RAG query tuned for the kind of supplementary context that generation needs

---

## Implementation Requirements

### In MiD App v1

1. **Embedding utility** — service that calls the embedding API and returns a vector
2. **Chunking logic** — splits documents into meaningful pieces (respect paragraph/section boundaries, not just fixed character counts)
3. **Ingestion hooks** — whenever a note, deliverable, transcript, or document is saved, automatically chunk and embed it into `compass_knowledge`
4. **Vector search function** — given a query string and contract ID, embed the query and return the top N closest chunks from `compass_knowledge`
5. **Context assembly functions** — per-generation-type functions that combine direct fetch + RAG into the payload Master Marketer expects

### In Supabase

1. **pgvector extension enabled** — required for vector storage and search
2. **`compass_knowledge` table** — already in the schema, stores chunks with embeddings
3. **Vector index** — for fast similarity search at scale (IVFFlat or HNSW index on the embedding column)

### In Master Marketer

Nothing. Master Marketer receives fully packaged context and doesn't know or care how it was assembled. This keeps the architecture clean — retrieval is the orchestrator's job, generation is the brain's job.

---

## Chunking Strategy (Future Detail)

How you break documents into chunks affects retrieval quality. Initial approach:

- **Chunk by section/paragraph** — respect document structure rather than splitting at arbitrary character counts
- **Target chunk size:** 500–1,000 tokens (roughly 2–4 paragraphs)
- **Overlap:** include 1–2 sentences from the previous chunk at the start of each new chunk to preserve context across boundaries
- **Metadata per chunk:** contract_id, source document type, source document ID, section heading, creation date

This will need tuning based on real retrieval results. Start simple, measure, refine.

---

## Cost Considerations

- **Embedding API calls are cheap.** OpenAI `text-embedding-3-small` costs roughly $0.02 per million tokens. Embedding an entire contract's worth of meeting notes for a year would cost fractions of a cent.
- **Storage is minimal.** A 1,536-dimension vector is about 6KB. Thousands of chunks per contract is still negligible.
- **The expensive part is generation** (Claude API calls), which happens regardless of RAG. RAG actually helps reduce generation costs by sending more focused context, leading to better outputs with fewer retries.
