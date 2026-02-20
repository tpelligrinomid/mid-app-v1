# Content Ops Module — Compass Platform

> Living documentation for the Content Ops module. Covers all functionality, architecture, data model, and planned features. Maintained as we build and iterate.

---

## Overview

Content Ops is Compass's content lifecycle module: **ideation > production > publishing > intelligence**. It manages the full content pipeline for each client contract — from brainstorming ideas to generating AI-powered content to publishing and feeding it back into a knowledge library for future use.

### Core Capabilities

- **Content Library** — centralized repository of all client content (blog posts, videos, PDFs, newsletters, etc.)
- **Idea Pipeline** — lightweight ideation with AI-powered idea generation, drawn from the client's own content library and competitive intelligence
- **Idea-to-Asset Promotion** — approved ideas promote to full content assets with production tracking
- **AI Content Generation** — generate blog posts, newsletters, and more using prompt templates + the content library as context
- **Competitive Intelligence** — automated weekly competitor and industry digests that feed back into the knowledge base
- **Publish-to-Library** — content only enters the knowledge base when published, keeping the library clean and production-ready
- **Client View** — read-only calendar and asset view for client collaboration
- **Per-Contract Configuration** — content types, categories, and custom attributes are configurable per contract, seeded from global defaults

### Design Principles

1. **Only published content enters the knowledge base.** Drafts, in-progress work, and rejected ideas never pollute the library. Embeddings are created on publish.
2. **Per-contract config with global defaults.** Every contract gets its own content types, categories, and attributes — cloned from sensible defaults that strategists can customize.
3. **Two ways to use the library.** Strategists can hand-pick specific assets as inputs (manual select) or let the system find relevant content automatically (auto-retrieve via RAG).
4. **3-layer prompt system.** Global default templates, contract-specific overrides, and one-off customization — so every piece of content can be tailored without losing the base templates.

---

## Content Lifecycle

```
                                                    +------------------+
                                                    | Competitive      |
                                                    | Intelligence     |
                                                    | (weekly digest)  |
                                                    +--------+---------+
                                                             |
                                                             v
+----------+     +----------+     +-----------+     +--------+---------+
|  Ideas   | --> | Approved | --> |   Asset   | --> |    Published     |
|  (idea)  |     | (idea)   |     |  (draft)  |     |    (asset)       |
+----------+     +----------+     +-----------+     +--------+---------+
     ^                                  |                    |
     |                                  v                    v
     |                            +-----------+     +--------+---------+
     |                            | Production|     | Knowledge Base   |
     |                            | (review,  |     | (compass_        |
     |                            |  revise)  |     |  knowledge)      |
     +----------------------------+-----------+     +--------+---------+
     |  AI generates new ideas                               |
     |  from library + competitive intel                     |
     +-------------------------------------------------------+
```

**Statuses:**
- **Ideas**: `idea` > `approved` > `rejected`
- **Assets**: `draft` > `in_production` > `review` > `approved` > `published`

---

## Phase 1: Data Model + Config + Ideas + Assets (COMPLETE)

### Database Tables

All tables use the `content_` prefix.

#### `content_types`

What kind of content (blog, newsletter, video, etc.). Supports global defaults (contract_id = NULL) and per-contract customization.

| Column | Type | Description |
|--------|------|-------------|
| type_id | uuid PK | |
| contract_id | uuid FK (nullable) | NULL = global default |
| name | text | "Blog Post" |
| slug | text | "blog_post" |
| description | text | |
| icon | text | Optional icon identifier |
| is_active | boolean | Soft delete flag |
| sort_order | integer | Display ordering |

**Global defaults seeded:** blog_post, newsletter, social_media, video_script, podcast_episode, case_study, whitepaper, ebook, infographic, webinar

#### `content_categories`

Organizational grouping / taxonomy. Same global-default + per-contract pattern.

| Column | Type | Description |
|--------|------|-------------|
| category_id | uuid PK | |
| contract_id | uuid FK (nullable) | NULL = global default |
| name | text | "Thought Leadership" |
| slug | text | "thought_leadership" |
| description | text | |
| color | text | Hex color for UI |
| is_active | boolean | Soft delete flag |
| sort_order | integer | Display ordering |

**Global defaults seeded:** thought_leadership, product_marketing, customer_stories, industry_news, how_to, company_culture

#### `content_attribute_definitions`

Custom metadata fields per contract (no global defaults — these are truly client-specific). Values are stored as JSONB on ideas/assets.

