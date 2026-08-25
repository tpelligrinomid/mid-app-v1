# Creative Ops + Brand Kit — Cross-Repo Plan

**Status:** Draft v1
**Owner:** TP / MiD platform
**Last updated:** 2026-04-25

This plan spans three repos. The work splits cleanly because each repo has a distinct responsibility:

| Repo | Role |
|---|---|
| **Lovable** (frontend) | UI, direct Supabase reads/writes via RLS, never talks to MM directly |
| **MiD App v1** (this repo, "the backend") | Schema, RLS, route handlers, deliverable processor, Lovable ↔ MM proxy, template-variable resolution |
| **Master Marketer** (MM) | LLM generation pipeline, prompt configs, vision/multimodal infra, deliverable type registry |

Lovable is shielded from MM. The seam between this repo and MM is the existing webhook + submit pattern (see how `roadmap`, `content_plan`, `abm_plan` work today).

---

## 1. Goals

1. Make **Brand Kit** a first-class, contract-level, client-visible deliverable that owns voice + visual identity in one structured record.
2. Move **Brand Voice** out of Content Ops config into Brand Kit (one-time migration).
3. Document the **template-variable catalog** so prompt authors (in Global Content) know what's available.
4. Build a **Creative Ops module** alongside Content Ops with brief creation, asset QA against brand kit + brief, and pitch guide generation.
5. Add **multimodal/vision support to MM** as the foundational infra that unlocks Brand Kit ingestion + Creative Ops QA + Pitch Guides.

---

## 2. Asset Scope

Asset types and their module involvement. The **Brief?** column indicates whether the asset requires an umbrella brief (only when multiple disciplines must coordinate around the same output):

| Asset | Content Ops | Creative Ops | Brief? |
|---|---|---|---|
| Blog post | Copy + final | — | No |
| Thought leadership | Copy + final | — | No |
| Newsletter | Copy + final | — | No |
| Case study | Copy + final | — | No |
| Slide decks | Copy | Layout + visuals | **Yes** |
| Ebooks | Body writing | Cover + layout + illustration | **Yes** |
| Landing pages | Copy | Visual design + layout | **Yes** |
| Website pages | Copy | Visual design + layout | **Yes** |
| Paid media ads | Ad copy | Creative | **Yes** |
| Videos | — | Visual production | **Yes** (script + storyboard) |
| Scripts | Writing | (input to video) | No (used as input) |
| Storyboards | — | Visual planning | No |
| Blog post images | — | Creative (blog post is the input) | No |
| Infographics | Data narrative | Design | **Yes** |
| One-pager data sheets | Copy | Design + layout | **Yes** |

**Important framing:** Creative Ops does **not** generate the final asset. Designers create the asset off-platform (Figma, Adobe, etc.). Creative Ops generates the **brief**, runs **QA on the uploaded asset**, and generates the **pitch guide**. The AI augments planning and review; humans do the design.

---

## 3. Architecture & Data Flow

```
┌─────────────────┐
│   Lovable UI    │
│  (Brand Kit,    │
│  Creative Ops,  │
│  Catalog Tab)   │
└────────┬────────┘
         │  Supabase JS client (RLS-gated)
         │  + REST calls to /api/* endpoints in this repo
         ▼
┌─────────────────────────────────────────────┐
│  MiD App v1 (this repo, Render)             │
│  - Schema migrations                        │
│  - RLS policies                             │
│  - Route handlers (POST /generate, etc.)    │
│  - Deliverable processor (branch per type)  │
│  - Template variable resolver               │
│  - VARIABLE_CATALOG + endpoint              │
└────────┬────────────────────────────────────┘
         │  HTTPS submit (with callback_url)
         ▼
┌─────────────────────────────────────────────┐
│  Master Marketer                            │
│  - Prompt configs per deliverable type      │
│  - LLM orchestration                        │
│  - Vision/multimodal pipeline (NEW)         │
│  - brand_kit / creative_brief / creative_qa │
│    / pitch_guide deliverable types (NEW)    │
└────────┬────────────────────────────────────┘
         │  Webhook callback when complete
         ▼
   (back to this repo — writes content_structured)
```

**Key invariants:**
- Lovable never calls MM directly.
- MM never calls Supabase directly — it always returns content via the webhook to this repo, which writes to the DB.
- All deliverable generation goes through the same `POST /api/compass/deliverables/:id/generate` pattern. New types just add new branches in the processor.

