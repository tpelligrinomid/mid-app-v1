# The MiD Platform: Pulse & Compass

## An Agency Operating System Built for the AI Era

---

## What Is the MiD Platform?

The MiD Platform is a proprietary operating system purpose-built for running a modern marketing agency. It replaces the patchwork of spreadsheets, project management tools, and manual processes that most agencies rely on with a unified, AI-native system that connects every layer of agency operations — from contract financials to strategic deliverable production.

The platform has two modes:

- **Pulse** — The portfolio-level operations dashboard. Pulse consolidates data from project management (ClickUp), accounting (QuickBooks), and CRM (HubSpot) into a single real-time view of every active contract. It tracks financial health, delivery velocity, and team utilization across the entire book of business.

- **Compass** — The per-contract intelligence workspace. Compass is where strategists do their actual work: capturing meeting insights, assembling knowledge bases, generating AI-powered deliverables, and managing the strategic document lifecycle for each client.

Together, Pulse and Compass give agency leadership full visibility into portfolio health while giving strategists a systematized workflow for producing premium deliverables at scale.

---

## The Problem We Solved

Most agencies operate on tribal knowledge. Client strategy lives in people's heads. Meeting decisions get lost. Deliverables are created from scratch every time, with no institutional memory. When a strategist leaves, the client relationship starts over.

Meanwhile, leadership has no reliable way to answer basic questions: Which contracts are on track? Where are we over-delivering? Which clients are at risk?

The MiD Platform solves both problems simultaneously. Pulse provides the portfolio-level answers. Compass captures the institutional knowledge and uses it to power AI-assisted deliverable generation — so every new deliverable builds on everything the agency has ever learned about that client.

---

## Pulse: The Portfolio Command Center

### What It Does

Pulse continuously syncs operational data from the tools the agency already uses and consolidates it into a unified view of portfolio health. No manual data entry. No stale spreadsheets. Real-time truth.

### Data Integration

Pulse maintains automated, bidirectional connections with three core systems:

**ClickUp (Project Management)**
- Syncs tasks, time entries, team assignments, and task status every 15 minutes on business days
- Full portfolio refresh every Sunday to catch any sync gaps
- Maps ClickUp's custom statuses to standardized agency stages (planned, working, delivered, blocked)
- Tracks the process library — the agency's master taxonomy of marketing execution tasks with point estimates

**QuickBooks (Financial)**
- Syncs invoices, credit memos, and payments every 15 minutes
- Automatically parses invoice memos to extract contract numbers and point allocations
- Links every financial transaction to the correct contract
- Provides real-time revenue and billing visibility

**HubSpot (CRM)**
- Company and deal data for pipeline visibility
- Links CRM records to active contracts

### The Points Economy

At the heart of Pulse is a points-based delivery tracking system. Every marketing activity in the agency's process library has a point value — a standardized measure of effort. Contracts are sold with a monthly points allotment, and Pulse tracks the full lifecycle:

| Metric | Source | What It Tells You |
|--------|--------|-------------------|
| Points Purchased | QuickBooks invoices | What the client has paid for |
| Points Credited | QuickBooks credit memos | Adjustments (positive or negative) |
| Points Delivered | ClickUp completed tasks | What the team has produced |
| Points Working | ClickUp active tasks | What's currently in progress |
| Points Balance | Calculated | Purchased + Credited - Delivered |
| Points Burden | Calculated | Whether delivery is ahead or behind schedule |

A contract is **on track** when its burden is zero or negative (the agency is ahead of or matching delivery expectations). A contract is **off track** when burden is positive (the agency owes more work than has been delivered relative to billing). This single metric gives leadership an instant read on every client relationship.

### Management Reports

Pulse generates frozen-snapshot portfolio reports on a weekly cadence (with monthly and quarterly options). Each report captures, for every active contract:

- Financial position (MRR, points balance, billing status)
- Delivery performance (13-week rolling delivery velocity)
- Meeting sentiment (AI-analyzed from recorded meetings)
- Team assignment (account manager, team manager)
- On-track vs. off-track status

These reports create an audit trail of portfolio health over time. Leadership can see trends, spot contracts drifting off track before they become problems, and make data-driven decisions about resource allocation.

### Automated Client Status Reports

Pulse powers automated, branded client-facing status reports that go out on a configurable schedule (weekly or monthly). Each report includes:

- Points summary showing value delivered
- Recently completed work
- Work currently in progress
- Items waiting on client action

These reports are generated automatically from live data — no strategist time required to produce them. They keep clients informed, demonstrate accountability, and reduce the "what have you been doing?" conversations that erode client trust.

### Sync Monitoring