| Column | Type | Description |
|--------|------|-------------|
| attribute_id | uuid PK | |
| contract_id | uuid FK (required) | |
| name | text | "Target Persona" |
| slug | text | "target_persona" |
| field_type | text | single_select, multi_select, boolean, text |
| options | jsonb | For select types: `[{"value": "cmo", "label": "CMO"}]` |
| is_required | boolean | |
| applies_to | text | ideas, assets, or both |
| sort_order | integer | |

#### `content_ideas`

Lightweight ideation items. Can be created manually or AI-generated.

| Column | Type | Description |
|--------|------|-------------|
| idea_id | uuid PK | |
| contract_id | uuid FK | |
| title | text | |
| description | text | |
| content_type_id | uuid FK | Links to content_types |
| category_id | uuid FK | Links to content_categories |
| source | text | `manual` or `ai_generated` |
| status | text | `idea`, `approved`, `rejected` |
| priority | integer | 1-5 (optional) |
| target_date | date | For calendar placement |
| custom_attributes | jsonb | Values matching attribute definitions |
| tags | text[] | Freeform tags |
| created_by | uuid FK | |

#### `content_assets`

Full content items in production or published. The core of the content library.

| Column | Type | Description |
|--------|------|-------------|
| asset_id | uuid PK | |
| contract_id | uuid FK | |
| idea_id | uuid FK (nullable) | Set when promoted from idea |
| title | text | |
| description | text | |
| content_type_id | uuid FK | |
| category_id | uuid FK | |
| content_body | text | Markdown body (written or generated) |
| content_structured | jsonb | Structured version if applicable |
| status | text | draft, in_production, review, approved, published |
| file_path | text | Supabase storage path |
| file_name | text | |
| file_size_bytes | bigint | |
| mime_type | text | |
| external_url | text | Published URL (blog link, YouTube, etc.) |
| clickup_task_id | text | |
| tags | text[] | |
| custom_attributes | jsonb | |
| published_date | date | |
| metadata | jsonb | AI tags, summary, ingestion info, etc. |
| created_by | uuid FK | |

### API Endpoints (Phase 1)

All routes mounted at `/api/compass/content`. Protected by auth middleware.

#### Configuration

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/config?contract_id=X` | Full config (types, categories, attributes) | admin, team_member |
| POST | `/config/initialize?contract_id=X` | Clone global defaults into contract | admin, team_member |

#### Content Types

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/types?contract_id=X` | List (contract + global) | admin, team_member |
| POST | `/types` | Create for contract | admin, team_member |
| PUT | `/types/:id` | Update | admin, team_member |
| DELETE | `/types/:id` | Soft delete (is_active = false) | admin, team_member |

#### Content Categories

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/categories?contract_id=X` | List (contract + global) | admin, team_member |
| POST | `/categories` | Create | admin, team_member |
| PUT | `/categories/:id` | Update | admin, team_member |
| DELETE | `/categories/:id` | Soft delete | admin, team_member |

#### Custom Attributes

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/attributes?contract_id=X` | List definitions | admin, team_member |
| POST | `/attributes` | Create definition | admin, team_member |
| PUT | `/attributes/:id` | Update definition | admin, team_member |
| DELETE | `/attributes/:id` | Hard delete | admin, team_member |