---

## 4. Phased Plan

The phases are dependency-ordered. Phases 1, 2, 3, 4 are pre-conditions; Phase 5 unblocks the rest.

### Phase 1 — Variable Catalog *(ships independently, ~3 days)*

**Goal:** document the template variables that prompt authors can reference.

**This repo:**
- New file: `backend/src/services/content-generation/variable-catalog.ts` exporting a `VARIABLE_CATALOG` constant: `Array<{ name, description, resolves_to, source, empty_state, recommended_use, example }>`.
- New endpoint: `GET /api/pulse/template-variables` → returns the catalog as JSON.
- Auth: any authenticated user with `admin` or `team_member` role.
- Document existing variables only (`{{company_name}}`, `{{industry}}`, `{{brand_voice}}`, `{{topic}}`, `{{audience}}`, `{{angle}}`, `{{key_argument}}`, `{{key_points}}`, `{{cta}}`, `{{platform}}`, `{{customer_name}}`, `{{challenge}}`, etc. — pulled from `context.ts:305-330`).

**Lovable:**
- New "Template Variables" tab in Global Content (third tab next to Global Prompts and Global Content Types).
- Read-only table fed by the new endpoint.
- Columns: Variable, Description, Resolves to, Source, Empty-state fallback, Recommended use, Example output (collapsible).
- Search/filter box.

**MM:** nothing.

**Acceptance:** strategist can see all available variables in the UI without asking engineering.

---

### Phase 2 — Brand Kit Foundation *(~2 weeks)*

**Goal:** Brand Kit exists as a deliverable-shaped, contract-level, client-visible record with all sections.

**This repo:**
- Migration: `compass_brand_kit` table. Fields:
  - `brand_kit_id uuid PK`
  - `contract_id uuid FK NOT NULL UNIQUE`
  - `version int NOT NULL DEFAULT 1`
  - `status text NOT NULL DEFAULT 'draft'` — `draft | approved | archived`
  - `client_visible boolean NOT NULL DEFAULT false`
  - `approved_at timestamptz`, `approved_by uuid`
  - **Voice section:** `voice_summary, tone[], personality[], writing_style, do_guidelines[], dont_guidelines[], example_excerpts jsonb, target_audience, industry_context` (mirrors current `compass_brand_voice`)
  - **Visual identity section:** `visual_description text, mood_keywords text[]`
  - **Color palette section:** `colors jsonb` — array of `{ role, name, hex, rgb, cmyk, usage_notes }`
  - **Typography section:** `typography jsonb` — `{ heading_font, body_font, accent_font, weight_rules, sizing_rules, license_notes }`
  - **Logo section:** `logos jsonb` — array of `{ variant, asset_url, clear_space, min_size, do_dont }`
  - **Photography section:** `photography_treatment jsonb` — `{ mood, subjects, composition, color_grading, do_examples[], dont_examples[] }`
  - **Iconography section:** `iconography jsonb` — `{ style, weight, library_ref, examples[] }`
  - **Patterns/textures section:** `patterns jsonb` — `{ examples[], usage_notes }`
  - **Social examples section:** `social_examples jsonb` — array per platform
  - **Video examples section:** `video_examples jsonb` — `{ opens, lower_thirds, end_cards, motion_principles, examples[] }`
  - `notes text`, `created_by`, `created_at`, `updated_at`
- Migration: `compass_brand_kit_versions` table for version history (snapshots). Optional in v1 — could store version snapshots in a `versions jsonb` column on the main row.
- RLS: read = `admin | team_member` always; client read = `client_visible = true` AND user has access to contract.
- Asset storage: new Supabase Storage bucket `brand-kit-assets/{contract_id}/...` with RLS policies mirroring brand kit access.
- No new endpoints needed for CRUD — Lovable hits Supabase directly via RLS, same as Net Churn / Tech Stack pattern.

**Lovable:**
- New "Brand Kit" module in the left sidebar under **Management** (auto-shown when Content Ops or Creative Ops is enabled on the contract; soft-prompt the strategist when first triggered).
- Pages:
  - **Overview** — section summary cards, version banner, approval state, client-visibility toggle.
  - **Voice** — form mirroring the current Brand Voice tab.
  - **Visual Identity** — mood, description, photography, iconography, patterns.
  - **Color Palette** — color picker + role assignment.
  - **Typography** — font selection + rules.
  - **Logos** — asset upload + variant management.
  - **Examples** — social/video reference uploads.
