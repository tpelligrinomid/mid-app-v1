# Content Intelligence Engine

## Overview

An automated content pipeline that combines **SEO data**, **competitor gap analysis**, and **existing content library intelligence** to continuously generate, refresh, and optimize content — with minimal manual intervention.

The system tracks keyword rankings over time, identifies opportunities and declining content, and feeds those signals into an AI-powered ideation and generation engine that produces draft assets for strategist review.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Weekly Cron Job                           │
│                                                                  │
│  1. Keyword Snapshot     Pull latest rankings, search volume,    │
│     Collection           and difficulty via Master Marketer      │
│                          (DataForSEO)                            │
│                                                                  │
│  2. Gap Analysis         Compare client vs competitors —         │
│                          find keywords they rank for that        │
│                          the client doesn't                      │
│                                                                  │
│  3. Content Library      RAG search existing content to see      │
│     Scan                 what's already covered, what's thin     │
│                                                                  │
│  4. Trend Detection      Compare keyword snapshots over time     │
│                          to find rising, stable, and declining   │
│                          rankings                                │
│                                                                  │
│  5. Claude Ideation      Cross-reference all signals to          │
│                          recommend new content + refreshes       │
│                                                                  │
│  6. Asset Creation       Create draft assets from approved       │
│     + Generation         ideas, trigger prompt sequence          │
│                          execution via existing engine           │
│                                                                  │
│  7. Strategist Review    Drafts land for human review,           │
│                          editing, and publishing                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### `content_keywords`

Tracked keywords per contract. Each keyword optionally links to the content asset that targets it.

| Column | Type | Description |
|--------|------|-------------|
| keyword_id | uuid | Primary key |
| contract_id | uuid | FK → contracts |
| keyword | text | The keyword/phrase being tracked |
| asset_id | uuid (nullable) | FK → content_assets (the post targeting this keyword) |
| difficulty | int | Keyword difficulty score (0-100) |
| search_volume | int | Latest monthly search volume |
| priority | text | `high`, `medium`, `low` |
| competitor_urls | jsonb | Array of competitor URLs ranking for this keyword |
| source | text | Where this keyword came from: `dataforseo`, `manual`, `suggestion` |
| status | text | `tracking`, `targeted`, `ignored` |
| created_at | timestamptz | When tracking started |
| updated_at | timestamptz | Last updated |

### `content_keyword_snapshots`

Historical ranking data. A new row is created each time the cron runs (weekly or monthly), enabling trend analysis.

| Column | Type | Description |
|--------|------|-------------|
| snapshot_id | uuid | Primary key |
| keyword_id | uuid | FK → content_keywords |
| rank | int (nullable) | SERP position (null = not ranking) |
| search_volume | int | Monthly searches at time of capture |
| captured_at | timestamptz | Snapshot timestamp |

### `content_intelligence_runs`

Log of each automated ideation/generation run for auditability.

| Column | Type | Description |
|--------|------|-------------|
| run_id | uuid | Primary key |
| contract_id | uuid | FK → contracts |
| run_type | text | `ideation`, `generation`, `full_pipeline` |
| keywords_tracked | int | Number of keywords checked |
| ideas_generated | int | Number of new content ideas produced |
| refreshes_flagged | int | Number of existing assets flagged for refresh |
| assets_created | int | Number of draft assets created |
| status | text | `completed`, `partial`, `failed` |
| summary | text | Claude's summary of recommendations |
| created_at | timestamptz | When the run started |

---

## Three Intelligence Signals

### Signal 1: SEO Keyword Data (via DataForSEO / Master Marketer)

Master Marketer already has a working DataForSEO integration. MiD App calls MM's endpoints to get keyword data rather than integrating with DataForSEO directly.

**Endpoints needed from Master Marketer:**

**Keyword Rankings** — current SERP positions for tracked keywords
```
POST /api/seo/rankings
{
  "domain": "clientwebsite.com",
  "keywords": ["loyalty program automation", "B2B retention strategies"],
  "location": "United States"
}
Response: {
  "results": [
    { "keyword": "loyalty program automation", "rank": 15, "search_volume": 1200, "difficulty": 35 },
    { "keyword": "B2B retention strategies", "rank": null, "search_volume": 800, "difficulty": 42 }
  ]
}
```

**Competitor Gap Analysis** — keywords competitors rank for that the client doesn't
```
POST /api/seo/gaps
{
  "domain": "clientwebsite.com",
  "competitors": ["competitor1.com", "competitor2.com"],
  "limit": 50
}
Response: {
  "gaps": [
    { "keyword": "customer retention software", "search_volume": 2400, "difficulty": 48, "competitor_ranks": {"competitor1.com": 3} },
    ...
  ]
}
```

**Keyword Suggestions** — related keyword ideas based on seeds
```
POST /api/seo/suggestions
{
  "seed_keywords": ["loyalty program", "customer retention"],
  "limit": 30
}
Response: {
  "suggestions": [
    { "keyword": "loyalty program best practices", "search_volume": 900, "difficulty": 30 },
    ...
  ]
}
```

