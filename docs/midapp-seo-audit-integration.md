# Mid App — SEO Audit Integration Spec

## Overview

The Mid App sits between the **Lovable frontend** and the **Master Marketer backend** (Trigger.dev). For the SEO Audit feature, the Mid App needs to:

1. **Receive** a form submission from Lovable
2. **Trigger** the `generate-seo-audit` task on Trigger.dev
3. **Track** the run status and relay progress back to Lovable
4. **Receive** the completed audit result via webhook callback
5. **Store** the result and make it available to Lovable for rendering

---

## Architecture

```
Lovable (Frontend)
    │
    ├─── POST /api/seo-audit ──────────► Mid App
    │                                      │
    │                                      ├─── tasks.trigger("generate-seo-audit", payload)
    │                                      │         ──────────► Trigger.dev
    │                                      │                        │
    │    (poll GET /api/seo-audit/:id)     │                        │ (20-30 min)
    │◄──────────────────────────────────── │                        │
    │                                      │                        │
    │                                      │◄─── POST callback ────┘
    │                                      │     (webhook with full output)
    │                                      │
    │    GET /api/seo-audit/:id            │
    │◄──── { status: "completed", data } ──┘
    │
    └─── Renders audit viewer with data
```

---

## API Endpoints the Mid App Needs

### 1. `POST /api/seo-audit` — Trigger an audit

Lovable calls this when the user submits the input form.

**Request body from Lovable:**

```json
{
  "client": {
    "company_name": "Motion Agency",
    "domain": "motionagency.io"
  },
  "competitors": [
    { "company_name": "Rise25", "domain": "rise25.com" },
    { "company_name": "Content Allies", "domain": "contentallies.com" },
    { "company_name": "Sweet Fish Media", "domain": "sweetfishmedia.com" }
  ],
  "seed_topics": ["podcast marketing", "B2B content strategy"],
  "max_crawl_pages": 150,
  "instructions": "Focus on comparing podcast services",
  "title": "SEO/AEO Audit: Motion Agency"
}
```

All fields except `client` and `competitors` are optional. `competitors` must have 1-4 entries.

**What the Mid App does:**

1. Validate the input
2. Create a job record in the database with status `"pending"`
3. Trigger the Trigger.dev task, passing:
   - All the input fields from Lovable
   - A `_callback` object so Trigger.dev can POST results back
   - A `_jobId` so the callback payload identifies which job it belongs to

The payload sent to Trigger.dev looks like:

```json
{
  "client": { "company_name": "Motion Agency", "domain": "motionagency.io" },
  "competitors": [
    { "company_name": "Rise25", "domain": "rise25.com" },
    { "company_name": "Content Allies", "domain": "contentallies.com" },
    { "company_name": "Sweet Fish Media", "domain": "sweetfishmedia.com" }
  ],
  "seed_topics": ["podcast marketing", "B2B content strategy"],
  "max_crawl_pages": 150,
  "instructions": "Focus on comparing podcast services",
  "title": "SEO/AEO Audit: Motion Agency",

  "_jobId": "job_abc123",
  "_callback": {
    "url": "https://your-midapp.com/api/webhooks/trigger-callback",
    "api_key": "your-webhook-secret",
    "metadata": {
      "deliverable_id": "del_xyz",
      "contract_id": "con_456",
      "title": "SEO/AEO Audit: Motion Agency"
    }
  }
}
```

The `_callback` and `_jobId` fields are stripped from the input before validation — they are internal routing fields only.

**How to trigger via Trigger.dev SDK:**

```typescript
import { tasks } from "@trigger.dev/sdk/v3";

const handle = await tasks.trigger("generate-seo-audit", {
  ...inputFromLovable,
  _jobId: job.id,
  _callback: {
    url: `${process.env.MID_APP_BASE_URL}/api/webhooks/trigger-callback`,
    api_key: process.env.WEBHOOK_SECRET,
    metadata: {
      deliverable_id: deliverable.id,
      contract_id: contract.id,
      title: inputFromLovable.title || `SEO/AEO Audit: ${inputFromLovable.client.company_name}`,
    },
  },
});

// Save handle.id as the trigger_run_id for status polling
```