- Approve / archive workflow.
- Client-visibility toggle (mirrors how roadmaps surface to clients).

**MM:** nothing in this phase.

**Acceptance:**
- Brand Kit can be created and edited per contract.
- Sections persist correctly.
- Client with access can view an approved brand kit (read-only); cannot view drafts.
- Auto-prompt fires when Content Ops or Creative Ops is enabled on a fresh contract.

---

### Phase 3 — Brand Voice Migration *(~1 day, after Phase 2 is live)*

**Goal:** consolidate Brand Voice into Brand Kit; remove the duplicate.

**This repo:**
- One-time SQL: `INSERT INTO compass_brand_kit (contract_id, voice_summary, tone, personality, writing_style, do_guidelines, dont_guidelines, example_excerpts, target_audience, industry_context, created_by) SELECT contract_id, voice_summary, tone, personality, writing_style, do_guidelines, dont_guidelines, example_excerpts, target_audience, industry_context, created_by FROM compass_brand_voice ON CONFLICT (contract_id) DO UPDATE SET ...` (handle the case where a brand kit already exists).
- Resolver swap in `backend/src/services/content-generation/context.ts:285` — change source from `compass_brand_voice` to `compass_brand_kit`.
- `formatBrandVoice()` continues to operate on the same shape since voice fields are mirrored.
- Existing prompts using `{{brand_voice}}` continue working unchanged.
- After 1 week of stable operation: drop `compass_brand_voice` table.

**Lovable:**
- Remove the **Brand Voice** tab from Content Ops Configuration page (the tab shown in the screenshot).
- One-time banner in Content Ops config: "Brand Voice has moved to Brand Kit (Management → Brand Kit)."

**MM:** nothing.

**Acceptance:**
- Existing content generation continues producing the same output (same `{{brand_voice}}` substitution, just from a new table).
- Strategist editing voice now does so in Brand Kit.
- `compass_brand_voice` table dropped without breakage.

---

### Phase 4 — New Visual Variables *(~2 days)*

**Goal:** make brand kit visual sections available to prompts.

**This repo:**
- Add resolvers in `context.ts` for:
  - `{{brand_color_palette}}` → formatted hex codes + role labels
  - `{{brand_visual_identity}}` → mood + description + keywords
  - `{{brand_photography_treatment}}` → mood, subjects, composition rules
  - `{{brand_iconography}}` → style + weight + examples
  - `{{brand_typography}}` → heading + body font + rules
  - `{{brand_logo_rules}}` → variant + clear-space + min-size guidance
  - `{{brand_kit_full}}` → all sections rendered as one block (heavy — for prompts that need everything)
- Each resolver gets a graceful empty-state fallback string.
- Each resolver gets a `VARIABLE_CATALOG` entry — automatically appears in the Variables tab.

**Lovable:** automatic — the new variables show up in the catalog tab.

**MM:** nothing yet — these variables are available in this repo's template engine but MM's prompt configs may want to reference them via the existing `{{var}}` substitution.

**Acceptance:** prompt authors can use new variables in Global Prompts; rendered output reflects the brand kit's visual sections.

---

### Phase 5 — Multimodal MM Infrastructure *(~3-4 weeks)*

**Goal:** add image/PDF/video frame input support to MM. Foundational for everything that follows.

**MM:**
- Accept multimodal inputs in deliverable submissions:
  - Image URLs (signed Supabase storage URLs work fine)
  - PDFs (extract pages → images, plus extract text + embedded font metadata)
  - Video sample frames (later — out of scope for v1)
- Vision-capable LLM integration (Claude vision / GPT-4V / Gemini — pick based on cost/quality benchmarks).
- New input shape on submit: `attachments: [{ type, url, metadata }]`.
- Pre-extraction utilities (run before LLM synthesis):
  - PDF text + image extraction (`pdf-parse`, `pdfjs`)
  - K-means color clustering on extracted images
  - Embedded font name extraction from PDF metadata
  - OCR fallback for image-heavy PDFs
- Webhook callback shape unchanged — still returns structured content.

**This repo:**
- Update `backend/src/services/master-marketer/client.ts` `submitDeliverable()` signature to accept `attachments`.
- Wire signed-URL generation for asset attachments (similar to how brief reference images work in the existing `generate` endpoint at `routes/compass/deliverables.ts:494-514`).

