# Spec: Content Optimization in Compass

**Type:** New action pattern in Content Ops + initial SEO optimization prompt sequences + Master Marketer SEO enrichment endpoint
**Status:** Spec — ready for implementation
**Audience:** Three repos: **MiD App v1** (this repo, the backend), **Lovable** (frontend), **Master Marketer** (data orchestration API)

This spec adds a third top-level action on Content Ops assets — **Optimize** — alongside the existing Generate and Manual actions. Optimize takes an existing content asset as load-bearing input, runs a purpose-built prompt sequence against it, and produces a new asset that can supersede the original on approval.

For SEO-flavored optimization specifically, the prompt sequence is enriched with real-time intelligence from Master Marketer's DataForSEO pipeline (SERP, AI Overview, PAA, content gap, AEO signals). MM acts as a **stateless data API** here — it gathers and packages, the backend's Compass engine runs the LLM. All content_assets continue to be generated and stored in this repo.

The pattern is reusable beyond SEO (voice refresh, CRO rewrites, outdated-content updates), but the immediate driver is a strategist request for SEO optimization workflows.

---

## Work split — who builds what

| | Backend (this repo) | Lovable (frontend) | Master Marketer |
|---|---|---|---|
| **Schema** | `content_prompt_sequences.purpose`, `content_assets.source_asset_id`, `content_assets.superseded_by_asset_id`, new `landing_page` content type, `seo_keyword_cache` table | — | — |
| **Template variable: `{{existing_content}}`** | Resolver in `context.ts` | — | — |
| **Template variables: SEO** | New resolvers + `VARIABLE_CATALOG` entries | — | — |
| **Engine changes** | Accept `input_asset_id`; create new output asset; set `source_asset_id`; SEO enrichment hook | — | — |
| **Supersede endpoint** | `POST /api/compass/content/assets/:id/supersede` (atomic transition + RAG cleanup) | — | — |
| **RAG cleanup** | On status → superseded, delete asset's chunks from `compass_knowledge` | — | — |
| **SEO enrichment client** | `services/seo/master-marketer-client.ts` typed wrapper | — | — |
| **SEO enrichment endpoint** | — | — | `POST /api/v1/seo/enrich-keyword` returning structured intelligence |
| **`gatherSeoOptimizeContext()`** | — | — | New focused gatherer (slimmer than `gatherAllSeoIntelligence`) using existing DFS modules |
| **Optimize button + modal** | — | UI work | — |
| **Diff view + rationale sidebar** | — | UI work — side-by-side source vs. optimized + sticky "Changes made" sidebar | — |
| **Supersede action UI** | — | "Publish & supersede original" button on optimized asset | — |
| **Prompts page grouping** | — | Group by purpose within each content type | — |
| **Library default filter** | — | Hide `superseded` by default; "Show superseded" toggle | — |
| **Sequence editor** | — | Purpose dropdown when creating a sequence | — |
| **Initial prompt sequences** | Migration seed (or manual entry via UI) | Sequences appear automatically once seeded | — |

Generation runs through this repo's `content-generation/engine.ts`. MM is invoked only as a data source for SEO-aware sequences — never to run the LLM itself for optimize.

---

## 1. Core concepts

### Generate vs Optimize

| | Generate | Optimize |
|---|---|---|
| **What it does** | Creates content from scratch into the current asset | Transforms an existing asset into a new asset |
| **Input** | Topic + optional reference content (inspiration, max 5 by default) | A single required source asset (`input_asset_id`) + optional reference content |
| **Output** | Writes `content_body` of the *current* asset | Creates a *new* asset with `source_asset_id` pointing back to the source |
| **Source asset** | n/a | Required, single, structurally distinct from "reference content" |
| **Prompt sequence purpose** | `generate` | `optimize` |

The distinction matters because the source asset is the **load-bearing input** — the prompt's `{{existing_content}}` variable resolves from it, and the output is a transformation of it. Reference content (inspiration) is still optionally available, but it's a different kind of input.

### SEO enrichment

When a prompt sequence's variables include `target_keyword` and the strategist provides a value, the engine calls Master Marketer's `enrich-keyword` endpoint before running the LLM. MM uses its existing DataForSEO infrastructure (SERP live advanced, search intent, content gap, LLM mention checks) to gather a focused intelligence package and returns it as structured JSON. The backend formats this into new template variables: `{{seo_keyword_data}}`, `{{serp_top_results}}`, `{{ai_overview_status}}`, `{{people_also_ask}}`, `{{related_keywords}}`, `{{content_gap}}`, `{{aeo_signal}}`, `{{ranking_status}}`. The prompt references them and produces SEO-aware output. The mechanism is **input-driven** — no toggle, no flag. If a sequence doesn't define `target_keyword`, no enrichment fires.

### Supersede

When a strategist approves an optimized asset, the original becomes **superseded** — preserved in the database for audit but hidden from the default library view. Single canonical asset per logical piece of content; no duplicates.

Status lifecycle:

```
draft → in_review → published → superseded
                              ↘ archived (terminal, no replacement)
```

`superseded` and `archived` are both terminal states. The difference: superseded means another asset replaced this one (`superseded_by_asset_id` is set); archived means killed without a replacement.

---

## 2. Schema changes

### 2.1 `content_prompt_sequences.purpose`

```sql
ALTER TABLE content_prompt_sequences
  ADD COLUMN purpose text NOT NULL DEFAULT 'generate';

ALTER TABLE content_prompt_sequences
  ADD CONSTRAINT prompt_sequence_purpose_valid
  CHECK (purpose IN ('generate', 'optimize'));
```

