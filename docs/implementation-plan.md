# MiD Platform — Implementation Plan

**Date: January 29, 2026**
**For: All development sessions (MiD App v1, Master Marketer, Lovable)**

---

## Context

The MiD Platform is built as three services working together:

- **Lovable** — the frontend (React/TypeScript). Users interact with this.
- **MiD App v1** — the backend orchestrator (Node.js/Express on Render). Owns all data, auth, integrations, and context assembly.
- **Master Marketer** — the AI intelligence service (Node.js/Express on Render). Stateless. Receives structured JSON, processes with Claude, returns structured JSON. Never touches the database.

All AI requests flow through MiD App v1. Lovable never talks to Master Marketer directly.

```
Lovable → MiD App v1 → Master Marketer
                ↕
            Supabase
```

Full architecture details are in `docs/current-state.md` and `docs/architecture-summary.md`.

---

## Compass Application Structure

Compass is the per-contract workspace. It has three layers:

### 1. Deliverables (The Foundation)

The four-tier document hierarchy. Everything else builds on this.

```
Research (foundational intelligence, refreshed quarterly)
    → Roadmap (strategic direction, built from research)
        → Plan (tactical execution, per channel)
            → Brief (creative execution, built from plans)
```

Each tier is stored as a structured JSON document in `compass_deliverables` with version history in `compass_deliverable_versions`.

### 2. Notes (Ongoing Activity)

- **Meeting notes** — processed from uploaded transcripts (Fireflies, manual)
- **Management/maintenance notes** — manual entries for paid media, ABM, and other channel activity
- **Strategy notes** — weekly observations and decisions

Notes feed context back into any layer of the deliverable hierarchy via RAG.

### 3. Channels (Module-Specific Tools)

- **Paid Media** — ad generation, performance dashboards, budget tracking
- **ABM** — target accounts, touchpoints, engagement tracking
- **SEO/AEO** — keyword tracking, rankings, competitor monitoring
- **Content** — content calendar, asset management, briefs

Each channel generates *from* the deliverable hierarchy (plans and briefs) and is informed by notes.

### Left Navigation (Compass Mode)

```
Notes
Deliverables
  ├── Research
  ├── Roadmaps
  ├── Plans
  └── Briefs
Channels
  ├── Paid
  ├── ABM
  └── SEO/AEO
Content
Knowledgebase
  ├── Brand Voice
  ├── Preferences
  ├── Branding/Identity
  └── Client Guidelines
```

---

## Implementation Priorities

### Priority 1: Deliverable Schemas and Intake Pipeline

**Why first:** Deliverables are the foundation. Channels can't generate without plans. Plans can't exist without roadmaps. Nothing works until existing client documents are ingested and structured.

**The problem:** Clients have existing research, roadmaps, plans, and briefs as PDFs and Word docs. None of this is structured or stored in Supabase. We need to ingest these into standardized JSON.

#### Master Marketer — Define Output Schemas

Define the structured JSON schema (Zod) for each deliverable type's intake output. The campaign input schema exists already. We need:

- **Research schema** — What does structured research look like? (market positioning, competitive landscape, audience segments, key findings, data points, etc.)
- **Roadmap schema** — What does a structured roadmap look like? (strategic pillars, initiatives, timelines, KPIs, channel priorities, etc.)
- **Plan schema** — What does a structured plan look like? (channel-specific tactics, budget allocation, campaign structures, targeting, goals, etc.)
- **Brief schema** — The campaign input schema already covers this for paid media. Do we need a more general brief schema for other channels?

These schemas are the contract between the two services. MiD App v1 needs to know the shape of the output so it can store and retrieve it properly. Master Marketer defines them because it controls the prompts that produce them.

#### Master Marketer — Build HTTP Intake Endpoints

Convert the existing CLI intake pipeline to HTTP endpoints:

- `POST /intake/research` — documents in, structured research JSON out
- `POST /intake/roadmap` — documents in, structured roadmap JSON out
- `POST /intake/plan` — documents in, structured plan JSON out
- `POST /intake/meeting-notes` — transcript in, structured decisions + action items out

Each endpoint receives:
```json
{
  "documents": [
    { "filename": "strategy-doc.pdf", "content": "pre-extracted text..." }
  ],
  "guidance": "optional steering text from the strategist"
}
```

MiD App v1 sends pre-extracted text (not binary files). Master Marketer stays stateless.

#### MiD App v1 — Build Intake Infrastructure