#### Ideas

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/ideas?contract_id=X&status=Y&category_id=Z` | List with filters | all (client access check) |
| GET | `/ideas/:id` | Get single idea | all (client access check) |
| POST | `/ideas` | Create idea | admin, team_member |
| PUT | `/ideas/:id` | Update idea | admin, team_member |
| DELETE | `/ideas/:id` | Delete idea | admin, team_member |
| POST | `/ideas/:id/promote` | Promote approved idea to draft asset | admin, team_member |

#### Assets

| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| GET | `/assets?contract_id=X&status=Y&content_type_id=Z` | List with filters | all (client access check) |
| GET | `/assets/:id` | Get single asset (full content) | all (client access check) |
| POST | `/assets` | Create asset directly | admin, team_member |
| PUT | `/assets/:id` | Update asset | admin, team_member |
| DELETE | `/assets/:id` | Delete asset + cleanup embeddings | admin, team_member |
| POST | `/assets/:id/ingest` | Manual: extract text, embed into knowledge base | admin, team_member |

### Key Flows

#### Config Initialization

When a contract enables the content module, call `POST /config/initialize?contract_id=X`. This clones all global default types and categories into contract-specific rows that strategists can then customize (add, remove, rename, reorder).

#### Promote Flow (Idea to Asset)

`POST /ideas/:id/promote`:
1. Validates idea exists and status is `approved`
2. Checks idea hasn't already been promoted (no duplicate assets)
3. Creates new `content_assets` row copying title, description, content_type_id, category_id, custom_attributes, tags from the idea
4. Sets asset status to `draft`
5. Returns the new asset

#### Publish and Embed

When an asset's status is updated to `published` (via `PUT /assets/:id`):
1. Detects the status transition (previous status != published)
2. Automatically extracts embeddable content (content_body or content_structured)
3. Ingests into `compass_knowledge` via the RAG pipeline (chunk, embed, store)
4. Asset is now in the content library and available for RAG search during idea/content generation

The manual `POST /assets/:id/ingest` endpoint is also available for re-ingestion (e.g., content updated after publish).

#### Adding Existing Content

To backfill older content into the library:
1. Create an asset via `POST /assets` with the content details (title, description, content_body, external_url, file info, etc.)
2. Set status to `published` and the system will auto-embed on create
3. Or create as `draft`, add content, then update status to `published`

Supported source types for existing content:
- **Text / Markdown** — paste into `content_body`
- **Blog posts** — set `external_url` to the live URL, paste content into `content_body`
- **PDFs / Documents** — upload to Supabase storage, set `file_path`, `file_name`, `mime_type`
- **Video content** — paste transcript into `content_body`, set `external_url` to YouTube/Vimeo link
- **Structured data** — use `content_structured` for JSON-formatted content

> Note: File text extraction (PDF, DOCX) and URL content scraping are planned for Phase 2. Currently, text content must be provided in `content_body` or `content_structured`.

---

## Phase 2: AI Generation + Prompt Sequences + Competitive Intelligence

### Prompt Sequences (Multi-Step Pipelines) — COMPLETE

Instead of single-shot prompts, content generation uses **prompt sequences** — ordered multi-step pipelines tied to each content type. Each step's output feeds into the next, enabling workflows like: draft → review → enrich.

#### Database: `content_prompt_sequences`

| Column | Type | Description |
|--------|------|-------------|
| sequence_id | uuid PK | |
| contract_id | uuid FK (nullable) | NULL = global default |
| content_type_slug | text | Links to content type (e.g. 'blog_post') |
| name | text | "Standard Blog Post" |
| description | text | |
| steps | jsonb | Ordered array of prompt steps |
| variables | jsonb | Template variables shared across all steps |
| is_default | boolean | Default sequence for this content type |
| is_active | boolean | Soft delete flag |
| sort_order | integer | |

#### Steps Array Structure

Each step in the `steps` JSONB array:

```json
{
    "step_order": 1,
    "name": "draft",
    "system_prompt": "You are an expert content writer for {{company_name}}...",
    "user_prompt": "Write a blog post about {{topic}}...",
    "output_key": "draft"
}
```

**Step references**: Later steps can reference earlier step outputs using `{{step:output_key}}` syntax. For example, a review step's user_prompt can include `{{step:draft}}` to receive the draft step's full output.

#### Variables Array Structure

Variables defined at the sequence level, available in all steps:

```json
[
    {"name": "topic", "label": "Topic", "type": "text", "required": true},
    {"name": "angle", "label": "Angle", "type": "text", "required": true},
    {"name": "audience", "label": "Target Audience", "type": "text", "required": true}
]
```

**Two types of variables in prompts:**
1. **Strategist variables** (defined in `variables` array) — require strategist input (topic, angle, audience)
2. **Client variables** (auto-populated) — `{{company_name}}`, `{{industry}}`, `{{brand_voice}}` are resolved from the contract config automatically

#### 3-Layer System

1. **Global defaults** (contract_id = NULL) — shipped with the system. Seeded for blog_post, newsletter, case_study, social_media, video_script.
2. **Contract overrides** (contract_id set) — cloned from globals on config initialize, then customizable per contract. Strategists can add, edit, reorder steps, or create entirely new sequences.
3. **One-off customization** — when generating, strategist can duplicate any sequence and edit prompts inline before submitting.

#### Default Sequences Seeded

| Content Type | Sequence Name | Steps | Description |
|--------------|--------------|-------|-------------|
| blog_post | Standard Blog Post | draft → review | Comprehensive blog post with editorial review |
| blog_post | Thought Leadership | draft → review | Authoritative opinion piece with argument strengthening |
| newsletter | Standard Newsletter | draft → review | Email newsletter with readability optimization |
| case_study | Standard Case Study | draft → review | Challenge-solution-results format with credibility check |
| social_media | Social Post | generate | Single-step, 3 variations per platform |
| video_script | Standard Video Script | draft → review | Script with speaker notes and visual cues |

#### Prompt Sequence Routes

```
GET    /prompt-sequences?contract_id=X&content_type_slug=Y  -- List (contract + global)
GET    /prompt-sequences/:id                                 -- Get single
POST   /prompt-sequences                                     -- Create for contract
PUT    /prompt-sequences/:id                                 -- Update
DELETE /prompt-sequences/:id                                 -- Soft delete
POST   /prompt-sequences/:id/duplicate                       -- Copy into contract
```

### AI Content Generation

**Route**: `POST /api/compass/content/assets/:id/generate`

Generates content for an existing asset using a prompt sequence + context from the content library.

#### Request

```typescript
{
  sequence_id: string;                // which prompt sequence to use
  step_overrides?: {                  // optional one-off customization (layer 3)
    [output_key: string]: {
      system_prompt?: string;
      user_prompt?: string;
    }
  };
  variables: Record<string, string>;  // template variable values (topic, angle, etc.)
  reference_asset_ids?: string[];     // MANUAL SELECT: hand-picked library assets as inputs
  auto_retrieve?: boolean;            // AUTO RETRIEVE: RAG search library for relevant content
  primary_meeting_ids?: string[];     // meeting transcript context
  instructions?: string;              // additional strategist notes
}
```

#### Two Content Library Input Modes

1. **Manual select** (`reference_asset_ids`) — Strategist explicitly picks specific published assets as inputs. Example: "Use this video transcript and this case study to write a blog post." The system fetches those assets' full content directly by ID.

2. **Auto-retrieve** (`auto_retrieve: true`) — System takes the topic/brief, does a RAG similarity search against `compass_knowledge`, and automatically pulls in the most relevant published content. No manual selection needed — it finds what's relevant.

Both can be used in the same request — hand-pick some assets AND let the system find additional relevant content.

#### Backend Processing

1. Resolve sequence (look up by sequence_id)
2. Apply step_overrides if provided (merge into the sequence's steps)
3. If `reference_asset_ids`: fetch those assets' content directly from `content_assets`
4. If `auto_retrieve`: similarity search `compass_knowledge` for relevant chunks
5. Assemble context: brand voice (from contract config), referenced assets, retrieved chunks, meeting transcripts, competitive intelligence
6. Fill template variables into all step prompts
7. Submit to Master Marketer `/api/generate/content-piece` with the `steps` array
8. MM executes steps sequentially, piping each step's output into the next via `{{step:output_key}}` references
9. Store final result in asset's `content_body` + `content_structured`
10. Asset remains in current status (strategist reviews and publishes when ready)

### AI Idea Generation

**Route**: `POST /api/compass/content/ideas/generate`

Generates content ideas using the client's content library, content plan, and competitive intelligence as context.

#### Request

```typescript
{
  contract_id: string;
  prompt: string;                  // "Give me 5 ideas about innovation"
  count?: number;                  // how many ideas to generate (default 5)
  content_type_id?: string;        // target a specific content type
  category_id?: string;            // target a specific category
  use_library?: boolean;           // search content library for inspiration (default true)
  use_content_plan?: boolean;      // pull from deliverables for strategic alignment
  avoid_duplicates?: boolean;      // check existing ideas to avoid repeats (default true)
}
```

#### Backend Processing

1. If `use_library` (default true): RAG search `compass_knowledge` with the prompt to find relevant published content — including competitive intelligence digests
2. If `use_content_plan`: fetch deliverables (content plans, roadmaps) for this contract
3. If `avoid_duplicates`: fetch existing ideas for this contract so AI knows what's already been proposed
4. Assemble context: brand voice, industry, relevant library content, competitive intel, existing ideas, content plan
5. Submit to AI with prompt + context
6. Parse response into individual ideas
7. Save each as `content_ideas` with `source: 'ai_generated'`
8. Return generated ideas

#### Response

```typescript
{
  ideas: ContentIdea[];
  context_used: {
    library_chunks: number;
    existing_ideas: number;
    deliverables: number;
  }
}
```

### Competitive Intelligence Module

Automated competitive research and industry monitoring. Configured per contract, runs on a weekly schedule via Master Marketer.

**Important: Competitive intel is reference material, NOT client content.** It is stored in its own table (`content_competitive_digests`), not in `content_assets`. It is embedded into `compass_knowledge` with `source_type: 'competitive_intel'` — a distinct type from `'content'` (client content). This separation ensures the AI never confuses competitor material with the client's own work.

#### How It Works

1. **Configure per contract** — define competitors (name, domain, blog URL, social URLs), industry keywords, and monitoring preferences
2. **Scheduled execution** — Master Marketer runs a weekly competitive analysis job (or on-demand)
3. **Research sources** — uses Exa.ai (or similar) to:
   - Monitor competitor blog posts, content, and social activity
   - Track industry news and trends for configured keywords
   - Surface notable YouTube videos, podcasts, or other content from competitors
4. **Generate digest** — AI synthesizes findings into a structured competitive intelligence report
5. **Store as digest** — report is saved in `content_competitive_digests` (separate from client assets)
6. **Embed as reference** — digest content is embedded into `compass_knowledge` with `source_type: 'competitive_intel'`
7. **Available for idea generation** — when generating ideas, RAG search includes competitive intel for inspiration and gap analysis
8. **Excluded from content generation quoting** — when generating content, the system filters to `source_type: 'content'` only, so competitor material is never quoted or repurposed directly

#### Source Type Separation in compass_knowledge

| source_type | What it contains | Used in idea generation | Used in content generation |
|-------------|-----------------|------------------------|---------------------------|
| `content` | Client's own published content (blogs, videos, PDFs, etc.) | Yes — as inspiration | Yes — can quote, repurpose, remix |
| `competitive_intel` | Competitor activity, industry trends, market gaps | Yes — for gap analysis and inspiration | No — never quoted, only directional awareness |
| `note` | Meeting notes, strategy notes | Yes | Yes — context |
| `deliverable` | Research, roadmaps, content plans | Yes | Yes — context |
| `meeting` | Meeting transcripts | Yes | Yes — context |

This means the AI prompt for content generation can say: "Here's the client's published content (use freely)" while idea generation can say: "Here's what competitors are doing (use for inspiration, don't copy)."

#### Database Tables

**`content_competitor_config`** — Per-contract competitive intelligence configuration.

```sql
CREATE TABLE content_competitor_config (
    config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    competitors jsonb NOT NULL,        -- [{name, domain, blog_url, social_urls, youtube_channel}]
    industry_keywords text[],          -- ["martech", "marketing automation", "ABM"]
    schedule text DEFAULT 'weekly',    -- 'weekly' | 'biweekly' | 'monthly'
    is_active boolean DEFAULT true,
    last_run_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

**`content_competitive_digests`** — Stored digests (separate from content_assets).

```sql
CREATE TABLE content_competitive_digests (
    digest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    config_id uuid REFERENCES content_competitor_config(config_id),
    title text NOT NULL,               -- "Competitive Digest — Week of Feb 17, 2026"
    period_start date,
    period_end date,
    content_body text,                 -- markdown report
    content_structured jsonb,          -- structured data (competitors, trends, opportunities)
    metadata jsonb,                    -- sources_checked, exa_queries_run, etc.
    created_at timestamptz DEFAULT now()
);
```

#### Competitive Intelligence Routes

```
GET    /competitive-config?contract_id=X         -- Get config
POST   /competitive-config                       -- Create/update config
PUT    /competitive-config/:id                   -- Update config
POST   /competitive-config/:id/run               -- Trigger on-demand run
GET    /competitive-digests?contract_id=X         -- List digests
GET    /competitive-digests/:id                   -- Get single digest
```

#### Digest Output Structure

```typescript
{
  content_body: "# Competitive Intelligence Digest — Week of Feb 17, 2026\n\n## Competitor Activity\n...",
  content_structured: {
    period: { start: "2026-02-10", end: "2026-02-16" },
    competitors: [
      {
        name: "Competitor A",
        new_content: [{ title, url, type, summary }],
        notable_changes: ["Launched new product page", "Published thought leadership series"]
      }
    ],
    industry_trends: [
      { topic: "AI in marketing", summary: "...", sources: [...] }
    ],
    content_opportunities: [
      "Competitor A hasn't covered X topic — opportunity for thought leadership",
      "Rising search interest in Y — consider a how-to guide"
    ]
  },
  metadata: {
    digest_type: "competitive_intel",
    sources_checked: 15,
    exa_queries_run: 8
  }
}
```

The `content_opportunities` field is especially valuable — these surface directly when generating ideas, giving strategists data-backed content suggestions without ever being mistaken for the client's own content.

#### Key Files (Competitive Intelligence)

| File | Action |
|------|--------|
| `backend/migrations/012_competitive_intelligence.sql` | Create config + digests tables |
| `backend/src/services/content-generation/competitive-intel.ts` | Research + digest generation |
| `backend/src/routes/compass/content.ts` | Add competitive config + digest routes |
| `backend/src/types/rag.ts` | Add `'competitive_intel'` to SourceType |
| Master Marketer | New scheduled job type for competitive analysis |

---

## Phase 3: Calendar View + Client-Facing View + ClickUp Linking

### Content Calendar

**Route**: `GET /api/compass/content/calendar?contract_id=X&start=YYYY-MM-DD&end=YYYY-MM-DD`

Returns a merged view of:
- **Ideas** with `target_date` set (status: idea or approved)
- **Assets** with `published_date` or estimated dates from ClickUp

#### Response

```typescript
{
  calendar: Array<{
    id: string;
    type: 'idea' | 'asset';
    title: string;
    date: string;
    content_type: { name: string; slug: string };
    category?: { name: string; color: string };
    status: string;
    clickup_task_id?: string;
  }>
}
```

### Client-Facing View

Read-only view for clients. Uses `contract_modules` table to check if content module is enabled + client_visible.

**What clients see:**
- Content calendar (ideas in pipeline + published assets)
- Asset detail view (title, description, published URL, ClickUp task link)
- Status indicators showing what's in production

**What clients cannot do:**
- Create, edit, or delete ideas or assets
- Generate content
- Access configuration or prompt templates

#### Routes

```
GET  /client/assets?contract_id=X               -- Client-facing asset list
GET  /client/calendar?contract_id=X&start=&end=  -- Client-facing calendar
```

### ClickUp Integration

When an idea is promoted to an asset:
- Optionally auto-create a ClickUp task in the contract's folder
- Store `clickup_task_id` on the asset
- Link displayed in both internal and client views
- Task status can sync with asset status

---

## Architecture

### Key Files

| File | Status | Description |
|------|--------|-------------|
| `backend/migrations/010_content_module.sql` | Complete | Phase 1 tables + seed data |
| `backend/src/types/content.ts` | Complete | Types, enums, DTOs, validation |
| `backend/src/routes/compass/content.ts` | Complete (Phase 1) | All content routes |
| `backend/src/index.ts` | Modified | Mounts `/api/compass/content` |
| `docs/schema.sql` | Updated | Content tables added |
| `backend/migrations/011_content_prompt_sequences.sql` | Complete | Phase 2 — prompt sequences table + seeds |
| `backend/migrations/012_competitive_intelligence.sql` | Planned | Phase 2 |
| `backend/src/services/content-generation/processor.ts` | Planned | Phase 2 |
| `backend/src/services/content-generation/idea-generator.ts` | Planned | Phase 2 |
| `backend/src/services/content-generation/competitive-intel.ts` | Planned | Phase 2 |

### Integration Points

- **RAG Pipeline** (`backend/src/services/rag/`) — content embedding and similarity search
- **Master Marketer** — AI content generation, idea generation, competitive analysis
- **Exa.ai** — competitive research data source
- **ClickUp** — task creation and linking
- **Supabase Storage** — file uploads (PDFs, documents, etc.)
- **compass_knowledge** — shared knowledge base (notes, deliverables, meetings, content all searchable together)

### Data Flow

```
CLIENT CONTENT (source_type: 'content')          GENERATION
-----------------------------------------         -----------
Blog posts       \                                / Blog posts
Videos (transcripts) \     compass_knowledge     / Newsletters
PDFs / Documents      >-- embed --> (RAG) -------> Video scripts
                     /                            \ Social posts
Notes, Meetings,    /
Deliverables       /

COMPETITIVE INTEL (source_type: 'competitive_intel')
-----------------------------------------
Competitor blogs  \                                IDEAS
Industry news      >-- embed --> (RAG) ----------> Idea generation
Market trends     /          (separate bucket,     (inspiration +
                              never quoted)         gap analysis)
```

---

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Data Model + Config + Ideas + Assets | **Complete** | All CRUD, promote, ingest, publish-to-embed |
| Phase 2: Prompt Templates + AI Generation | **Planned** | Content generation, idea generation, competitive intel |
| Phase 3: Calendar + Client View + ClickUp | **Planned** | UI-focused, client collaboration |
