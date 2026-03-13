# Master Marketer API Reference

## Base URL

Production: `https://master-marketer.onrender.com/api`

## Authentication

All requests require an `x-api-key` header.

## Callback (all routes)

All routes accept optional top-level fields that are stripped before validation:

| Field | Type | Description |
|-------|------|-------------|
| `callback_url` | `string` | Webhook URL — results POSTed here when task completes |
| `metadata` | `object` | Arbitrary metadata passed through to the callback |

---

## Route Map

### Generators (build from scratch using data + AI)

| Deliverable | Endpoint | Trigger Task | Input Schema |
|-------------|----------|-------------|--------------|
| Roadmap | `POST /api/generate/roadmap` | `generate-roadmap` | `RoadmapInputSchema` |
| Research | `POST /api/intake/research` | `generate-research` | `ResearchInputSchema` |
| SEO Audit | `POST /api/intake/seo_audit` | `generate-seo-audit` | `SeoAuditInputSchema` |
| Content Plan | `POST /api/intake/content_plan` | `generate-content-plan` | `ContentPlanInputSchema` |

> **Note:** Research, SEO Audit, and Content Plan generators live under `/api/intake/` for historical reasons. Duplicate routes also exist at `/api/generate/seo-audit` and `/api/generate/content-plan` (same behavior). Research has no `/api/generate/` equivalent.

### Reformatters (ingest existing document, restructure it)

| Deliverable | Endpoint | Trigger Task | Input Schema |
|-------------|----------|-------------|--------------|
| Roadmap | `POST /api/intake/roadmap` | `analyze-deliverable` | `DeliverableIntakeInputSchema` |
| Marketing Plan | `POST /api/intake/plan` | `analyze-deliverable` | `DeliverableIntakeInputSchema` |
| Creative Brief | `POST /api/intake/brief` | `analyze-deliverable` | `DeliverableIntakeInputSchema` |

### Other

| Operation | Endpoint | Trigger Task | Input Schema |
|-----------|----------|-------------|--------------|
| Meeting Notes | `POST /api/intake/meeting-notes` | `analyze-meeting-notes` | `MeetingNotesInputSchema` |
| Job Status | `GET /api/jobs/:jobId` | n/a | n/a |
| Health Check | `GET /api/health` | n/a | n/a |

---

## Payload Schemas

### Generate Roadmap

`POST /api/generate/roadmap`

Builds a new roadmap from research data, transcripts, and process library.

```json
{
  "client": {
    "company_name": "string (required)",
    "domain": "string (required)"
  },
  "research": {
    "full_document_markdown": "string (required) — the full research report markdown",
    "competitive_scores": {
      "<Company Name>": {
        "organic_seo": "number (1-10)",
        "social_media": "number (1-10)",
        "content_strategy": "number (1-10)",
        "paid_media": "number (1-10)",
        "brand_positioning": "number (1-10)",
        "overall": "number (1-10)"
      }
    }
  },
  "transcripts": ["string array of meeting transcripts (required)"],
  "process_library": [
    {
      "task": "string (required)",
      "description": "string (required)",
      "stage": "Foundation | Execution | Analysis (required)",
      "points": "number, positive (required)"
    }
  ],
  "points_budget": "number, positive (required)",
  "instructions": "string (optional)",
  "title": "string (optional)",
  "previous_roadmap": "object (optional) — previous quarter's roadmap output for iteration"
}
```

### Generate Research

`POST /api/intake/research`

Builds a new competitive research report from client/competitor data.

```json
{
  "client": {
    "company_name": "string (required)",
    "domain": "string (required)"
  },
  "competitors": [
    {
      "company_name": "string (required)",
      "domain": "string (required)"
    }
  ],
  "title": "string (optional)",
  "instructions": "string (optional)",
  "context": {
    "industry_description": "string (optional)",
    "solution_category": "string (optional)",
    "target_verticals": ["string array (optional)"]
  },
  "knowledge_base": {
    "primary_meetings": ["string array (optional)"],
    "other_meetings": ["string array (optional)"],
    "notes": ["string array (optional)"],
    "processes": ["string array (optional)"]
  },
  "rag_context": "string (optional) — legacy field, use knowledge_base instead"
}
```

### Generate SEO Audit

`POST /api/intake/seo_audit` (or `/api/generate/seo-audit`)

Builds a new SEO/AEO audit. See `src/types/seo-audit-input.ts` for full schema.

### Generate Content Plan

`POST /api/intake/content_plan` (or `/api/generate/content-plan`)

Builds a new content plan from roadmap + SEO audit + research. See `src/types/content-plan-input.ts` for full schema.

### Reformat Existing Document (Roadmap, Plan, Brief)

`POST /api/intake/roadmap` | `/api/intake/plan` | `/api/intake/brief`

Takes raw text of an existing document and restructures it.

```json
{
  "content": "string (required) — the full text content of the existing document",
  "context": {
    "contract_name": "string (required)",
    "industry": "string (required)",
    "additional_notes": "string (optional)"
  }
}
```

### Meeting Notes

`POST /api/intake/meeting-notes`

Analyzes meeting transcripts. See `src/types/meeting-notes.ts` for full schema.

---

## Response Format (all async routes)

All generator and reformatter routes return `202 Accepted`:

```json
{
  "jobId": "uuid",
  "triggerRunId": "string",
  "status": "accepted",
  "message": "..."
}
```

Poll `GET /api/jobs/:jobId` for completion, or use `callback_url` for push delivery.

---

## Output Formats

| Deliverable | Output Type | Format |
|-------------|------------|--------|
| Research | `full_document_markdown` + `sections[]` | Narrative markdown |
| Roadmap | Structured JSON | Typed sections (target_market, brand_story, etc.) |
| SEO Audit | Structured JSON | Typed sections (technical_seo, keyword_landscape, etc.) |
| Content Plan | `full_document_markdown` + `sections[]` | Narrative markdown |

Research and Content Plan output narrative markdown documents. Roadmap and SEO Audit output structured JSON that frontends render into visual layouts.