### Signal 2: Competitor Content Analysis

Beyond keyword gaps, identify what topics competitors are publishing content about. This could come from:

- DataForSEO's competitor content data
- Manual competitor URL lists per contract
- Periodic crawls of competitor blogs (future)

Stored as context for the ideation prompt — "Competitor A recently published about X, Y, Z."

### Signal 3: Existing Content Library (RAG)

Already built. `searchKnowledge()` searches the contract's embedded content library to understand:

- What topics are already covered
- Which posts are comprehensive vs thin
- Where there are content gaps relative to keyword targets

---

## Trend Detection & Decision Logic

Each keyword gets classified based on snapshot history:

```
Keyword: "loyalty program automation"
  Asset: "5 Ways to Automate Your Loyalty Program"

  Dec: #18 → Jan: #12 → Feb: #15
                              ↑
                        DECLINING — flag for refresh


Keyword: "B2B retention strategies"
  Asset: (none)

  Dec: — → Jan: — → Feb: —
                        ↑
                  UNRANKED — new content opportunity


Keyword: "customer loyalty metrics"
  Asset: "How to Measure Loyalty Program ROI"

  Dec: #32 → Jan: #19 → Feb: #11
                              ↑
                        CLIMBING — create supporting cluster content


Keyword: "loyalty program ROI"
  Asset: "The ROI of Customer Loyalty Programs"

  Dec: #5 → Jan: #4 → Feb: #5
                           ↑
                     STABLE — no action needed
```

**Decision rules:**

| Trend | Action | Priority |
|-------|--------|----------|
| Unranked + high volume keyword, no asset | Create new content targeting this keyword | High |
| Declining rank (dropped 3+ positions over 2 snapshots) | Refresh the associated asset | High |
| Climbing rank | Create supporting/cluster content that links to the main piece | Medium |
| Stable top 10 | No action | Low |
| Competitor ranks, we don't | New content opportunity | Medium-High |

---

## Automated Pipeline

### Cron Endpoint

```
POST /api/cron/content-intelligence
Headers: { "x-cron-secret": "..." }
Body (optional): { "contract_ids": ["uuid1", "uuid2"], "dry_run": false }
```

If no `contract_ids` provided, runs for all active contracts.

### Pipeline Steps

**Step 1: Snapshot Collection**
- For each contract, call Master Marketer's ranking endpoint with the contract's tracked keywords
- Store results in `content_keyword_snapshots`
- Update `search_volume` and `difficulty` on `content_keywords`

**Step 2: Gap Discovery**
- Call MM's gap analysis endpoint with client domain + competitor domains
- Surface new keyword opportunities not yet in `content_keywords`
- Auto-add high-potential gaps as new tracked keywords with `status: 'suggestion'`

**Step 3: Trend Analysis**
- Compare last 2-3 snapshots for each keyword
- Classify as: climbing, stable, declining, unranked, new
- Build a structured summary for Claude

**Step 4: Content Library Cross-Reference**
- RAG search for each high-priority keyword
- Determine: do we have content for this? Is it comprehensive or thin?
- Link `asset_id` on keywords where a matching asset exists

**Step 5: Claude Ideation**
- Feed Claude all signals: keyword trends, gaps, competitor data, existing content summary
- Ask for structured recommendations:

```json
{
  "new_content": [
    {
      "title": "Complete Guide to Loyalty Program Automation in 2026",
      "target_keyword": "loyalty program automation",
      "content_type": "blog_post",
      "rationale": "High volume (1,200/mo), moderate difficulty (35), no existing content",
      "outline": "..."
    }
  ],
  "refresh_content": [
    {
      "asset_id": "uuid",
      "current_title": "5 Ways to Automate Your Loyalty Program",
      "target_keyword": "loyalty program automation",
      "rationale": "Ranking dropped #12 → #15. Post is thin (800 words). Competitors have 2,000+ word guides.",
      "refresh_instructions": "Expand to cover implementation steps, vendor comparison, ROI metrics..."
    }
  ],
  "cluster_content": [
    {
      "title": "How to Measure Loyalty Program Metrics That Matter",
      "parent_asset_id": "uuid",
      "target_keyword": "customer loyalty metrics",
      "rationale": "Parent post climbing (#32 → #11). Supporting content with internal links will accelerate ranking."
    }
  ]
}
```

**Step 6: Asset Creation + Generation (if not dry_run)**
- Create draft assets from `new_content` and `cluster_content` recommendations
- For `refresh_content`, update the existing asset's description with refresh instructions
- Trigger `executeGeneration()` on each, with keyword data injected as `additional_instructions`
- All assets land in `draft` status for human review

**Step 7: Logging**
- Record the run in `content_intelligence_runs`
- Include summary stats: keywords tracked, ideas generated, refreshes flagged

---

## API Endpoints (MiD App Backend)

### Keywords Management

