# Master Marketer API — Integration Reference for MiD App

You are integrated with the Master Marketer API, a backend service that generates marketing deliverables. Your job is to collect the right data from the engagement context and user input, assemble the correct JSON payload, and POST it to the right endpoint.

## Connection Details

- **Base URL:** `https://master-marketer.onrender.com/api`
- **Auth:** All requests require an `x-api-key` header.
- **All routes are async.** Every POST returns `202 Accepted` with a `jobId`. Either poll `GET /api/jobs/:jobId` for completion or include a `callback_url` in the payload for push delivery.

### Callback (all routes)

Every payload can include these optional top-level fields (stripped before validation):

| Field | Type | Purpose |
|-------|------|---------|
| `callback_url` | string | Webhook URL — results POSTed here when task completes |
| `metadata` | object | Arbitrary metadata passed through to the callback payload |

### Response (all routes)

```json
{
  "jobId": "uuid",
  "triggerRunId": "string",
  "status": "accepted",
  "message": "..."
}
```

---

## Endpoints

There are three categories: **Generators** (build deliverables from scratch), **Reformatters** (restructure an existing document), and **Other**.

### Generators — `POST /api/generate/*`

These take structured data and produce a new deliverable.

| Deliverable | Endpoint | What it produces |
|-------------|----------|-----------------|
| Research | `POST /api/generate/research` | Competitive research report (markdown) |
| Roadmap | `POST /api/generate/roadmap` | Quarterly marketing roadmap (structured JSON) |
| SEO Audit | `POST /api/generate/seo-audit` | SEO/AEO audit (structured JSON) |
| Content Plan | `POST /api/generate/content-plan` | Content plan (markdown) |
| ABM Plan | `POST /api/generate/abm-plan` | Account-Based Marketing plan (markdown) |

### Reformatters — `POST /api/intake/*`

These take raw text or a file URL of an existing document and restructure it.

| Deliverable | Endpoint |
|-------------|----------|
| Roadmap | `POST /api/intake/roadmap` |
| Marketing Plan | `POST /api/intake/plan` |
| Creative Brief | `POST /api/intake/brief` |

### Other

| Operation | Endpoint |
|-----------|----------|
| Meeting Notes | `POST /api/intake/meeting-notes` |
| Job Status | `GET /api/jobs/:jobId` |
| Health Check | `GET /api/health` |

---

## Payload Schemas

### 1. Generate Research

`POST /api/generate/research`

Produces a competitive research report. This is typically the first deliverable generated for a new engagement.

```json
{
  "client": {
    "company_name": "string (required)",
    "domain": "string (required)",
    "linkedin_handle": "string (optional)",
    "youtube_channel_id": "string (optional)"
  },
  "competitors": [
    {
      "company_name": "string (required)",
      "domain": "string (required)",
      "linkedin_handle": "string (optional)",
      "youtube_channel_id": "string (optional)"
    }
  ],
  "context": {
    "industry_description": "string (optional)",
    "solution_category": "string (optional)",
    "target_verticals": ["string array (optional)"]
  },
  "knowledge_base": {
    "primary_meetings": ["string array (optional) — transcripts from primary discovery meetings"],
    "other_meetings": ["string array (optional) — transcripts from other meetings"],
    "notes": ["string array (optional) — written notes, briefs, etc."],
    "processes": ["string array (optional) — process descriptions"]
  },
  "instructions": "string (optional)",
  "title": "string (optional)"
}
```

- `competitors`: 1–4 entries.
- `knowledge_base` replaces the legacy `rag_context` field. Use `knowledge_base` for all new calls.

**Output:** `full_document_markdown` + `sections[]` — narrative markdown.

---

### 2. Generate Roadmap

`POST /api/generate/roadmap`

Produces a quarterly marketing roadmap. Requires research output and transcripts as upstream inputs.

```json
{
  "client": {
    "company_name": "string (required)",
    "domain": "string (required)"
  },
  "research": {
    "full_document_markdown": "string (required)",
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
  "transcripts": ["string array (required)"],
  "process_library": [
    {
      "task": "string (required)",
      "description": "string (required)",
      "stage": "Foundation | Execution | Analysis (required)",
      "points": "number, positive (required)"
    }
  ],
  "points_budget": "number, positive (required) — this is a per-month number",
  "instructions": "string (optional)",
  "title": "string (optional)",
  "previous_roadmap": "object (optional) — previous quarter's roadmap output for iteration"
}
```