1. **Text extraction utility** — add `pdf-parse` and `mammoth` dependencies. Extract text from uploaded PDFs and DOCX files before sending to Master Marketer.
2. **Master Marketer HTTP client** — `src/services/master-marketer/client.ts`. Base URL, `x-api-key` auth, typed requests/responses, error handling.
3. **Job polling service** — `src/services/master-marketer/jobs.ts`. Poll `GET /jobs/:jobId` for async task status. Store job state in Supabase.
4. **Deliverable CRUD routes** — `src/routes/compass/deliverables.ts`. Endpoints for creating, reading, updating, listing deliverables per contract. Lovable needs these to display the deliverable hierarchy.
5. **Intake routes** — `src/routes/compass/intake.ts`. Accept file uploads, extract text, call Master Marketer intake endpoints, store structured output in `compass_deliverables`.
6. **Environment variables** — add `MASTER_MARKETER_URL` and `MASTER_MARKETER_API_KEY`.

#### Lovable — Build Deliverable UI

1. **Deliverables section in Compass nav** — Research, Roadmaps, Plans, Briefs as sub-items.
2. **Deliverable list view** — show all deliverables for the selected contract, organized by type.
3. **Deliverable detail view** — display the structured JSON in a readable format. Each deliverable type will need its own display template based on the schema.
4. **Upload/intake flow** — file upload UI that triggers the intake pipeline. Show progress for async processing. Display the structured result for strategist review before saving.
5. **Version history** — show previous versions of each deliverable.

---

### Priority 2: Notes

**Why second:** Notes are the ongoing activity layer. Once deliverables are in place, notes provide the context that keeps them current. Notes also feed RAG for future generation tasks.

#### MiD App v1

1. **Notes CRUD routes** — `src/routes/compass/notes.ts`. Create, read, update, list notes per contract. Support note types: meeting, management, strategy.
2. **Meeting note intake** — accept transcript uploads, send to Master Marketer `POST /intake/meeting-notes`, store structured output.
3. **Manual note entry** — simple create/update for management and strategy notes (no AI processing needed).

#### Master Marketer

1. **Meeting notes intake endpoint** — `POST /intake/meeting-notes`. Already planned. Takes transcript text, returns structured decisions, action items, key topics, and follow-ups.

#### Lovable

1. **Notes section in Compass nav** — list view of all notes for a contract, filterable by type.
2. **Note detail view** — display note content. For meeting notes processed through intake, show structured output (decisions, action items).
3. **Manual note entry form** — simple text editor for management and strategy notes.
4. **Transcript upload** — file upload for meeting transcripts with processing status.

---

### Priority 3: RAG Infrastructure

**Why third:** Once deliverables and notes are flowing into Supabase, we need to embed them so they're available as context for future generation tasks. This is the bridge between stored content and AI generation quality.

#### MiD App v1

1. **Embedding utility** — `src/services/rag/embeddings.ts`. Call OpenAI `text-embedding-3-small` API. Return vector.
2. **Chunking logic** — `src/services/rag/chunking.ts`. Split documents into meaningful chunks (500-1,000 tokens, respect section boundaries, overlap for context continuity).
3. **Ingestion hooks** — When a deliverable is saved or a note is created, automatically chunk and embed the content into `compass_knowledge`.
4. **Vector search function** — `src/services/rag/search.ts`. Given a query string and contract ID, embed the query and return the top N relevant chunks from `compass_knowledge`.
5. **Context assembly functions** — Per-generation-type functions that combine direct fetch (deliverables by type) + RAG search (relevant notes and supplementary context) into the payload Master Marketer expects.

Full RAG strategy is documented in `docs/rag-and-context-strategy.md`.

#### Supabase

1. **Enable pgvector extension** if not already enabled.
2. **Verify `compass_knowledge` table** has proper vector column and index (IVFFlat or HNSW).

#### MiD App v1 — Environment

1. **Add `OPENAI_API_KEY`** — for embedding API calls only. All generation still uses Claude via Master Marketer.

---

### Priority 4: Knowledgebase

**Why fourth:** The knowledgebase stores persistent client context — brand voice, preferences, identity guidelines. This is reference material that applies across all generation tasks for a contract, distinct from deliverables (which are versioned documents) and notes (which are timestamped activity).

#### MiD App v1

1. **Knowledgebase CRUD routes** — endpoints for managing knowledgebase entries per contract. Categories: brand voice, preferences, branding/identity, client guidelines.
2. **Knowledgebase entries get embedded** into `compass_knowledge` with appropriate metadata so they surface in RAG searches.
3. **Context assembly functions always include relevant knowledgebase entries** — brand voice and guidelines should be included in every generation request for a contract, not just when RAG finds them relevant.

#### Lovable

1. **Knowledgebase section in Compass nav** — organized by category.
2. **Entry management UI** — create, edit, delete knowledgebase entries.
3. **Import flow** — upload brand guidelines docs, process through intake.

---

### Priority 5: Channels (Paid Media First)

**Why fifth:** Channels are the generation layer. They consume deliverables and notes to produce new content. Paid Media is first because Master Marketer already has the working pipeline.

