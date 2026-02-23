# RAG Chat Architecture — February 23, 2026

## Overview

The MiD App chat feature provides AI-powered Q&A grounded in each client's actual content library. It uses a **smart query router** that classifies each question and picks the best data retrieval strategy — structured database queries, vector similarity search (RAG), or both.

Two chat entry points exist in the UI, each automatically scoped:

| Location | Source Types | Use Case |
|----------|-------------|----------|
| **Content Ops > Chat** | `content` | Blog posts, articles, ingested URLs |
| **Management > Chat** | `note`, `meeting`, `deliverable` | Meeting notes, deliverables, strategy docs |

## Architecture

```
User Question
  │
  ├─ 1. Intent Classification (Claude, ~200 tokens)
  │     → "structured" | "rag" | "hybrid"
  │
  ├─ 2a. Structured Queries (if structured/hybrid)
  │     → content_assets, content_categories, content_types,
  │       compass_deliverables, compass_meetings, compass_notes
  │     → Groups by category, type, status, date, custom attributes
  │
  ├─ 2b. Vector Search (if rag/hybrid)
  │     → OpenAI text-embedding-3-small (1536 dims)
  │     → match_knowledge RPC via edge function proxy
  │     → Top 50 chunks, threshold 0.3
  │
  ├─ 3. Build System Prompt
  │     → Structured data blocks + RAG content chunks
  │     → Source deduplication (best chunk per source_id)
  │
  ├─ 4. Stream Response (Claude claude-sonnet-4-20250514, SSE)
  │     → data: {"type":"context","sources":[...]}
  │     → data: {"type":"delta","text":"..."}
  │     → data: {"type":"done","usage":{...}}
  │
  └─ 5. Frontend renders streaming response + source citations
```

## Files

| File | Purpose |
|------|---------|
| `backend/src/services/rag/chat.ts` | Core chat service — intent classification, structured queries, RAG search, Claude streaming |
| `backend/src/services/rag/search.ts` | Vector similarity search via `match_knowledge` RPC |
| `backend/src/services/rag/embeddings.ts` | OpenAI embeddings API (text-embedding-3-small) |
| `backend/src/routes/compass/chat.ts` | Express route — POST `/api/compass/chat` with SSE |
| `backend/src/types/rag.ts` | Types: `SimilarityResult`, `SourceType`, `KnowledgeChunk` |
| `backend/migrations/013_fix_match_knowledge_text_input.sql` | Fixed `match_knowledge` to accept `text` parameter |
| `docs/rag-chat-lovable-prompt.md` | Lovable frontend prompt for chat UI |

## Query Router — Intent Classification

A fast Claude call (~200 tokens) classifies each question:

| Intent | When | Example Questions |
|--------|------|-------------------|
| `structured` | Counts, trends, dates, categories, statuses | "What topics do we write about most?", "How many posts are in draft?" |
| `rag` | Content-specific questions, summaries, themes | "What's our ABM strategy?", "Summarize our last meeting" |
| `hybrid` | Both structured data + content search needed | "What topics did we cover in Q4 and what were the themes?" |

### Structured Query Types

| Query Label | Data Source | What It Returns |
|-------------|------------|-----------------|
| `content_by_category` | `content_assets` + `content_categories` | Pieces grouped by category with counts |
| `content_by_type` | `content_assets` + `content_types` | Pieces grouped by content type |
| `content_by_status` | `content_assets` | Counts by draft/published/review/etc. |
| `content_by_date` | `content_assets` | Published pieces grouped by month |
| `content_by_attributes` | `content_assets` + `content_attribute_definitions` | Custom attribute value distribution |
| `content_stats` | `content_assets` | Total counts, date ranges |
| `content_list` | `content_assets` | Recent content with titles and status |
| `deliverables_list` | `compass_deliverables` | Deliverables with type, status, dates |
| `meetings_list` | `compass_meetings` | Recent meetings with dates and participants |
| `notes_list` | `compass_notes` | Recent notes by type and date |

Structured queries respect source_type scoping — Content Ops chat won't query deliverables, Management chat won't query content_assets.

If a structured query returns no data, the system automatically falls back to RAG.

## Vector Search Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `match_count` | 50 | ~25K tokens of context — well within Claude's 200K window |
| `match_threshold` | 0.3 | Lower threshold captures detail chunks that use different terminology than the query |
| Embedding model | `text-embedding-3-small` | 1536 dimensions, cost-effective |
| Embedding storage | `vector(1536)` with HNSW index | Fast cosine similarity via pgvector |

## Category & Type Resolution

Categories and content types can be:
- **Global** (`contract_id IS NULL`) — shared across all contracts
- **Per-contract** (`contract_id = <uuid>`) — client-specific

The structured queries fetch both. When `category_id` is not set on an asset, the system falls back to AI-assigned categories stored in `metadata.ai_category_slug`.

## API Endpoint

```
POST /api/compass/chat
Authorization: Bearer <jwt>

{
  "message": "What topics do we write about most?",
  "contract_id": "bfd6c756-8746-4619-be60-cba08836b1a9",
  "conversation_history": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ],
  "source_types": ["content"]  // optional, auto-set by UI location
}

Response: text/event-stream (SSE)
  data: {"type":"context","sources":[{"title":"...","source_type":"content","source_id":"uuid","similarity":0.67}]}
  data: {"type":"delta","text":"Based on"}
  data: {"type":"delta","text":" your content..."}
  data: {"type":"done","usage":{"input_tokens":12500,"output_tokens":450}}
```

## Cost Per Query

| Component | Tokens | Cost |
|-----------|--------|------|
| Intent classification | ~200 in + ~50 out | ~$0.001 |
| OpenAI embedding | ~20 tokens | ~$0.000002 |
| Claude response (RAG) | ~25K in + ~500 out | ~$0.08 |
| Claude response (structured) | ~2K in + ~500 out | ~$0.01 |
| **Typical RAG query** | | **~$0.08** |
| **Typical structured query** | | **~$0.01** |

## Key Bug Fix: match_knowledge RPC

The `match_knowledge` PostgreSQL function originally accepted `vector(1536)` as its first parameter. When called through PostgREST (via the edge function proxy), the embedding arrives as a JSON string. pgvector's `text → vector` cast is **assignment-only** (not implicit), which means:
- INSERT/UPDATE works (assignment context)
- Direct SQL works (explicit cast)
- **PostgREST RPC calls fail silently** (returns 0 results)

**Fix** (migration 013): Changed the function to accept `text` and cast explicitly inside:
```sql
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding text,  -- was: vector(1536)
  ...
)
DECLARE
  query_vector vector(1536);
BEGIN
  query_vector := query_embedding::vector(1536);
  ...
```

After changing the function, `NOTIFY pgrst, 'reload schema'` must be run to refresh PostgREST's schema cache.

## Data in compass_knowledge (as of Feb 2026)

For contract `bfd6c756-...` (New North / MIDNEW12345):
- **1,798** content chunks (blog posts, articles)
- **750** deliverable chunks (roadmaps, plans, audits)
- **7** meeting chunks
- All with OpenAI embeddings (0 missing)
- HNSW index for fast cosine similarity search