- `research` — pass the full research output from Generate Research.
- `process_library` — at least 1 entry.
- `points_budget` — per-month budget. The API allocates this amount to each month; quarterly total = `points_budget * 3`.

**Output:** Structured JSON with typed sections (target_market, brand_story, etc.).

---

### 3. Generate SEO Audit

`POST /api/generate/seo-audit`

Produces an SEO/AEO audit with crawl data, keyword landscape, and competitive analysis.

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
  "seed_topics": ["string array (optional) — seed topics for keyword research"],
  "research_context": {
    "full_document_markdown": "string (optional) — research report for additional context",
    "competitive_scores": { "<Company>": { "organic_seo": 0, "...": "..." } }
  },
  "max_crawl_pages": "number (optional, default 150, min 1, max 2000)",
  "instructions": "string (optional)",
  "title": "string (optional)"
}
```

- `competitors`: 1–4 entries.
- `research_context` — optionally pass the research output for richer analysis.

**Output:** Structured JSON with typed sections (technical_seo, keyword_landscape, etc.).

---

### 4. Generate Content Plan

`POST /api/generate/content-plan`

Produces a content plan. Requires roadmap, SEO audit, and research as upstream inputs.

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
  "roadmap": "object (required) — full roadmap output, passthrough",
  "seo_audit": "object (required) — full SEO audit output, passthrough",
  "research": {
    "full_document_markdown": "string (required)",
    "competitive_scores": { "<Company>": { "organic_seo": 0, "...": "..." } }
  },
  "transcripts": ["string array (required)"],
  "process_library": [
    {
      "task": "string (required)",
      "description": "string (required)",
      "stage": "Foundation | Execution | Analysis (required)",
      "points": "number, positive (required)"
    }
  ],
  "instructions": "string (optional)",
  "title": "string (optional)",
  "previous_content_plan": "object (optional) — previous content plan output for iteration"
}
```

