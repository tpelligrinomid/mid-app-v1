# Master Marketer API — Architecture Summary

**For: MiD App v1 integration planning**
**Date: January 29, 2026**

---

## What Is Master Marketer?

Master Marketer is a stateless AI-powered generation and analysis service deployed on Render. It receives structured JSON input and returns structured JSON output. It does not manage users, contracts, or permissions — that's the MiD Platform's job.

It handles three categories of work:

1. **Intake** — Convert unstructured documents (PDFs, DOCX, markdown, meeting transcripts) into standardized JSON schemas
2. **Generate** — Produce new content from structured input (ad copy, creative briefs, plans, roadmaps)
3. **Export** — Format structured data into presentation-ready output (branded reports, PDFs, slide-ready markdown)

A future fourth category:

4. **Analyze** — Interpret performance data and produce recommendations (weekly performance analysis, channel effectiveness, competitive positioning)

---

## Two-Service Architecture

```
MiD App v1 (Platform Service)              Master Marketer API (Intelligence Service)
│                                           │
│  Owns:                                    │  Owns:
│  - Contracts, users, permissions          │  - AI generation (Claude / Trigger.dev)
│  - ClickUp / QB / HubSpot sync           │  - Prompt templates & reference libraries
│  - ABM platform data pulls               │  - Document intake & extraction
│  - Scheduled workflows (crons)            │  - Report/export formatting
│  - Supabase reads/writes                  │  - Structured JSON in, structured JSON out
│                                           │
│  Calls Master Marketer when:              │  Endpoints:
│  - User triggers generation in Compass    │  - POST /intake/*    (docs → JSON)
│  - Weekly analysis needs to run           │  - POST /generate/*  (JSON → content)
│  - Old docs need conversion               │  - POST /analyze/*   (data → insights)
│  - Reports need to be built               │  - POST /export/*    (JSON → formatted output)
│                                           │
│  Packages contract context from           │  Receives structured input only.
│  Supabase and sends it to the API.        │  Does NOT access Supabase directly.
│  Stores results back in Supabase.         │  Does NOT know about contracts or users.
```

### Communication Pattern

MiD App v1 is the **orchestrator**. Master Marketer is the **brain**.

1. MiD App v1 gathers context from Supabase (contract data, notes, deliverables, uploaded files)
2. MiD App v1 packages it as structured JSON
3. MiD App v1 calls the appropriate Master Marketer endpoint
4. Master Marketer processes (Claude API, Trigger.dev for long tasks) and returns structured JSON
5. MiD App v1 stores the result in Supabase
6. Lovable displays it in the appropriate Compass App

---

## Document Hierarchy

The MiD platform works with a four-tier document hierarchy. Master Marketer has intake and generation capabilities for each tier.

```
Research (foundational intelligence, done once, refreshed quarterly)
    │
    ▼
Roadmap (strategic direction, built from research, reviewed quarterly)
    │
    ▼
Plans (tactical execution, built from roadmaps, created per campaign/channel)
    │
    ▼
Creative Briefs / Execution (ad copy, content assets, landing pages — built from plans)

     ↑
Meeting Notes + Maintenance Notes (weekly, feed decisions back into any layer)
```

### Intake Endpoints (old docs → standardized JSON)

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /intake/research` | Research PDFs, competitive analysis docs | Structured research JSON |
| `POST /intake/roadmap` | Roadmap slides/PDFs | Structured roadmap JSON |
| `POST /intake/plan` | Plan documents (paid media, SEO, content, ABM) | Structured plan JSON |
| `POST /intake/meeting-notes` | Transcripts, raw notes | Structured decisions + action items |
| `POST /intake/campaign` | Strategy docs + meeting notes | Structured campaign input JSON |

### Generate Endpoints (structured JSON → new content)

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /generate/roadmap` | Research JSON | New roadmap |
| `POST /generate/plan` | Roadmap + research JSON | New plan (paid media, SEO, etc.) |
| `POST /generate/ads` | Plan/campaign JSON | Ad copy + visual direction + creative brief |
| `POST /generate/content` | Plan JSON | Content briefs |
| `POST /generate/creative-brief` | Plan JSON | Full creative brief (copy, visuals, specs) |

### Analyze Endpoints (data → insights)

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /analyze/weekly-performance` | Performance metrics + contract context | Analysis + recommendations |
| `POST /analyze/channel-effectiveness` | Channel data + campaign history | Channel scoring + reallocation suggestions |
| `POST /analyze/competitive` | Competitor data + positioning context | Competitive analysis report |

### Export Endpoints (structured JSON → formatted output)

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /export/creative-brief` | Generation output JSON | Branded markdown/PDF |
| `POST /export/client-report` | Analysis JSON + contract context | Client-facing report |
| `POST /export/slide-deck` | Any structured JSON | Presentation-formatted output |

---