Every data sync is logged with full audit trails — start time, completion time, records processed, errors encountered. The sync dashboard gives operations visibility into system health and surfaces any integration issues before they affect reporting accuracy.

---

## Compass: The AI-Powered Strategy Workspace

### What It Does

Compass is the workspace where agency strategy gets built, captured, and evolved. It combines knowledge management, meeting intelligence, and AI-powered document generation into a single per-contract workspace.

### The Knowledge Base

Every piece of client intelligence flows into a structured knowledge base:

**Meetings**
- Meeting transcripts from Fireflies (automatic) or manual entry
- AI-generated sentiment analysis (positive/neutral/negative with confidence scoring and key topic extraction)
- Automatic creation of structured meeting notes with decisions, action items, and key topics
- Full transcript preservation for future reference and AI context

**Notes**
- Categorized strategic notes: ABM insights, paid media observations, content strategy, web/technical findings, status updates, strategic decisions
- Action items with assignees and due dates
- Linked to source meetings when applicable
- Published/draft/archived workflow

**Process Library**
- The agency's complete taxonomy of marketing execution tasks
- Organized by phase: Foundation, Execution, Analysis
- Each process has a name, description, point estimate, and time estimate
- Synced from ClickUp and used as building blocks in AI-generated roadmaps

Every piece of content — meetings, notes, deliverables — is automatically embedded into a vector database using AI embeddings. This creates a semantic search layer across the entire client knowledge base, enabling the AI generation system to pull relevant context from everything the agency has ever captured about a client.

### The Document Hierarchy

Compass follows a deliberate four-tier document hierarchy, where each level builds on the one above:

```
Research Report (foundational intelligence, refreshed quarterly)
      |
      v
Strategic Roadmap (direction and phasing, reviewed quarterly)
      |
      v
Tactical Plans (execution-level detail, per campaign or channel)
      |
      v
Creative Briefs & Execution Assets (ad copy, content, landing pages)
```

Meeting notes and strategic observations feed back into every layer. This hierarchy ensures that execution is always connected to strategy, which is always grounded in research.

### AI-Powered Deliverable Generation

This is the core innovation. Compass doesn't just store documents — it generates them using AI that has full access to the client's knowledge base.

**How It Works:**