- `roadmap` and `seo_audit` — pass the full output objects from their respective generators.
- `competitors`: 1–4 entries.
- `process_library` is optional here (unlike roadmap where it's required).

**Output:** `full_document_markdown` + `sections[]` — narrative markdown.

---

### 5. Generate ABM Plan

`POST /api/generate/abm-plan`

Produces an Account-Based Marketing plan. Requires roadmap and research as upstream inputs. Additionally requires user-configured target segments, offers, channels, and tech stack.

```json
{
  "client": {
    "company_name": "string (required)",
    "domain": "string (required)"
  },
  "roadmap": "object (required) — full roadmap output, passthrough",
  "research": {
    "full_document_markdown": "string (required)",
    "competitive_scores": { "<Company>": { "organic_seo": 0, "...": "..." } }
  },
  "transcripts": ["string array (required)"],
  "target_segments": [
    {
      "segment_name": "string (required)",
      "description": "string (required)",
      "estimated_account_count": "number, positive (required)",
      "tier": "tier_1 | tier_2 | tier_3 (required)"
    }
  ],
  "offers": [
    {
      "offer_name": "string (required)",
      "offer_type": "assessment | audit | demo | trial | consultation | report | case_study | webinar | toolkit | calculator | custom (required)",
      "funnel_stage": "top | middle | bottom (required)",
      "description": "string (optional)"
    }
  ],
  "channels": {
    "email": {
      "enabled": true,
      "platform": "smartlead | outreach | salesloft | apollo | instantly | other",
      "platform_other": "string (if platform is 'other')",
      "sending_domains": ["string array, min 1"],
      "daily_send_volume": "number, positive",
      "warmup_needed": "boolean",
      "sequences_count": "number, positive (optional)"
    },
    "linkedin_ads": {
      "enabled": true,
      "monthly_budget": "number, positive",
      "formats": ["sponsored_content | message_ads | conversation_ads | text_ads | document_ads | video_ads | lead_gen_forms"]
    },
    "display_ads": {
      "enabled": true,
      "platform": "google_display | metadata_io | rollworks | terminus | demandbase | other",
      "platform_other": "string (if platform is 'other')",
      "monthly_budget": "number, positive",
      "retargeting": "boolean"
    },
    "direct_mail": {
      "enabled": true,
      "provider": "sendoso | postal | reachdesk | alyce | manual | other",
      "provider_other": "string (if provider is 'other')",
      "budget_per_send": "number, positive"
    },
    "events": {
      "enabled": true,
      "types": ["webinars | trade_shows | field_events | executive_dinners | virtual_roundtables | workshops"],
      "annual_event_count": "number, positive"
    },
    "website_intelligence": {
      "enabled": true,
      "platform": "factors_ai | rb2b | clearbit_reveal | leadfeeder | other",
      "platform_other": "string (if platform is 'other')"
    }
  },
  "tech_stack": {
    "crm": "hubspot | salesforce | pipedrive | other (required)",
    "crm_other": "string (if crm is 'other')",
    "marketing_automation": "hubspot | marketo | pardot | activecampaign | none | other (optional)",
    "marketing_automation_other": "string (if 'other')",
    "data_enrichment": "clay | apollo | zoominfo | lusha | clearbit | other (required)",
    "data_enrichment_other": "string (if 'other')",
    "intent_data": "factors_ai | bombora | 6sense | demandbase | g2 | none | other (optional)",
    "intent_data_other": "string (if 'other')",
    "workflow_automation": "n8n | zapier | make | tray_io | none | other (optional)",
    "workflow_automation_other": "string (if 'other')"
  },
  "monthly_ad_budget": "number, positive (optional)",
  "sales_follow_up_sla_hours": "number, positive (optional, default 24)",
  "launch_timeline": "30_days | 60_days | 90_days (optional, default 60_days)",
  "instructions": "string (optional)",
  "title": "string (optional)"
}
```

**Validation rules:**
- `target_segments`: 1–6 entries.
- `offers`: 1–8 entries.
- `channels`: At least one of `email` or `linkedin_ads` must be present. Only include channel objects that are enabled.
- Only include `_other` fields when the corresponding enum value is `"other"`.
- Omit optional top-level fields (`monthly_ad_budget`, `sales_follow_up_sla_hours`, `launch_timeline`) if not provided.

**Output:** `full_document_markdown` + `sections[]` — narrative markdown.

---

### 6. Reformat Existing Document

`POST /api/intake/roadmap` | `POST /api/intake/plan` | `POST /api/intake/brief`

Takes raw text or a file URL of an existing document and restructures it into a standard format.

```json
{
  "content": "string (optional) — full text of the existing document",
  "file_url": "string (optional) — URL to a PDF, DOCX, DOC, TXT, or MD file",
  "context": {
    "contract_name": "string (required)",
    "industry": "string (required)",
    "additional_notes": "string (optional)"
  }
}
```

- At least one of `content` or `file_url` is required. If both are provided, `content` takes precedence.

---

### 7. Meeting Notes

`POST /api/intake/meeting-notes`

Analyzes a meeting transcript.

```json
{
  "transcript": "string or array of { speaker, text } objects (required)",
  "meeting_title": "string (optional)",
  "meeting_date": "string, ISO date (optional)",
  "participants": ["string array (optional)"],
  "guidance": "string (optional)"
}
```

**Output:** summary, action_items, decisions, key_topics, sentiment analysis.

---

## Deliverable Pipeline (dependency order)

The generators have a dependency chain. Each deliverable builds on the outputs of previous ones:

1. **Research** — no upstream dependencies. Start here.
2. **Roadmap** — requires: research output, transcripts, process library.
3. **SEO Audit** — requires: client + competitors. Optionally enhanced by research output.
4. **Content Plan** — requires: roadmap output, SEO audit output, research output, transcripts.
5. **ABM Plan** — requires: roadmap output, research output, transcripts + user-configured segments/offers/channels/tech stack.

When triggering a downstream deliverable, pass the full output object from the upstream deliverable as-is (e.g. the entire roadmap output goes into the content plan's `roadmap` field).