## How This Maps to Compass Apps

Each Compass App in the MiD Platform uses Master Marketer for its AI-powered capabilities:

| Compass App | Master Marketer Endpoints Used |
|-------------|-------------------------------|
| **Paid Media** | `/intake/campaign`, `/generate/ads`, `/generate/creative-brief`, `/export/creative-brief` |
| **ABM Campaigns** | `/intake/plan`, `/generate/plan`, `/generate/ads`, `/analyze/channel-effectiveness` |
| **Content Hub** | `/intake/plan`, `/generate/content`, `/export/client-report` |
| **SEO Agent** | `/analyze/competitive`, `/generate/plan`, `/export/client-report` |
| **Reporting** | `/analyze/weekly-performance`, `/export/client-report`, `/export/slide-deck` |

---

## What's Built Today (January 29, 2026)

The Paid Media ad generation pipeline is working end-to-end:

### Working CLI Pipeline

```bash
# 1. Ingest source docs → structured campaign JSON
npx tsx src/intake.ts inputs/docs/ -o outputs/campaign.json

# 2. Generate ad copy (LinkedIn + display, multiple ad types)
npx tsx src/generate.ts outputs/campaign.json

# 3. Export to readable markdown creative brief
npx tsx src/export-markdown.ts outputs/campaign-output.json
```

### Key Components Built

| Component | Path | Purpose |
|-----------|------|---------|
| Campaign input schema | `src/types/campaign-input.ts` | Zod schema defining structured campaign input |
| Document intake | `src/intake.ts` | Reads PDFs/DOCX/MD, calls Claude, produces campaign JSON |
| Ad generation | `src/generate.ts` | Reads campaign JSON, generates ads per platform × ad type |
| Markdown export | `src/export-markdown.ts` | Converts JSON output to designer-ready creative brief |
| System prompt | `src/prompts/system.ts` | B2B copywriting expert identity |
| LinkedIn prompts | `src/prompts/linkedin.ts` | Platform-specific prompt builder with ad type instructions |
| Display prompts | `src/prompts/display.ts` | Banner ad prompt builder with size specifications |
| Prompt helpers | `src/prompts/helpers.ts` | Context assembly, example selection, visual style injection |
| Ad reference library | `data/ad-reference-library.json` | 28 curated B2B ad examples across 8 categories |
| Visual styles library | `data/visual-styles-library.json` | 12 proven ad visual formats for designer briefs |
| Express scaffolding | `src/index.ts`, `src/routes/`, `src/middleware/` | API skeleton (auth, validation, error handling, CORS) |

### Ad Output Structure

Each generated ad includes:
- **Post text** (LinkedIn) or **image copy** (display) — clearly separated
- **Image copy** — primary text, supporting text, CTA text (what goes ON the image)
- **Headline** — platform-specific field
- **Visual direction** — concept, style notes, reference description (from visual styles library)
- **Strategic rationale** — why this variation works for the target role
- **Character count validation** with warnings

### Generation Configuration

- **Model:** Claude Opus (`claude-opus-4-20250514`)
- **Platforms:** LinkedIn Sponsored Content, Display/Banner (AdRoll, GDN, programmatic)
- **Ad types:** Pain Point, Statement, Question, Comparison, Numbers, Testimonial, Social Proof, How-To
- **Visual styles:** 12 formats (Bold Typography, Data Callout, Quote Card, Before/After Stack, Icon Grid, Full-Bleed Question, Social Proof Bar, Editorial Photo, Checklist Card, Minimal Dark, Comparison Table, Annotated Screenshot)

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| AI | Anthropic Claude API (Opus for generation, Sonnet for intake) |
| Async workflows | Trigger.dev (for long-running generation tasks) |
| Validation | Zod schemas |
| File processing | pdf-parse (PDFs), mammoth (DOCX) |
| Deployment | Render |
| Environment | dotenv for local, Render env vars for production |

---

## What MiD App v1 Needs to Know

1. **Master Marketer is a separate Render service** with its own deploy. Communication is HTTP JSON.
2. **MiD App v1 is responsible for** gathering contract context from Supabase and packaging it into the schemas Master Marketer expects.
3. **Master Marketer does not access Supabase directly.** All data comes in the request payload and goes out in the response.
4. **Trigger.dev** is used for generation tasks that take 30+ seconds (ad copy generation across multiple platforms/types). MiD App v1 should expect async responses for generation endpoints — either polling or webhook callback.
5. **The reference libraries** (ad examples, visual styles) currently live as JSON files in the Master Marketer repo. These will eventually move to Supabase tables so the team can add examples through the Lovable UI. MiD App v1 should plan for a `/library/*` set of endpoints for CRUD on reference examples.
6. **Auth between services** is currently a simple API key (`x-api-key` header). Both services share a secret. No user-level auth needed since MiD App v1 handles that.