**Lovable:** nothing yet — used by Phase 6+ work.

**Acceptance:**
- MM can accept a PDF + image attachments and produce structured output.
- Backend can submit attachments without breaking existing text-only flows.

---

### Phase 6 — Brand Kit AI Ingestion *(~2 weeks, depends on Phase 5)*

**Goal:** strategist uploads brand materials → system proposes a draft brand kit for refinement.

**MM:**
- Register `brand_kit` as a generatable deliverable type.
- Prompt config: take pre-extracted color palette + font names + page screenshots + OCR text → produce structured brand kit JSON matching the schema.
- Each output field includes source attribution: "Primary color #FF5733 — extracted from page 4 of brand-guidelines.pdf".
- Output is always **draft** — never auto-approved.

**This repo:**
- Add `brand_kit` to `GENERATABLE_TYPES` in `routes/compass/deliverables.ts:472`.
- Add `brand_kit` branch in the processor (`services/deliverable-generation/processor.ts`) — assemble attachments, submit to MM, await webhook.
- New endpoint or reuse: `POST /api/compass/deliverables/:id/generate` works for brand_kit generation; just needs `attachments` in the request body.
- Webhook handler writes the proposed kit to `compass_brand_kit` as a new draft version.

**Lovable:**
- Brand Kit Overview page gets an "Upload + generate draft" affordance.
- Upload UI: multi-file drop zone (PDFs, images), URL input field for website scraping.
- After upload + submit: shows progress (extraction → synthesis), then renders the draft for review.
- Side-by-side review UI: each field shows source attribution + edit affordance + accept/reject.
- Once strategist accepts the draft → it becomes the new approved brand kit version.

**Acceptance:**
- Upload a brand-guideline PDF → get back a structured draft kit with most colors, fonts, and visual descriptions populated.
- Strategist can refine and approve.
- Source attribution visible on every AI-extracted field.

---

### Phase 7 — Creative Brief Generation *(~2 weeks)*

**Goal:** generate structured visual briefs that reference the brand kit.

**MM:**
- Register `creative_brief` as a generatable deliverable type.
- Prompt config: take asset goal + audience + brand kit (relevant sections) + reference materials → produce structured brief.
- Brief output schema: `{ asset_type, objective, audience, key_message, brand_kit_refs: [{ section, rationale }], deliverable_specs (dimensions, format), success_criteria, references }`.

**This repo:**
- Migration: `compass_creative_brief` (or reuse `compass_deliverables` with `deliverable_type='creative_brief'`).
- Add `creative_brief` to `GENERATABLE_TYPES` and processor.
- Resolver passes the relevant brand kit sections (referenced by `brand_kit_refs`) into the prompt.

**Lovable:**
- New module entry: **Creative Ops** in left sidebar (sibling to Content Ops).
- Brief creation flow: select asset type → answer brainstorm questions → trigger generation → review/edit/approve.
- Brief renders with linked brand kit elements highlighted.

**Acceptance:** strategist can produce an approved creative brief that references brand kit elements with rationale.

---

### Phase 8 — Creative QA Pipeline *(~2-3 weeks)*

**Goal:** designer-uploaded asset gets pre-flight checked against brief + brand kit before client delivery.

**MM:**
- Register `creative_qa` as a generatable deliverable type.
- Prompt config: take brief + brand kit + uploaded asset (image/PDF) → produce structured QA report.
- QA output schema: `{ checks: [{ category, criterion, result: pass|fail|warning, evidence, recommendation }], overall_pass: boolean, summary }`.
- Categories include: deterministic (color palette overlap, logo presence, dimensions/aspect ratio), qualitative (mood match, photography treatment match, voice/microcopy alignment).

**This repo:**
- Migration: `compass_creative_asset` table for uploaded assets (file_url, version, status, brief_id ref).
- Migration: `compass_creative_qa_report` table linking asset + brief + brand kit version + QA results.
- Add `creative_qa` to `GENERATABLE_TYPES` and processor.
- Asset storage bucket: `creative-assets/{contract_id}/{asset_id}/...`.

**Lovable:**
- Creative Ops module: Asset upload UI under each brief.
- QA report UI: pass/fail badges per check, evidence (e.g. "logo not found in expected zone"), recommendations.
- Status flow: uploaded → in QA → revisions needed → QA passed → approved for client.