```
GET    /api/compass/content/keywords?contract_id={id}
POST   /api/compass/content/keywords
PUT    /api/compass/content/keywords/:id
DELETE /api/compass/content/keywords/:id
```

### Keyword Snapshots

```
GET    /api/compass/content/keywords/:id/snapshots
         ?from=2026-01-01&to=2026-02-24
```

Returns historical ranking data for trend visualization on the frontend.

### Intelligence Runs

```
GET    /api/compass/content/intelligence/runs?contract_id={id}
POST   /api/compass/content/intelligence/run
         { "contract_id": "uuid", "dry_run": true }
```

`dry_run: true` returns recommendations without creating assets — useful for preview/approval workflow.

### Cron Trigger

```
POST   /api/cron/content-intelligence
         { "contract_ids": ["uuid"], "dry_run": false }
```

Protected by cron secret, same pattern as existing cron jobs.

---

## Frontend (Future)

### Keywords Dashboard (Content Ops)

A new tab or page under Content Ops showing:

- **Keyword list** with current rank, trend arrow (up/down/stable), search volume, difficulty
- **Sparkline charts** showing rank movement over time per keyword
- **Link to associated asset** (if one exists)
- **Actions**: Add keyword, remove keyword, set priority, link to asset
- **Gap opportunities** section showing suggested keywords from competitor analysis

### Intelligence Report

After each cron run, show the recommendations:

- New content ideas with rationale
- Refresh recommendations with before/after context
- Cluster content suggestions
- One-click "Approve & Generate" to create + generate drafts
- Or "Approve All" to batch-create everything as drafts

---

## Implementation Phases

### Phase 1: Keyword Tracking Foundation
- Create `content_keywords` and `content_keyword_snapshots` tables
- Build CRUD endpoints for keywords
- Manual keyword entry + CSV upload
- Basic snapshot history view

### Phase 2: Master Marketer SEO Integration
- Build/expose ranking and gap endpoints in MM using DataForSEO
- MiD App cron job calls MM weekly to collect snapshots
- Trend detection logic (climbing, declining, stable, unranked)

### Phase 3: Automated Ideation
- Claude ideation prompt that reads keyword trends + RAG content library
- Structured recommendations output (new, refresh, cluster)
- `dry_run` mode for preview before creating assets
- Intelligence run logging

### Phase 4: Full Auto-Generation Pipeline
- Auto-create draft assets from approved recommendations
- Trigger `executeGeneration()` with keyword context injected
- Refresh flow: regenerate existing assets with keyword-aware instructions
- Strategist review queue for auto-generated drafts

### Phase 5: Frontend Dashboard
- Keywords tracking UI with trend visualization
- Intelligence report / recommendation review
- One-click approve + generate workflow
- Historical run log

---

## Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| Content generation engine | Built | `executeGeneration()` with SSE streaming |
| RAG search | Built | `searchKnowledge()` with pgvector |
| Brand voice | Built | Per-contract voice profiles |
| Prompt sequences | Built | Multi-step generation pipelines |
| Internal linking (published URLs) | Built | `{{published_urls}}` variable |
| DataForSEO integration | Built (in MM) | Needs API endpoints exposed for MiD App |
| Keyword tables | Not built | Migration needed |
| Ideation prompt | Not built | Claude prompt engineering |
| Cron job | Not built | Same pattern as existing crons |
| Frontend dashboard | Not built | Lovable build |

---

## Example: Full Pipeline Run

```
Contract: "Loyalty Solutions Inc." (weekly cron fires)

1. SNAPSHOT: 45 keywords checked
   - 3 declining, 8 unranked, 2 climbing, 32 stable

2. GAP ANALYSIS: 12 competitor keywords discovered
   - 4 high-volume opportunities added as suggestions

3. RAG SCAN: 542 assets in library
   - 38 blog posts, 12 with associated keywords
   - 3 posts identified as thin (< 500 words)

4. IDEATION (Claude):
   "Based on keyword trends and content gaps, I recommend:

    NEW CONTENT (3):
    1. 'Complete Guide to Loyalty Program Automation' — targets
       'loyalty program automation' (1,200 vol, difficulty 35,
       competitors rank #3 but client has no content)
    2. 'B2B Customer Retention Strategies for 2026' — targets
       'B2B retention strategies' (800 vol, competitor gap)
    3. 'Loyalty Program Analytics: Metrics That Drive Growth' —
       cluster content supporting climbing keyword

    REFRESH (2):
    1. '5 Ways to Automate Your Loyalty Program' — dropped #12→#15,
       thin at 800 words, expand with implementation guide
    2. 'Why Customer Loyalty Matters' — generic, refresh with
       data-driven angle targeting 'customer loyalty ROI'

    NO ACTION (40 keywords stable or low priority)"

5. GENERATION: 5 draft assets created/refreshed
   - Each generated via Standard Blog Post sequence (draft → review)
   - Keyword target + rationale injected as additional_instructions
   - Published URLs included for internal linking

6. STRATEGIST reviews 5 drafts next morning, edits, publishes
```