1. A strategist creates a deliverable (e.g., a Q2 Strategic Roadmap) and clicks "Generate"
2. Compass automatically assembles the relevant context:
   - Prior deliverables (the last research report, the previous quarter's roadmap)
   - Meeting transcripts from key strategy sessions
   - The agency's process library with point estimates
   - The contract's monthly points budget
   - Client and competitor profiles
3. This context package is submitted to Master Marketer, the agency's dedicated AI intelligence service
4. Master Marketer processes the context using Claude (Anthropic's most capable AI model) and returns a structured deliverable
5. The result is written back to Compass, ready for strategist review, editing, and client delivery

The entire process runs asynchronously. The strategist triggers generation and continues working. When the deliverable is ready (typically 2-5 minutes), it appears in their workspace.

### Deliverable Types

**Research Report**
- 25,000-35,000 word competitive intelligence documents
- Analyzes client positioning against competitors across organic SEO, social media, content strategy, paid media, and brand positioning
- Includes competitive scoring matrix with justifications
- Generated from client and competitor company profiles (domains, social handles)
- Refreshed quarterly as the competitive landscape evolves

**Strategic Roadmap**
- Structured strategic document with 10 sections: overview, target market profiles with empathy maps, brand story (StoryBrand framework), products & solutions matrix, competitive analysis with scoring, measurable goals, phased roadmap, quarterly initiatives (OKR format), 12-month annual plan (Gantt-style), and monthly points allocation plan
- Built from research data, meeting transcripts, and the process library
- Respects the contract's points budget — the AI allocates real tasks from the process library within the monthly points allotment
- Supports evolutionary generation: each new roadmap builds from the previous quarter's output rather than starting from scratch

**SEO & AEO Audit**
- Technical SEO analysis with competitive benchmarking
- Accepts seed topics for crawl prioritization and configurable crawl depth
- Automatically references the client's research report for competitive context
- Produces structured findings with actionable recommendations

**Content Plan**
- Tactical content execution roadmap built from multiple upstream deliverables
- Automatically pulls in the client's roadmap, SEO audit, and research report
- Incorporates meeting transcripts from planning sessions
- Supports quarterly iteration — each new content plan evolves from the previous quarter's plan

**Marketing Plans & Creative Briefs**
- Channel-specific tactical plans with timelines, KPIs, and budget estimates
- Creative briefs with target audience, key messages, deliverables, and requirements

### Document Conversion

Not every deliverable starts from AI generation. Compass also supports converting existing documents into the platform's structured format. Strategists can upload an existing roadmap, plan, or brief (as text, markdown, or PDF via file URL) and have Master Marketer parse and restructure it into the standard schema. This is critical for onboarding — when a new client comes in with existing strategy documents, those documents can be ingested into Compass immediately rather than recreated.

### Version Control

Every deliverable supports versioning. Strategists can create snapshots at any point, track changes over time, and maintain a complete history of how a client's strategy has evolved. When combined with the AI's ability to build from prior versions, this creates a continuous strategic narrative rather than disconnected quarterly documents.

### Client-Facing Delivery

Deliverables are rendered as premium, branded presentations — not exported as raw documents. Research reports include interactive tables of contents, styled competitive scoring matrices, and professional typography. Roadmaps render as visual timelines with phased initiative cards, spider charts for competitive scoring, empathy map grids, and Gantt-style annual plans. The presentation quality is designed to feel like a $15K+ consulting engagement.

Deliverables can be shared via secure links (no login required for clients) and exported as formatted PDFs with cover pages, MiD branding, and page numbers.

---

## The Intelligence Layer: Master Marketer

Behind Compass is Master Marketer — a dedicated AI intelligence service that handles all content generation, document analysis, and structured data extraction. It's a stateless processing engine: it receives structured JSON input and returns structured JSON output. It never accesses the database directly, never manages users or permissions, and never stores state between requests.

This clean separation means:

- **The MiD Platform is the orchestrator.** It gathers context, manages permissions, stores results, and presents the UI.
- **Master Marketer is the brain.** It processes input and generates output. Nothing more.

Master Marketer handles four categories of work:

| Category | What It Does | Example |
|----------|-------------|---------|
| **Intake** | Converts unstructured documents into standardized JSON | A PDF roadmap becomes structured, queryable data |
| **Generate** | Produces new content from structured input | Research data + transcripts become a strategic roadmap |
| **Analyze** | Interprets performance data and produces recommendations | Weekly metrics become actionable insights |
| **Export** | Formats structured data into presentation-ready output | Structured JSON becomes a branded PDF report |

All generation tasks run asynchronously via Trigger.dev (a background job framework). When a job completes, Master Marketer calls a webhook on the MiD Platform backend, which stores the result and notifies the frontend. This architecture handles long-running generation tasks (some deliverables take 3-5 minutes) without blocking the user interface.

---

## Architecture Overview

```
                        Lovable (React Frontend)
                     Pulse Dashboard | Compass Workspace
                                |
                                | JWT Authentication (Supabase Auth + Google OAuth)
                                v
                    MiD App v1 Backend (Node.js/Express on Render)
                   /          |          |            \
                  /           |          |             \
                 v            v          v              v
           ClickUp API   QuickBooks   HubSpot    Master Marketer
           (Tasks,       (Invoices,   (CRM)      (AI Generation)
            Time,         Credits,                     |
            Users)        Payments)                    | Webhook callback
                 \           |          |             /
                  \          |          |            /
                   v         v          v           v
                        Supabase (PostgreSQL + pgvector)
                     Auth | Database | Edge Functions | Storage
```

### Key Architectural Decisions

**Supabase as the Data Layer**
- PostgreSQL with Row Level Security for multi-tenant data isolation
- pgvector extension for AI embeddings and semantic search
- Edge Functions for privileged database operations (bypassing RLS when needed)
- Built-in authentication with Google OAuth support
- File storage for document uploads and assets

**Automated Sync Pipeline**
- Render Cron triggers HTTP endpoints on a schedule
- Incremental syncs every 15 minutes on business days for near-real-time data
- Full syncs weekly to catch any gaps
- Complete audit trail of every sync operation

**Async AI Processing**
- All AI generation runs asynchronously (fire-and-forget from the user's perspective)
- Webhook callbacks deliver results when complete
- Polling fallback if webhook delivery fails
- Recovery endpoints for manual result retrieval
- Generation state tracked in database metadata

**RAG (Retrieval-Augmented Generation)**
- All content automatically embedded using OpenAI's text-embedding-3-small model
- Vector search enables context assembly from the full client knowledge base
- AI generation is informed by everything the agency has captured — meetings, notes, prior deliverables
- This is what makes the AI output genuinely useful rather than generic

---

## What This Means for an Agency

### For Leadership
- Real-time portfolio visibility without manual reporting
- Early warning when contracts drift off track
- Data-driven resource allocation decisions
- Automated client communication that builds trust
- Complete audit trail of portfolio health over time

### For Strategists
- AI-generated deliverables that build on real client knowledge, not generic templates
- Institutional memory that persists regardless of team changes
- Meeting intelligence that captures decisions and action items automatically
- Version-controlled strategy documents that show evolution over time
- Premium presentation quality that elevates the agency's brand

### For Clients
- Consistent, proactive status reporting
- Premium-quality deliverables that demonstrate strategic depth
- Transparent points tracking that shows value delivered
- Strategy that builds quarter over quarter rather than starting fresh

### For the Business
- Deliverables that used to take weeks can be generated in minutes
- Strategic quality scales with the platform, not just headcount
- Client knowledge is an organizational asset, not locked in individual contributors
- The points economy creates a standardized, auditable measure of value delivery
- Every quarter's work compounds — research informs roadmaps, roadmaps inform plans, plans inform execution

---

## The Deliverable Generation Pipeline in Detail

To illustrate the depth of the system, here's the complete flow for generating a strategic roadmap — the agency's most complex deliverable:

**1. Strategist triggers generation** in Compass, optionally providing custom instructions and selecting key meeting transcripts to prioritize.

**2. Context assembly begins automatically:**
- The system finds the most recent completed research report for the client and extracts the competitive analysis and full narrative
- It resolves the previous quarter's roadmap (if one exists) so the AI can evolve strategy rather than starting cold
- It assembles meeting transcripts from selected strategy sessions
- It pulls the agency's process library, filtering to actionable phases (Foundation, Execution, Analysis) and including only tasks with positive point estimates
- It fetches the contract's monthly points budget from the billing system

**3. The assembled context is submitted** to Master Marketer as a structured JSON payload containing: client profile, competitive research, meeting transcripts, process library with point values, points budget, and (optionally) the previous roadmap.

**4. Master Marketer generates** a structured 10-section roadmap:
- **Overview** with a 6-step process timeline
- **Target Market** profiles with detailed empathy maps (thinks, feels, says, does, sees, hears, pains, goals)
- **Brand Story** using the StoryBrand framework (character, problem, guide, plan, call to action, success, failure, transformation)
- **Products & Solutions** matrix mapping offerings to customer outcomes
- **Competitive Analysis** with 5-dimension scoring (organic SEO, social media, content strategy, paid media, brand positioning)
- **Goals** with measurable outcomes, benchmarks, and data sources
- **Roadmap Phases** with monthly themes, deliverables, and milestones
- **Quarterly Initiatives** in OKR format
- **Annual Plan** as a 12-month Gantt chart
- **Points Plan** allocating specific process library tasks to each month within the budget

**5. The result is delivered** via webhook callback, stored in the database, and automatically ingested into the vector knowledge base for future context.

**6. The strategist reviews** the generated roadmap in the branded viewer — a visual presentation with timeline layouts, spider charts, empathy map grids, and Gantt visualizations. They can edit, refine, version, and ultimately share a polished deliverable with the client.

The entire process — from clicking "Generate" to reviewing a complete, structured, points-budgeted strategic roadmap — takes approximately 3-5 minutes. The same deliverable created manually takes an experienced strategist 2-3 weeks.

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React (Lovable) | Dashboard UI and strategy workspace |
| Backend | Node.js + TypeScript + Express | API, orchestration, sync |
| Database | Supabase (PostgreSQL + pgvector) | Data storage, auth, vector search |
| AI Generation | Claude (Anthropic) via Master Marketer | Deliverable generation and analysis |
| Background Jobs | Trigger.dev | Long-running AI tasks |
| Project Management | ClickUp API | Task and time sync |
| Accounting | QuickBooks API | Invoice and payment sync |
| CRM | HubSpot API | Company and deal data |
| Email | n8n (workflow automation) | Status reports and notifications |
| Hosting | Render | Backend and AI service deployment |
| Auth | Supabase Auth + Google OAuth | User authentication and RBAC |

---

## Where We're Going

The platform is designed to expand along two axes:

**More Compass Apps** — Each marketing discipline gets its own AI-powered workspace within Compass. Paid media, ABM campaigns, content marketing, SEO, reporting, events, and podcasting each have distinct workflows that benefit from structured knowledge capture and AI-assisted generation. The core pipeline (knowledge base + context assembly + AI generation + webhook delivery) is reusable across all of them.

**Deeper Intelligence** — As the knowledge base grows per client, the AI gets more effective. The RAG system means every new deliverable benefits from every meeting, every note, and every prior deliverable. Over time, the platform develops a genuine understanding of each client's business, competitive landscape, and strategic direction. The AI doesn't just generate documents — it generates documents that reflect the accumulated intelligence of the entire client relationship.

The vision is an agency where strategic quality is systematized, institutional knowledge compounds over time, and the AI handles the production work so strategists can focus on insight, creativity, and client relationships.

---

*Built by Marketers in Demand. Powered by proprietary AI.*