**Response to Lovable:**

```json
{
  "id": "job_abc123",
  "status": "pending",
  "created_at": "2026-02-14T05:00:00.000Z"
}
```

---

### 2. `GET /api/seo-audit/:id` — Check status / get result

Lovable polls this endpoint while the audit is running. Once complete, this returns the full audit output.

**Response while running:**

```json
{
  "id": "job_abc123",
  "status": "running",
  "progress": "Analyzing keyword landscape and content gaps...",
  "created_at": "2026-02-14T05:00:00.000Z",
  "elapsed_seconds": 845
}
```

**Response when complete:**

```json
{
  "id": "job_abc123",
  "status": "completed",
  "created_at": "2026-02-14T05:00:00.000Z",
  "completed_at": "2026-02-14T05:28:00.000Z",
  "data": {
    // ... full GeneratedSeoAuditOutput JSON (see Output Schema below)
  }
}
```

**Response on failure:**

```json
{
  "id": "job_abc123",
  "status": "failed",
  "error": "ANTHROPIC_API_KEY not configured",
  "created_at": "2026-02-14T05:00:00.000Z"
}
```

**Polling strategy for Lovable:** Poll every 10 seconds. Show the `progress` string to the user in the UI. Show `elapsed_seconds` as a timer.

---

### 3. `POST /api/webhooks/trigger-callback` — Receive results from Trigger.dev

This is the webhook endpoint that Trigger.dev calls when the audit completes. The Mid App does NOT call this — it receives it.

**Request from Trigger.dev:**

```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "deliverable_id": "del_xyz",
  "contract_id": "con_456",
  "title": "SEO/AEO Audit: Motion Agency",
  "output": {
    "content_raw": "",
    "content_structured": {
      // ... full GeneratedSeoAuditOutput (see Output Schema below)
    }
  }
}
```