All existing sequences default to `'generate'` — no behavior change for anything currently shipped.

### 2.2 `content_assets` — source/supersede links

```sql
ALTER TABLE content_assets
  ADD COLUMN source_asset_id uuid REFERENCES content_assets(asset_id);

ALTER TABLE content_assets
  ADD COLUMN superseded_by_asset_id uuid REFERENCES content_assets(asset_id);

CREATE INDEX idx_content_assets_source ON content_assets(source_asset_id);
CREATE INDEX idx_content_assets_superseded_by ON content_assets(superseded_by_asset_id);
```

`status` stays as free-text (no enum migration needed). New documented values: `superseded`, `archived`. Frontend should treat these as part of the canonical set.

### 2.3 New global content type: `landing_page`

Required for the "SEO-optimize existing landing page" case (and for a future "Develop new SEO-optimized landing page" generate sequence).

```sql
INSERT INTO content_types (
    contract_id, name, slug, description, is_active, sort_order,
    is_rag_eligible, max_pinned_references
)
VALUES (
    NULL,
    'Landing Page',
    'landing_page',
    'Conversion-focused page with a single goal — value prop, supporting copy, CTA. Distinct from blog posts in intent and structure.',
    true,
    20,
    true,    -- landing pages ARE source content; embed for RAG
    5        -- standard cap
);
```

---

## 3. Backend changes

### 3.1 Template variable: `{{existing_content}}`

Add to `backend/src/services/content-generation/context.ts` alongside the existing variables (around the `formatBrandVoice` and variables-map area):

```ts
// Resolve the source asset's content_body for optimize-purpose sequences
let existingContent = '';
if (input_asset_id) {
  const sourceRows = await select<Array<{ content_body: string | null; title: string }>>(
    'content_assets',
    {
      select: 'content_body, title',
      filters: { asset_id: input_asset_id },
      limit: 1,
    }
  );
  const source = sourceRows?.[0];
  if (source?.content_body) {
    existingContent = `Title: ${source.title}\n\n${source.content_body}`;
  }
}

// In the variables map:
existing_content: existingContent || 'No source content provided. This appears to be misconfigured — an optimize-purpose sequence requires a source asset.',
```

The fallback string is intentionally noisy — if the strategist somehow ran an optimize sequence without a source asset, the model output will surface the misconfiguration rather than silently producing garbage.

Add a corresponding entry to `VARIABLE_CATALOG`:
- name: `{{existing_content}}`
- description: "The full content of the source asset being optimized."
- source: `content_assets.content_body` of the asset specified by `input_asset_id`
- empty_state: as above
- recommended_use: "Optimize-purpose sequences only."

### 3.2 Engine: accept `input_asset_id`, create new output asset

In `backend/src/services/content-generation/engine.ts`:

- `GenerateParams` adds an optional `input_asset_id?: string` field.
- When the resolved sequence's `purpose === 'optimize'`:
  - Validate `input_asset_id` is provided (reject early with a clear error if missing).
  - Validate the source asset's `status` is not `superseded` (reject — can't fork a superseded asset).
  - **Create a new asset record** in `draft` status before generation runs:
    - `title`: `${source.title} — Optimized` (or whatever pattern the sequence specifies; configurable later)
    - `content_type_id`: same as source
    - `source_asset_id`: the source's id
    - `metadata.optimize`: { source_asset_id, sequence_id }
  - Generation writes `content_body` to the **new** asset, not the source.
  - Pass `input_asset_id` through `gatherGenerationContext()` so the resolver above can populate `{{existing_content}}`.
- When `purpose === 'generate'`: existing flow unchanged.

### 3.3 Supersede endpoint

```
POST /api/compass/content/assets/:id/supersede
```

Body:
```json
{
  "superseded_by_asset_id": "uuid"
}
```

Auth: `admin` or `team_member` (consistent with other content routes).

Logic (atomic, within a single Supabase RPC or sequenced calls in a transaction-like flow):

1. Fetch both assets. Return 404 if either missing.
2. Validate:
   - The "from" asset (`:id`) must be in `published` status. Reject with 422 (`error_code: 'NOT_PUBLISHED'`) otherwise.
   - The "to" asset (`superseded_by_asset_id`) must be in `in_review` or `published` status (we allow direct supersede without an explicit publish step, since the "Publish & supersede" UI does both atomically).
   - The "to" asset's `source_asset_id` must equal `:id` (defense against stray input). Reject with 422 (`error_code: 'NOT_DERIVED_FROM_SOURCE'`) otherwise.
   - The "to" asset must not already be superseded itself.
3. Apply the transition:
   - Old asset: `status = 'superseded'`, `superseded_by_asset_id = <new>`.
   - New asset: `status = 'published'`, copy `published_url` and `published_date` from old if not already set on new.
4. Fire-and-forget: delete old asset's chunks from `compass_knowledge`:
   ```sql
   DELETE FROM compass_knowledge
   WHERE source_type = 'content' AND source_id = :id;
   ```
5. Return 200 with both updated asset records.

Failure modes:
- `404` — asset(s) not found.
- `422 NOT_PUBLISHED` — old asset isn't published.
- `422 NOT_DERIVED_FROM_SOURCE` — new asset's source doesn't match.
- `422 ALREADY_SUPERSEDED` — new asset has been superseded already.
- `500` — DB error.

### 3.4 RAG cleanup on archive

Same pattern: when an asset's status flips to `archived`, fire-and-forget delete from `compass_knowledge`. Either expose as a separate endpoint or piggyback on existing update flows. Cleanest: add a small post-update hook that watches for `status` transitions to `superseded` or `archived` and triggers the delete.