#### Master Marketer

1. **HTTP endpoints for ad generation** — `POST /generate/ads` with the campaign input schema already defined.
2. **Trigger.dev integration** — async processing for multi-platform × multi-type generation.
3. **`GET /jobs/:jobId`** — status polling endpoint.

#### MiD App v1

1. **Context assembly for Paid Media** — `src/services/compass/paid-media/context.ts`. Direct-fetch contract metadata, active plan, creative brief. RAG search for brand voice, past creative feedback, audience insights. Map into campaign input schema.
2. **Paid Media routes** — `src/routes/compass/paid-media.ts`. Trigger generation, poll for results, retrieve stored output.
3. **Result storage** — write generation output to `compass_deliverables` as a brief/creative deliverable with version history.

#### Lovable

1. **Paid Media channel UI** — generation trigger, configuration (select platforms, ad types, variations), progress display, result viewer.
2. **Ad copy display** — render each variation with post text, image copy, headline, visual direction, rationale.

#### Subsequent Channels

ABM, SEO/AEO, and Content follow the same pattern: Master Marketer builds the generation/analysis endpoints, MiD builds the context assembly and routes, Lovable builds the channel UI. Each channel is additive — the infrastructure from Paid Media (client service, job polling, result storage, RAG) is reused.

---

### Priority 6: Reference Library Migration

**Why sixth:** The ad reference library (28 examples) and visual styles library (12 formats) currently live as JSON files in Master Marketer. Moving them to Supabase allows team management through the Lovable UI.

#### Supabase

1. **New tables** — `reference_ad_examples` and `reference_visual_styles` (platform-level, not contract-scoped).

#### MiD App v1

1. **Library CRUD routes** — endpoints for managing reference examples and visual styles.
2. **Update context assembly** — when assembling Paid Media context, query the reference tables and include relevant examples in the payload under `reference_examples` and `visual_styles` fields.

#### Master Marketer

1. **Accept optional reference fields** — if `reference_examples` or `visual_styles` are in the payload, use them. If not, fall back to built-in JSON files.

#### Lovable

1. **Library management UI** — browse, add, edit, delete reference examples and visual styles.

---

## Coordination Protocol

Each service is developed in separate sessions. To stay in sync:

1. **Schema changes** — when Master Marketer defines a new intake/generate output schema, document it and share with MiD App v1 so storage and context assembly can be built to match.
2. **Endpoint readiness** — when Master Marketer ships an HTTP endpoint, notify MiD App v1 so the client service can wire up the call.
3. **UI requirements** — when MiD App v1 ships a new API route, document the request/response format so Lovable can build the corresponding UI.
4. **Shared documentation** — all architectural decisions, schemas, and integration contracts live in `docs/` in the MiD App v1 repo. Each service should reference these docs at session start.

### Key Documents

| Document | Location | Purpose |
|----------|----------|---------|
| `docs/current-state.md` | MiD App v1 repo | Full system overview — what's built, what's planned |
| `docs/architecture-summary.md` | MiD App v1 repo | Two-service architecture and endpoint catalog |
| `docs/rag-and-context-strategy.md` | MiD App v1 repo | RAG concepts, context assembly tables per generation type |
| `docs/sync-for-mid-app-v1.md` | MiD App v1 repo | Master Marketer's current state and integration contract |
| `docs/implementation-plan.md` | MiD App v1 repo | This document — priorities and build sequence |
| `docs/clickup-sync-logic.md` | MiD App v1 repo | ClickUp sync implementation details |
| `docs/quickbooks-sync-logic.md` | MiD App v1 repo | QuickBooks sync implementation details |
| `docs/technical-decisions.md` | MiD App v1 repo | Architecture and deployment decisions |
| `docs/edge-functions.md` | MiD App v1 repo | Supabase edge function API reference |

---

## Summary

| Priority | Focus | Depends On |
|----------|-------|-----------|
| **1** | Deliverable schemas, intake pipeline, storage, and UI | Master Marketer defines schemas and ships intake HTTP endpoints |
| **2** | Notes (meeting, management, strategy) | Deliverables in place; Master Marketer ships meeting-notes intake |
| **3** | RAG infrastructure (embeddings, chunking, vector search) | Deliverables and notes flowing into Supabase |
| **4** | Knowledgebase (brand voice, guidelines, preferences) | RAG infrastructure in place |
| **5** | Channels — Paid Media first, then ABM, SEO, Content | Deliverables + RAG + Master Marketer generate endpoints |
| **6** | Reference library migration to Supabase | Paid Media channel working end-to-end |

The deliverable hierarchy is the foundation. Everything else — notes, RAG, channels, generation — builds on top of structured deliverables being stored in Supabase. Start there.