**Acceptance:** uploading a designed asset produces a structured QA report that flags brand kit deviations and brief misalignments.

---

### Phase 9 — Pitch Guide Generation *(~1-2 weeks)*

**Goal:** auto-generate a strategist-facing presentation rationale doc tied to brand kit.

**MM:**
- Register `pitch_guide` as a generatable deliverable type.
- Prompt: take brief + asset + QA report + brand kit → produce structured pitch doc.
- Pitch guide schema: `{ executive_summary, design_decisions: [{ decision, brand_kit_anchor, rationale, client_talking_point }], expected_outcomes, next_steps }`.

**This repo:**
- Migration: extend asset record or new `compass_pitch_guide` table.
- Add `pitch_guide` to `GENERATABLE_TYPES` and processor.

**Lovable:**
- Pitch guide view: presentable layout for strategist to walk through with client.
- Client-visibility toggle.
- Export to PDF (later phase).

**Acceptance:** strategist gets a structured rationale doc per asset, ready to walk a client through.

---

## 5. API Contracts (Cross-Repo Seams)

### Lovable ↔ This repo

Existing pattern reused. New endpoints:

- `GET /api/pulse/template-variables` (Phase 1) — returns variable catalog
- `POST /api/compass/deliverables/:id/generate` — accepts `attachments` (Phases 5+)

CRUD on `compass_brand_kit`, `compass_creative_brief`, `compass_creative_asset`, `compass_creative_qa_report`, `compass_pitch_guide` — direct Supabase via RLS, no new endpoints needed.

### This repo ↔ MM

Existing pattern reused (`submitDeliverable` + webhook callback). Updates:

- `submitDeliverable()` accepts `attachments: [{ type: 'pdf'|'image', url, metadata? }]`
- New deliverable types registered in MM: `brand_kit`, `creative_brief`, `creative_qa`, `pitch_guide`

---

## 6. Open Questions

1. **Voice in microcopy on visuals** — when a graphic includes copy (ads, infographics), QA should check both visual brand AND voice. Do we run two QA passes (Creative + Content), or fold it into one Creative QA pass that pulls voice from brand kit?
2. **Asset versioning** — designers iterate. v1, v2, v3 of an asset. Do prior versions retain their QA reports for audit? (Lean: yes.)
3. **Re-QA on brand kit change** — if brand kit is updated after an asset was approved, do we flag the asset as "needs re-QA"? (Lean: surface a soft warning, don't auto-revoke approval.)
4. **Video QA** — frame extraction + transcript checks. V1: out of scope. Phase X.
5. **Source file uploads (Figma, AE)** — out of scope. QA runs on rendered exports only.
6. **Vision model choice for MM** — Claude vision vs. Gemini vs. GPT-4V. Run benchmarks during Phase 5 with sample brand kits / asset checks.
7. **Cost ceiling per asset QA** — multimodal calls aren't cheap. Add a per-month token budget per contract or per workspace.

---

## 7. Sequencing Summary

```
Phase 1 (Variable Catalog)        ─┐
Phase 2 (Brand Kit Foundation)     ├─ Foundation, parallel-able
Phase 3 (Voice Migration)          │  (Phase 3 needs Phase 2)
Phase 4 (Visual Variables)        ─┘
                  │
                  ▼
Phase 5 (MM Multimodal) ──────────── Foundational infra unlock
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
Phase 6 (Brand Kit AI)   Phase 7 (Creative Brief)
        │                   │
        └─────────┬─────────┘
                  ▼
Phase 8 (Creative QA)
                  │
                  ▼
Phase 9 (Pitch Guide)
```

Phases 1–4 can overlap. Phase 5 is the long pole. Phases 6–9 unlock once Phase 5 lands.

---

## 8. Acceptance Criteria for Whole Initiative

- Brand Kit exists per contract, structured, versioned, client-visible when approved.
- Voice has migrated cleanly from Content Ops config to Brand Kit; no prompts broken.
- Variable catalog is published in Global Content; strategists can self-serve documentation.
- Creative briefs reference brand kit elements with rationale; AI-generated drafts available.
- Designer-uploaded assets get automated QA against brief + brand kit.
- Pitch guides auto-generated per asset with brand kit-anchored rationale.
- Every prompt edit, brand kit change, and AI-generated draft is auditable.

---

**End of plan.**