### 3.5 SEO enrichment via Master Marketer

When `gatherGenerationContext()` is building variables and detects `target_keyword` is present (from sequence inputs), it calls MM's enrichment endpoint in parallel with the rest of context gathering.

**New service module:** `backend/src/services/seo/master-marketer-client.ts`

```ts
import { getEnv } from '../../config/env.js';

export interface SeoEnrichmentRequest {
  target_keyword: string;
  secondary_keywords?: string[];
  country?: string;            // ISO 3166-1 alpha-2, default 'us'
  client_brand?: string;       // for AEO checks (LLM mentions); optional
  client_domain?: string;      // for content_gap + ranking_status; optional
  competitor_domains?: string[]; // up to 3, for content_gap; optional
}

export interface SeoEnrichmentResponse {
  target_keyword: string;
  country: string;
  fetched_at: string;
  keyword_data: { /* see §9.2 */ };
  serp: { /* see §9.2 */ };
  related_keywords: Array<{ keyword: string; volume: number; difficulty?: number; intent?: string }>;
  content_gap?: Array<{ keyword: string; competitor_position: number; client_position: number | null; search_volume: number }>;
  aeo: { /* see §9.2 */ };
  ranking_status?: { /* see §9.2 */ };
  errors: string[];
}

export async function enrichKeyword(req: SeoEnrichmentRequest, signal?: AbortSignal): Promise<SeoEnrichmentResponse> {
  const url = `${process.env.MASTER_MARKETER_URL}/api/v1/seo/enrich-keyword`;
  const apiKey = process.env.MASTER_MARKETER_API_KEY;
  if (!apiKey) throw new Error('MASTER_MARKETER_API_KEY not configured');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(req),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`MM enrich-keyword failed: ${resp.status} ${text.slice(0, 300)}`);
  }
  return resp.json() as Promise<SeoEnrichmentResponse>;
}
```

**Engine hook in `context.ts`:** when assembling variables for a generation run, if `target_keyword` is non-empty:

1. Check `seo_keyword_cache` for `(target_keyword, country)` within TTL.
2. If cache miss, call `enrichKeyword()` and store the response.
3. Format the response into the new template variables (see §3.6).
4. **On error / timeout (10s):** log a warning, populate variables with empty-state strings, and add a `seo_enrichment_unavailable: true` flag to the variables map. The prompt's "Changes made" section instructs the model to acknowledge the missing data when this flag is set.

The fetch should run in parallel with the rest of `gatherGenerationContext()` work — never block on enrichment if other context is ready.

### 3.6 New template variables

Each gets a resolver in `context.ts` and a `VARIABLE_CATALOG` entry. The resolver pulls from the cached enrichment payload and formats appropriately for prompt injection.

| Variable | Resolves to | Empty-state |
|---|---|---|
| `{{seo_keyword_data}}` | Formatted block: volume, difficulty, CPC, intent breakdown, parent topic | "No SEO keyword data available." |
| `{{serp_top_results}}` | Numbered markdown list of top-10 organic results: position, title, URL, domain rating | "No SERP data available." |
| `{{ai_overview_status}}` | Either "AI Overview is present for this query. Current AI Overview content: [text]. Cited sources: [...]" OR "No AI Overview present for this query." | "AI Overview status unknown." |
| `{{people_also_ask}}` | Numbered list of PAA questions + expanded answers (when available) | "No People Also Ask data available." |
| `{{related_keywords}}` | Markdown table of top 10 related keywords with volume + intent | "No related keyword data available." |
| `{{content_gap}}` | If `client_domain` + `competitor_domains` provided: list of keywords competitors rank for that the client doesn't | "No content gap analysis available." |
| `{{aeo_signal}}` | "Brand mentioned in N of M LLM responses. Currently appearing in: [ChatGPT/Perplexity]. Competing brands appearing: [list]." | "No AEO data available." |
| `{{ranking_status}}` | If `client_domain` provided: "Currently ranking position N for [URL] (estimated traffic: X)" or "Not currently ranking in top 100." | "Ranking status not checked." |

### 3.7 SEO keyword cache

```sql
CREATE TABLE seo_keyword_cache (
  cache_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword    text NOT NULL,
  country    text NOT NULL DEFAULT 'us',
  payload    jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (keyword, country)
);

CREATE INDEX idx_seo_keyword_cache_lookup ON seo_keyword_cache(keyword, country, fetched_at);
```

**TTL strategy:** 24h for the full payload by default. The cache table stores the entire MM response as `payload`; the resolver checks `fetched_at` and refetches if stale. For high-velocity terms (where SERP can shift fast) we may eventually split into two TTLs (keyword data: 24h, SERP: 6h) but v1 keeps it simple.

**No metering / budget tracking in v1** — caching keeps usage reasonable, and broader API observability belongs in a separate platform-level workstream covering all paid APIs (Anthropic, OpenAI, MM, DataForSEO, etc.).

---

## 4. Frontend changes (Lovable)

### 4.1 Assets page — new Optimize button

Top-right action area gets a third button alongside Generate and Manual:

```
[ ✨ Generate ]   [ 🔄 Optimize ]   [ 📝 Manual ]
```

The Optimize button has the same role gating as Generate (admin / team_member).

### 4.2 Optimize modal

When the button is clicked from the Assets page header (no asset preselected):

**Step 1 — Pick the source asset.**
- Searchable select listing all assets in the contract where:
  - `status = 'published'` (you can only optimize published content).
  - `content_body` is not null/empty (nothing to optimize on empty assets).
  - The asset isn't superseded.