The `content_structured` field contains the complete audit JSON. The `content_raw` field will be empty for SEO audits (it's used for markdown-format deliverables like research reports).

**Headers:** The request includes `x-api-key` header with the secret configured in `_callback.api_key`. Validate this before processing.

**What the Mid App does:**
1. Validate the `x-api-key` header
2. Look up the job by `job_id`
3. Store `output.content_structured` as the job result
4. Update job status to `"completed"`
5. Return 200 OK

**On failure**, Trigger.dev sends:

```json
{
  "job_id": "job_abc123",
  "status": "failed",
  "error": "Error message here"
}
```

---

### 4. `GET /api/seo-audit` — List audits (optional)

Returns a list of all SEO audits for the current user/organization, for a dashboard view.

```json
{
  "audits": [
    {
      "id": "job_abc123",
      "title": "SEO/AEO Audit: Motion Agency",
      "domain": "motionagency.io",
      "status": "completed",
      "created_at": "2026-02-14T05:00:00.000Z",
      "completed_at": "2026-02-14T05:28:00.000Z"
    }
  ]
}
```

---

## Progress Tracking

The Trigger.dev task sets metadata as it progresses through phases. If you want real-time progress (instead of just polling for completion), you have two options:

**Option A: Poll Trigger.dev directly** — Use `runs.retrieve(runId)` from the Trigger.dev SDK to get the run's metadata, which includes a `progress` field. This avoids needing your own progress tracking.

**Option B: Progress via the status endpoint** — The Mid App tracks progress in its own database. The Trigger.dev task updates progress via metadata (which you can read via SDK), or you could add intermediate callback POSTs for progress updates.

The progress phases are, in order:
1. `"Gathering SEO intelligence (crawl, keywords, backlinks, SERP, AEO)..."` — longest phase, ~15-20 min
2. `"Analyzing technical SEO..."`
3. `"Analyzing keyword landscape and content gaps..."`
4. `"Analyzing SERP features and AI engine visibility..."`
5. `"Analyzing backlink profile and authority..."`
6. `"Building competitive search landscape..."`
7. `"Generating strategic recommendations..."`
8. `"Delivering results via callback..."`
9. `"Complete"`

---

## Complete Output Schema

This is the full TypeScript type for the audit output. This is what arrives in the callback's `output.content_structured` field and what gets stored and served to Lovable via `GET /api/seo-audit/:id`.

Lovable already has this schema and knows how to render every field — the Mid App just needs to store it and pass it through.

```typescript
interface GeneratedSeoAuditOutput {
  type: "seo_audit";
  title: string;
  summary: string;

  technical_seo: {
    section_description: string;
    health_score: number;                    // 0-100
    pages_crawled: number;
    critical_issues: Array<{
      issue: string;
      severity: "critical" | "high" | "medium" | "low";
      affected_pages: number;
      description: string;
      recommendation: string;
    }>;
    schema_inventory: Array<{
      schema_type: string;
      pages_count: number;
      status: "implemented" | "missing" | "incomplete";
      recommendation?: string;
    }>;
    core_web_vitals: Array<{
      url: string;
      lcp: number | null;
      fid: number | null;
      cls: number | null;
      inp: number | null;
      performance_score: number | null;
      rating: "good" | "needs_improvement" | "poor";
    }>;
    crawlability_summary: string;
    indexability_summary: string;
    mobile_readiness_summary: string;
    technical_verdict: {
      recommendation: "proceed_to_content" | "technical_audit_first" | "parallel_workstreams";
      rationale: string;
      deep_audit_areas?: string[];
    };
  };

  keyword_landscape: {
    section_description: string;
    total_ranked_keywords: number;
    top_3_keywords: number;
    top_10_keywords: number;
    top_50_keywords: number;
    estimated_organic_traffic: number;
    keyword_clusters: Array<{
      cluster_name: string;
      intent: string;
      business_relevance: "core" | "adjacent" | "vanity";
      relevance_rationale: string;
      keywords: Array<{
        keyword: string;
        position: number;
        search_volume: number;
        difficulty?: number;
        url?: string;
      }>;
      total_traffic_potential: number;
      opportunity_score: number;
    }>;
    top_performers: Array<{
      keyword: string;
      position: number;
      search_volume: number;
      url: string;
      trend: "rising" | "stable" | "declining";
      business_relevance: "core" | "adjacent" | "vanity";
    }>;
    ranking_distribution_summary: string;
  };

  content_gap: {
    section_description: string;
    total_gap_keywords: number;
    high_value_gaps: ContentGapOpportunity[];
    quick_wins: ContentGapOpportunity[];
    strategic_gaps: ContentGapOpportunity[];
    gap_analysis_summary: string;
  };

  serp_features_aeo: {
    section_description: string;
    snippet_opportunities: Array<{
      keyword: string;
      search_volume: number;
      current_snippet_holder?: string;
      client_position?: number;
      snippet_type: string;
      optimization_recommendation: string;
    }>;
    paa_opportunities: Array<{
      question: string;
      parent_keyword: string;
      search_volume?: number;
      currently_answered_by?: string;
    }>;
    ai_overview_presence: Array<{
      keyword: string;
      ai_overview_present: boolean;
      client_referenced: boolean;
      competitors_referenced: string[];
      optimization_opportunity: string;
    }>;
    llm_visibility: Array<{
      engine: string;
      queries_tested: number;
      brand_mentioned_count: number;
      mention_rate: number;
      competitors_mentioned: Record<string, number>;
      key_findings: string[];
    }>;
    serp_features_summary: string;
    aeo_readiness_score: number;
    aeo_recommendations: string[];
  };

  backlink_profile: {
    section_description: string;
    total_backlinks: number;
    referring_domains: number;
    dofollow_ratio: number;
    domain_authority?: number;
    spam_score?: number;
    anchor_distribution: Array<{
      category: string;
      percentage: number;
      examples: string[];
    }>;
    competitor_comparison: Array<{
      company_name: string;
      domain: string;
      total_backlinks: number;
      referring_domains: number;
      domain_rank?: number;
      dofollow_ratio: number;
    }>;
    gap_opportunities: Array<{
      referring_domain: string;
      domain_rank?: number;
      links_to_competitors: string[];
      acquisition_difficulty: "easy" | "medium" | "hard";
      recommendation: string;
    }>;
    backlink_health_summary: string;
    link_building_priorities: string[];
  };

  competitive_search: {
    section_description: string;
    client_profile: SearchProfile;
    competitor_profiles: SearchProfile[];
    competitive_positioning_summary: string;
    differentiation_opportunities: string[];
  };

  strategic_recommendations: {
    section_description: string;
    quick_wins: StrategicRecommendation[];
    medium_term: StrategicRecommendation[];
    long_term: StrategicRecommendation[];
    executive_summary: string;
  };

  metadata: {
    model: string;
    version: number;
    generated_at: string;
    domain_audited: string;
    competitors_analyzed: string[];
    intelligence_errors: string[];
  };
}

// Shared sub-types used above:

interface ContentGapOpportunity {
  keyword: string;
  search_volume: number;
  difficulty?: number;
  intent: string;
  competitor_positions: Record<string, number>;
  estimated_traffic_value: number;
  priority: "high" | "medium" | "low";
  rationale: string;
}

interface SearchProfile {
  company_name: string;
  domain: string;
  total_ranked_keywords: number;
  top_10_keywords: number;
  estimated_traffic: number;
  domain_authority?: number;
  top_content_categories: string[];
  strengths: string[];
  weaknesses: string[];
}

interface StrategicRecommendation {
  title: string;
  description: string;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  timeframe: string;
  category: "technical" | "content" | "backlinks" | "aeo" | "competitive";
  kpi: string;
}
```

---

## Input Validation Rules

The Mid App should validate before triggering:

| Field | Rule |
|-------|------|
| `client.company_name` | Required, non-empty string |
| `client.domain` | Required, non-empty string |
| `competitors` | Array of 1-4 entries, each with `company_name` and `domain` |
| `seed_topics` | Optional array of strings |
| `max_crawl_pages` | Optional number, 1-2000, defaults to 150 |
| `instructions` | Optional string |
| `title` | Optional string, auto-generated as `"SEO/AEO Audit: {company_name}"` if omitted |
| `research_context` | Optional — only present when a prior research report exists for this client. Contains `full_document_markdown` (the research report text) and `competitive_scores` (a map of domain → score object). The Mid App should pass this through if available. |

---

## Database Schema (suggested)

```sql
CREATE TABLE seo_audits (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  trigger_run_id  TEXT,                             -- Trigger.dev run ID for status polling
  input           JSONB NOT NULL,                   -- the input payload from Lovable
  output          JSONB,                            -- the full GeneratedSeoAuditOutput
  error           TEXT,
  progress        TEXT,                             -- latest progress string
  client_domain   TEXT NOT NULL,
  client_name     TEXT NOT NULL,
  deliverable_id  TEXT,
  contract_id     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

---

## Summary of Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **Lovable** | Input form, polling for status, rendering the audit viewer |
| **Mid App** | Receives form data, triggers Trigger.dev, receives callback, stores results, serves results to Lovable |
| **Trigger.dev (Master Marketer)** | Crawls sites, gathers intelligence from 5+ APIs, runs 6 Claude analysis calls, assembles output, delivers via callback |

The Mid App is a **thin orchestration layer**. It does not process or transform the audit output — it stores it as-is from the callback and serves it as-is to Lovable. The heavy lifting (crawling, API calls, AI analysis) all happens in Trigger.dev. The rendering all happens in Lovable.