- Show: title, content type badge, published date, deliverable URL if any.
- Empty state: "No assets eligible for optimization yet."

**Step 2 — Pick the optimize sequence.**
- Filtered to: `purpose = 'optimize'` AND `content_type_slug` matches the source asset's content type.
- If no optimize sequences exist for that content type: "No optimize sequences available for [Content Type]. [Manage prompts]" with link to the Prompts page.

**Step 3 — Fill in sequence variables.**
- Pulls variables from the chosen sequence (e.g. `target_keyword`, `secondary_keywords`, `search_intent`).
- Plus optional reference content / deliverables pickers (same as Generate modal — respects `max_pinned_references` from the content type).

**Step 4 — Submit.**
- Backend creates a new draft asset (`source_asset_id` set), runs generation, streams output.
- On completion, redirect to the new asset's detail page.

**Alternative entry point:** add an "Optimize this" action in the kebab menu of each row on the Assets page (and the asset detail page). Pre-selects the source asset and skips Step 1.

### 4.3 Asset detail — Diff view for optimized assets

When viewing an asset whose `source_asset_id` is set, surface a diff view:

- Tab toggle near the top: **"View"** | **"Diff vs. Original"**
- Diff view: side-by-side, source on the left (from `source_asset.content_body`), optimized on the right (from current asset's `content_body`).
- Markdown rendered, with subtle highlights for added/changed/removed sections (markdown-aware diff library — there are several JS options).
- The diff is read-only. To edit, switch back to "View" tab.

For v1, side-by-side is enough. Inline diff is a Phase 2 ask.

### 4.4 Asset detail — "Publish & supersede original" action

Visible on optimized assets (those with `source_asset_id` set) that are in `draft` or `in_review`:

```
[ Publish & supersede original ]   [ Archive (don't supersede) ]
```

Clicking "Publish & supersede original":
- Confirmation modal: "This will mark 'Original Title' as superseded and replace it with this version. Continue?"
- On confirm: calls `POST /api/compass/content/assets/:source_id/supersede` with this asset's id.
- On 200: redirect to the new asset's detail page; show toast "Optimized version published. Original superseded."
- On 422: show the error to the user (e.g. "Source is no longer in published state — refresh and retry").

"Archive (don't supersede)" sets the *optimized* asset's status to `archived` and leaves the source untouched. For when the strategist tried optimizing but doesn't like the result.

### 4.5 Prompts page — group by purpose

Within each content type group, show two subheads:

```
▼ Blog Post                                     2 sequences

  Generate
  ⭐ Standard Blog Post  • Global  3 steps  ...
  Thought Leadership     • Global  2 steps  ...

  Optimize
  ⭐ SEO Optimization    • Global  1 step   ...
```

Empty Optimize section is hidden if no optimize sequences exist for that type.

### 4.6 Sequence editor — Purpose dropdown

When creating or editing a sequence, add a Purpose select at the top of the form:

- **Generate** (default) — "Creates content from scratch."
- **Optimize** — "Transforms an existing asset. Requires `{{existing_content}}` in the prompt."

If Optimize is selected and the user prompt doesn't contain `{{existing_content}}`, surface a non-blocking warning: "Optimize sequences should reference `{{existing_content}}` to use the source asset's content."

### 4.7 Library list — default filter

The Assets list filters to `status NOT IN ('superseded', 'archived')` by default. Add a "Show superseded / archived" toggle in the filter bar that strategists can flip when they want to see history.

---

## 5. Initial Optimize prompt sequences

Two new global sequences. Manual frontend entry is fine (matches how the user added the Social Post Package one).

### 5.1 SEO-optimize existing Blog Post

**Content type:** `blog_post`
**Purpose:** `optimize`
**Sequence name:** `SEO Optimize Blog Post`
**Default:** No (it's an alternative, not the standard)
**Sort order:** 50

**Variables:**
- `target_keyword` (text, required) — primary keyword to optimize for.
- `secondary_keywords` (text, optional) — comma-separated supporting keywords.
- `search_intent` (select: informational | commercial | transactional | navigational, required, default informational) — what the searcher wants from the page.
- `competitor_urls` (text, optional) — top-ranking competitor URLs for context.
- `additional_seo_notes` (text, optional) — anything else (e.g. internal linking targets, schema markup notes).

**Step name:** `optimize`
**Output key:** `final`

**System prompt:**
```
You are an SEO content editor for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. You optimize existing blog posts for organic search performance without losing the author's voice or substantive arguments. You think in terms of E-E-A-T (experience, expertise, authoritativeness, trustworthiness), search intent alignment, AI Overview readiness, and natural keyword integration — not stuffing. You make data-driven recommendations grounded in real SERP intelligence, not generic best practices.
```

**User prompt:**
```
Optimize this blog post for SEO.

**Target keyword:** {{target_keyword}}
**Secondary keywords:** {{secondary_keywords}}
**Search intent:** {{search_intent}}
**Additional notes:** {{additional_seo_notes}}

## Source post

{{existing_content}}

## SEO intelligence (real-time data from DataForSEO)

### Keyword data
{{seo_keyword_data}}

### What's ranking on page 1 right now
{{serp_top_results}}

### AI Overview status
{{ai_overview_status}}

### People Also Ask (high-value gaps to fill)
{{people_also_ask}}

### Related keywords worth covering
{{related_keywords}}

### Content gap (what competitors cover that this site doesn't)
{{content_gap}}

### AEO signal (how AI engines treat this query)
{{aeo_signal}}

### Current ranking
{{ranking_status}}

## Optimization principles

1. **Preserve voice and substance.** Don't rewrite for the sake of rewriting. The original author's perspective and arguments stay intact.
2. **Title and H1.** Ensure the target keyword appears naturally in the title and H1, ideally near the front. Don't force it if it makes the title awkward.
3. **Meta description.** Add or refine a meta description (under 160 characters) that includes the target keyword and a clear value proposition.
4. **H2/H3 structure.** Improve heading hierarchy. Use the SERP and PAA data above to identify the topic clusters competitors are covering — add H2s for any that are clearly missing.
5. **Keyword integration.** Work the target keyword and secondaries naturally into the first 100 words, into 1-2 H2s, and a few times in body — never stuffed. If a keyword doesn't fit naturally, leave it out.
6. **AI Overview readiness.** If the AI Overview is present for this query, restructure the first ~300 words to surface clear, snippet-friendly answers — concise definitions, bulleted lists, direct answers. AI Overviews cite content that answers the query directly, not content that meanders before getting to the point.
7. **People Also Ask coverage.** Identify any PAA questions above that the source post doesn't already answer well, and either add a short answer section or weave answers into existing copy. PAA inclusion is a meaningful traffic lever.
8. **Internal linking opportunities.** Where relevant, suggest 2-4 places where internal links to related content would help readers and crawlers — flag with `[INTERNAL LINK SUGGESTION: <topic>]` rather than inventing URLs.
9. **External authority.** Where claims need backing, suggest authoritative external links — flag with `[EXTERNAL LINK SUGGESTION: <type of source>]`.
10. **Search-intent alignment.** If the original drifts from the stated intent (e.g. informational post that pivots to a sales pitch), restructure to match.
11. **Readability.** Shorter paragraphs, clearer transitions, scannable formatting. Add a TL;DR or key takeaways box if the post lacks one.

## Output format

Return the complete optimized post in markdown, ready to drop in. Below the post, include a "Changes made" section listing the major optimizations as bullets.

**Each bullet must cite the specific SEO signal that drove the change.** Examples of good bullets:
- "Added H2 'Marketing operations roles and responsibilities' — appears in 7 of 10 top-ranking competitors per SERP data; missing from source post."
- "Restructured opening paragraph as a 50-word definition followed by 3-bullet 'what it includes' — current AI Overview cites pages that lead with concise direct answers."
- "Replaced generic 'marketing tools' with 'marketing automation tools' (secondary keyword, 17,000 monthly searches per related keyword data)."
- "Added FAQ section answering 'What does a marketing operations team do?' — surfaced in PAA, no current page-1 result answers it well."

Avoid vague bullets like "Improved SEO structure." Every change must be grounded in a signal from the intelligence above.

If the SEO intelligence section above is empty (signaled by 'No SEO data available' messages), proceed with best-practice optimization and add a single bullet at the top of "Changes made" that says: "Note: SEO intelligence was unavailable for this run. Recommendations are based on best practices alone — re-run optimization once data is available for fully grounded changes."
```

### 5.2 SEO-optimize existing Landing Page

**Content type:** `landing_page` (the new type seeded in §2.3)
**Purpose:** `optimize`
**Sequence name:** `SEO Optimize Landing Page`
**Default:** Yes (first optimize sequence for this type)
**Sort order:** 1

**Variables:**
- `target_keyword` (text, required)
- `secondary_keywords` (text, optional)
- `search_intent` (select: commercial | transactional | navigational, required, default commercial) — landing pages rarely target informational intent.
- `competitor_urls` (text, optional)
- `primary_cta` (text, optional) — e.g. "Book a demo", "Start free trial". Helps the model preserve conversion focus.

**Step name:** `optimize`
**Output key:** `final`

**System prompt:**
```
You are an SEO content editor specializing in landing pages for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. You optimize existing landing pages for organic search and conversion simultaneously — never sacrificing one for the other. You understand that landing pages are conversion-driven: every section serves the path from search query to action. You make data-driven recommendations grounded in real SERP intelligence, not generic best practices.
```

**User prompt:**
```
Optimize this landing page for SEO without sacrificing conversion focus.

**Target keyword:** {{target_keyword}}
**Secondary keywords:** {{secondary_keywords}}
**Search intent:** {{search_intent}}
**Primary CTA:** {{primary_cta}}

## Source landing page

{{existing_content}}

## SEO intelligence (real-time data from DataForSEO)

### Keyword data
{{seo_keyword_data}}

### What's ranking on page 1 right now
{{serp_top_results}}

### AI Overview status
{{ai_overview_status}}

### People Also Ask
{{people_also_ask}}

### Related keywords worth covering
{{related_keywords}}

### Content gap
{{content_gap}}

### AEO signal
{{aeo_signal}}

### Current ranking
{{ranking_status}}

## Optimization principles

1. **H1 and value prop.** The H1 should clearly answer what searchers want and include the target keyword naturally. The supporting line beneath should reinforce the value proposition in <15 words. Look at top-ranking competitors above — what value props are they leading with?
2. **Above-the-fold density.** Critical info (what it is, who it's for, why it's worth the click, primary CTA) all visible without scrolling. Optimize ruthlessly.
3. **Section hierarchy.** Each section should map to a question prospects ask: "What is this?", "Who is it for?", "How does it work?", "What does it cost / how do I try it?", "What do others say?". Use the PAA data above to identify questions you should explicitly answer.
4. **Keyword integration.** Target keyword in H1, in 1-2 H2s, in the first paragraph, and 2-4 times in body — never stuffed. Secondary keywords woven naturally based on the related keyword data.
5. **AI Overview readiness.** If AI Overview is present for this query, ensure the H1 + first ~150 words answer the searcher's question directly enough to be cited.
6. **CTAs.** Preserve the primary CTA's intent. Recommend 1-3 strategic CTA placements (typically: above-fold, mid-page after value justification, near-bottom). Don't add CTA spam.
7. **Trust signals.** Identify gaps where social proof, customer logos, testimonials, or case study links would strengthen the page — flag with `[TRUST SIGNAL OPPORTUNITY: <what>]`.
8. **Page meta.** Title tag (under 60 characters) and meta description (under 160 characters), both including the target keyword and a clear value proposition.
9. **Conversion clarity.** No section should leave the reader confused about what to do next. If the original drifts into broad brand storytelling that doesn't move the prospect, tighten or cut.
10. **Readability and scanability.** Short paragraphs, clear bolded keywords or stats, bullet lists where they help.

## Output format

Return the complete optimized landing page in markdown, ready to drop in. Use comments like `<!-- HERO SECTION -->` to mark structural sections so the dev team knows where each block belongs.

Below the page, include a "Changes made" section listing the major optimizations as bullets. **Each bullet must cite the specific SEO or conversion signal that drove the change.** Examples:

- "Rewrote H1 from 'Better Marketing Operations' to 'Marketing Operations Software for Mid-Market B2B Teams' — top-ranking competitors all lead with audience qualifiers per SERP data; current H1 is too generic."
- "Added 'How does marketing operations work?' section — surfaced in PAA with no clear page-1 result currently answering it directly; opportunity to capture that traffic with a focused answer."
- "Moved primary CTA from page bottom to above-the-fold — search intent is commercial, prospects are evaluating, friction matters."

Avoid vague bullets like "Improved SEO structure." Every change must be grounded in a signal from the intelligence above.

If the SEO intelligence section above is empty (signaled by 'No SEO data available' messages), proceed with best-practice optimization and add a single bullet at the top of "Changes made" that says: "Note: SEO intelligence was unavailable for this run. Recommendations are based on best practices alone — re-run optimization once data is available for fully grounded changes."
```

---

## 6. State machine summary

```
Optimize action triggered
   │
   ▼
[New asset created in 'draft'] ── source_asset_id set ──▶ source asset (status: published)
   │
   ▼
Generation runs
   │
   ▼
Strategist reviews (status moves to 'in_review' optionally)
   │
   ├──▶ Approve & Supersede ──▶ NEW: 'published'    OLD: 'superseded' (RAG chunks deleted)
   │
   ├──▶ Archive (reject) ─────▶ NEW: 'archived'     OLD: unchanged ('published')
   │
   └──▶ Run again (try different sequence/variables) ──▶ Another draft optimized child
                                                          (parent has multiple drafts now;
                                                           strategist picks one to supersede with)
```

### Edge cases

- **Optimize an already-superseded asset.** Reject in the modal — "This asset has been superseded by 'X'. Optimize 'X' instead."
- **Multiple optimization drafts on the same source.** Allowed. Strategist picks one to supersede with; the others can be archived.
- **Source asset deleted while optimization is in progress.** Reject the supersede with a clear error and let the strategist decide what to do.
- **Optimized asset itself gets optimized.** Allowed — the new asset's `source_asset_id` points to the prior optimized version, not all the way back to the original. Forms a chain.
- **No source content (`content_body` empty).** Block in the modal — "This asset has no content to optimize. Generate or import content first."

---

## 7. Acceptance checklist

**Schema (this repo):**
- [ ] `purpose` column added to `content_prompt_sequences` with CHECK constraint.
- [ ] `source_asset_id` and `superseded_by_asset_id` columns added to `content_assets` (FK self-referential).
- [ ] `landing_page` content type seeded with sensible defaults.
- [ ] `seo_keyword_cache` table created with unique (keyword, country) constraint.

**Backend (this repo):**
- [ ] `{{existing_content}}` resolver added to `context.ts` and registered in `VARIABLE_CATALOG`.
- [ ] Engine accepts `input_asset_id` and creates a new draft asset for optimize-purpose sequences.
- [ ] Engine rejects optimize-purpose runs without `input_asset_id` or against superseded sources.
- [ ] `POST /api/compass/content/assets/:id/supersede` implemented with all four 422 error codes.
- [ ] Supersede transition deletes old asset's chunks from `compass_knowledge`.
- [ ] Archive transition (when applied to a published asset) also triggers RAG cleanup.
- [ ] `services/seo/master-marketer-client.ts` typed wrapper implemented with auth + 10s timeout + graceful failure.
- [ ] Engine context gatherer calls MM enrichment when `target_keyword` is non-empty.
- [ ] Cache lookup happens before MM call; cache populated on success.
- [ ] All eight new SEO template variables resolve correctly with empty-state fallbacks.
- [ ] All eight new SEO variables registered in `VARIABLE_CATALOG`.

**Master Marketer:**
- [ ] `POST /api/v1/seo/enrich-keyword` endpoint implemented (see §9).
- [ ] Endpoint authenticates against existing MM API key scheme.
- [ ] `gatherSeoOptimizeContext()` function implemented — runs SERP, search intent, related terms, and conditionally content gap + AEO checks in parallel.
- [ ] Response shape matches §9.2 exactly.
- [ ] `errors[]` array surfaces per-stream failures without failing the whole call.
- [ ] Endpoint returns within 15s for typical keywords (DFS calls in parallel).

**Frontend (Lovable):**
- [ ] Optimize button on Assets page header (admin / team_member only).
- [ ] Optimize modal — source picker (eligible assets only), sequence picker (purpose=optimize, matched to content type), variable inputs.
- [ ] Optimize action in row-level kebab menu (pre-selects source).
- [ ] Diff view tab on assets where `source_asset_id` is set.
- [ ] **Sticky "Changes made" sidebar** rendered alongside the diff, parsed from the optimized asset's content_body.
- [ ] "Publish & supersede original" action on optimized drafts.
- [ ] "Archive (don't supersede)" action on optimized drafts.
- [ ] Prompts page groups sequences by purpose within each content type.
- [ ] Sequence editor includes Purpose dropdown; warns if Optimize selected and `{{existing_content}}` missing.
- [ ] Library default filter excludes `superseded` and `archived`.
- [ ] "Show superseded / archived" toggle in library filter bar.

**Initial prompt sequences:**
- [ ] "SEO Optimize Blog Post" sequence seeded (purpose=optimize, content_type=blog_post).
- [ ] "SEO Optimize Landing Page" sequence seeded (purpose=optimize, content_type=landing_page).
- [ ] Both produce a complete optimized markdown asset + a "Changes made" rationale section that cites specific SEO signals.

**End-to-end:**
- [ ] Strategist optimizes a published blog post → new draft asset created with `source_asset_id` set.
- [ ] Backend logs show MM enrichment call happened with correct payload.
- [ ] Cache hit on second optimization with same target keyword within 24h (no second MM call).
- [ ] Diff view shows source vs. optimized side-by-side with "Changes made" sidebar.
- [ ] "Changes made" bullets cite specific SERP/PAA/AI Overview signals, not generic principles.
- [ ] Approving the optimized version transitions old to `superseded` and new to `published` atomically.
- [ ] Old asset's chunks are gone from `compass_knowledge` after supersede.
- [ ] Library list no longer shows the old asset by default.
- [ ] Toggling "Show superseded" surfaces it again with a badge.
- [ ] When MM is down, optimization still completes with a "SEO intelligence unavailable" disclaimer at the top of "Changes made".

---

## 8. Out of scope (intentionally)

- **"Develop new SEO-optimized blog post"** and **"Develop new SEO-optimized landing page"** — these are *generate*-purpose sequences, not optimize. They use the same `target_keyword`-driven enrichment hook (so they benefit from the SEO infrastructure built here) but ship as ordinary new global generate sequences. They don't depend on this spec landing first.
- **Content grader / score** (Surfer-style A-F grade against competitors). Cut for v1. The "Changes made" section already provides a soft form of grading. If real demand emerges, build later as another `purpose` value (`grade`) with its own prompt sequence.
- **API usage metering / budget tracking.** Not built in v1. When platform-level API observability is built (covering Anthropic, OpenAI, MM, DataForSEO), MM usage tracking folds into that.
- **In-place overwrites.** Optimize never writes to the source asset's `content_body`. If a strategist wants to "just edit the existing post manually," they use Manual mode (existing flow).
- **Version history UI.** Already discussed and rejected — the supersede pattern delivers the audit trail without showing strategists multiple versions of the same thing.
- **Cross-type optimization** (e.g. "turn this blog post into a landing page"). That's a transformation, not an optimization. Different feature, different prompt, different time.
- **Auto-rerun optimize on schedule** (e.g. "re-optimize every blog post once a quarter"). Out of scope for v1; revisit if real demand emerges.
- **Inline diff** (vs. side-by-side). Side-by-side is enough for v1.
- **Bulk optimize** (run the same sequence over 20 assets at once). V1 is one-at-a-time. Bulk could be a Phase 2 if the workflow demands it.
- **Surfer SEO / external grader integration.** If we want a third-party grade later, the optimized asset's markdown can be exported and fed to whatever tool. Not needed in-app.

---

## 9. Master Marketer endpoint contract — `POST /api/v1/seo/enrich-keyword`

**Owner:** Master Marketer team.
**Purpose:** Stateless data API. Takes a keyword + optional context, returns structured SEO/AEO intelligence using MM's existing DataForSEO infrastructure.

### 9.1 Request

```http
POST /api/v1/seo/enrich-keyword
x-api-key: ${MASTER_MARKETER_API_KEY}
Content-Type: application/json

{
  "target_keyword": "marketing operations",
  "secondary_keywords": ["marketing automation", "marketing ops"],   // optional, max 10
  "country": "us",                                                    // optional, ISO 3166-1 alpha-2, default "us"
  "client_brand": "Acme Marketing",                                   // optional; enables AEO checks
  "client_domain": "example.com",                                     // optional; enables ranking_status + content_gap
  "competitor_domains": ["competitor1.com", "competitor2.com"]        // optional, max 3; enables content_gap
}
```

**Auth:** `x-api-key` header matches MM's existing middleware (`src/middleware/auth.ts`). No new auth pattern.

**Validation:**
- `target_keyword`: required, 1–200 chars
- `country`: must be a valid ISO 3166-1 alpha-2 code if provided
- `client_brand`: free-text brand name used for `getLlmMentions()` and AEO response analysis
- `client_domain` / `competitor_domains`: stripped of protocol + trailing slash before use

### 9.2 Response (200 OK)

```json
{
  "target_keyword": "marketing operations",
  "country": "us",
  "fetched_at": "2026-04-28T15:30:00Z",

  "keyword_data": {
    "volume": 2300,
    "difficulty": 1,
    "cpc_usd": 0.60,
    "search_intent": {
      "main": "informational",
      "secondary": null,
      "probability": 0.92
    },
    "parent_topic": "marketing operations",
    "traffic_potential": 1100
  },

  "serp": {
    "top_organic": [
      {
        "position": 1,
        "url": "https://martech.org/...",
        "title": "What is marketing operations and what do MOps professionals do?",
        "domain": "martech.org"
      }
      // up to 10 organic results — no authority metrics in v1 (each requires
      // a separate backlinks API call per domain, blowing the latency budget).
      // Future: add enrich_with_authority: true flag if ever needed.
    ],
    "ai_overview": {
      "present": true,
      "content": "Marketing operations is the function that...",
      "references": [
        { "url": "https://...", "title": "..." }
      ]
    },
    "people_also_ask": [
      {
        "question": "What does a marketing operations team do?",
        "expanded_answer": "Marketing operations teams handle..."
      }
    ],
    "featured_snippet": null,
    "serp_features": ["ai_overview", "image_th", "video_th", "question", "news"]
  },

  "related_keywords": [
    { "keyword": "marketing operations analyst", "volume": 90, "difficulty": 0, "intent": "informational" }
    // top 10–15 related
  ],

  "content_gap": [
    {
      "keyword": "marketing operations roles and responsibilities",
      "competitor_position": 3,
      "client_position": null,
      "search_volume": 200
    }
    // Top 10–15 gap keywords sorted by volume.
    // Semantic: adjacent keywords competitors rank for that the client doesn't —
    // i.e. expansion opportunities, NOT structural gaps within the target keyword's SERP.
    // Structural gap analysis (what H2s competitors have that you don't) is derived
    // by the prompt from serp.top_organic titles + people_also_ask, not from this field.
    // Only present when client_domain + competitor_domains both provided.
  ],

  "aeo": {
    "llm_mentions_count": 4,
    "appears_in_chatgpt_responses": true,
    "appears_in_perplexity_responses": false,
    "competing_brands_in_llm_responses": ["Adobe", "HubSpot", "Atlassian"]
  },

  "ranking_status": {
    "client_currently_ranks": true,
    "client_position": 8,
    "client_url": "https://example.com/marketing-operations"
    // Position + URL only in v1, derived by scanning the existing SERP results
    // for client_domain. No estimated_traffic — would require an additional
    // labs call. Position alone is sufficient signal for the prompt.
  },

  "errors": []
}
```

**Field rules:**
- `keyword_data` is always present if the keyword was findable.
- `serp.top_organic` may be fewer than 10 if SERP is sparse; `serp.ai_overview` and `serp.featured_snippet` are nullable.
- `content_gap` is **omitted entirely** unless BOTH `client_domain` AND `competitor_domains` were provided.
- `aeo` is **omitted entirely** if `client_brand` was not provided. When present, fields may be zero/empty if checks couldn't run.
- `ranking_status` is **omitted** if `client_domain` was not provided.
- `errors` is an array of human-readable strings describing per-stream failures (e.g. `"AEO check failed: timeout"`). The endpoint does not fail just because one sub-check failed — it returns whatever it gathered with errors annotated.

### 9.3 Error responses

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | Missing or malformed `target_keyword`, invalid country code, etc. |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 422 | `KEYWORD_NOT_FOUND` | DataForSEO has no data for this keyword (rare but possible for very fresh terms) |
| 502 | `UPSTREAM_ERROR` | DataForSEO returned a 5xx — retried 3x then surfaced |
| 504 | `TIMEOUT` | Total endpoint runtime exceeded 15s |

Error response shape:
```json
{ "error_code": "INVALID_REQUEST", "message": "target_keyword is required" }
```

### 9.4 Implementation notes for the MM team

Build `gatherSeoOptimizeContext()` as a slimmer sibling of `gatherAllSeoIntelligence()`. **No full site crawl, no full backlink graph, no Lighthouse, no PageSpeed.** Only what's needed for keyword-scoped enrichment.

**Helpers to reuse (already in `src/lib/dataforseo/`):**
- **`getSerpResults()`** — single keyword, with `load_async_ai_overview: true` and `people_also_ask_click_depth: 2`. Powers `serp.top_organic`, `serp.ai_overview`, `serp.people_also_ask`, `serp.featured_snippet`, `serp.serp_features`. Also drives **`ranking_status`** — scan `top_organic` for `client_domain` to extract position + URL (no separate labs call needed for v1).
- **`getSearchIntent()`** — populates `keyword_data.search_intent`.
- **`getDomainIntersection()`** — for `content_gap` when both `client_domain` and `competitor_domains` are provided. Use as-is — no keyword filter needed since `content_gap` is intentionally domain-wide adjacent-keyword opportunity, not structural gap. Limit results to top 10–15 by volume.
- **`getLlmMentions()`**, **`getChatGptResponses()`**, **`getPerplexityResponses()`** — for the `aeo` block when `client_brand` is provided.

**New helper to add:**
- **`getKeywordOverview()`** — wraps `dataforseo_labs/google/keyword_overview/live` (or `bulk_keyword_difficulty` if cleaner). Returns volume, difficulty, CPC, parent_topic, traffic_potential. Powers `keyword_data` (everything except `search_intent`). `getSearchIntent()` does not return these — it's intent-only.

**Orchestration:**
- All sub-fetches in `Promise.allSettled` so partial failures don't fail the whole response.
- Per-stream errors surface in the `errors[]` array, not as endpoint failures.
- Total target latency: under 8 seconds typical, 15 seconds worst-case (timeout).
- **No caching on MM side** — caller (this repo) caches the response in `seo_keyword_cache`.

**Auth:** existing `x-api-key` middleware. No new pattern.

---

**End of spec.**
