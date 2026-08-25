# Prompt Sequence: Social Post Package

**Type:** New global prompt sequence + new content type
**Output:** Single markdown content asset containing N social posts
**Status:** Spec — ready for implementation

This spec bundles three related concerns so the work can ship as one coordinated change:

1. The Social Post Package prompt sequence + new content type
2. **Prerequisite:** `is_rag_eligible` flag on content types (so derivative content like this package isn't embedded into RAG)
3. **Prerequisite:** `max_pinned_references` field on content types (so this sequence can raise its reference cap from 5 to 15 without touching every other type)

---

## Work split — who builds what

| | Backend (this repo) | Lovable (frontend) |
|---|---|---|
| **Schema** | Migrations for both flags + seed of new content type + seed of prompt sequence | — |
| **RAG flag enforcement** | Gate ingestion in `engine.ts` based on `is_rag_eligible` | Toggle in the Content Type editor (admin-only) |
| **Max pinned cap** | Expose value on content type API; defense-in-depth server check | Numeric input in Content Type editor; dynamic max in Generate Content modal |
| **Prompt sequence** | Migration seed | Sequence appears automatically in the Global Prompts tab — no UI work |
| **Backfill** | One-time SQL to clean any pre-existing derivative content out of `compass_knowledge` | — |

No work crosses to MM. Generation runs through the existing `content-generation/engine.ts` pipeline.

---

## 1. What this generates

A monthly batch of social posts (default 8) for a single platform, mixing four kinds of posts:

1. **References existing content asset** — post repurposes a blog, ebook, etc. Links by `asset_id`.
2. **Recommends new asset** — post suggests a new image / illustration / video clip in plain prose, with rationale. No platform plumbing — strategist sources the asset off-platform.
3. **Reuse external link** — post points to an external URL (third-party article, partner content).
4. **Text-only** — punchy text post, no asset.

The package is **one** markdown content asset the strategist reads as a planning doc. They copy posts into their actual scheduler (Hootsuite, Buffer, native LinkedIn). No structured child rows, no per-post status tracking, no scheduling pipeline.

---

## 2. Inputs

| Variable | Required | Default | Notes |
|---|---|---|---|
| `post_count` | yes | 8 | Total posts to generate. |
| `platform` | yes | `linkedin` | Single platform per package; if multi-platform needed later, run the sequence twice. |
| `theme` | no | — | Optional thematic anchor ("Q2 sustainability focus", "Lab Safety Awareness Month"). Omit for general. |
| `time_period` | no | current month | Metadata only — appears in the markdown header. |
| Pinned reference content | no | — | Up to **15** assets (raised cap for this sequence; see §6). |
| Pinned reference deliverables | no | — | Standard 5 cap. |
| Brand voice (auto) | — | — | From brand kit (or legacy `compass_brand_voice` until migration). |
| Auto-RAG retrieval | — | — | Existing behavior — top N relevant assets pulled from library to broaden context beyond pinned set. |

---

## 3. Prompt sequence definition

Migration-style INSERT, matching the pattern in `backend/migrations/011_content_prompt_sequences.sql`.

```sql
-- New content type for social post packages
INSERT INTO content_types (contract_id, name, slug, description, is_active, sort_order, is_rag_eligible)
VALUES (
    NULL,
    'Social Post Package',
    'social_post_package',
    'A monthly batch of social posts for a single platform — mixes posts about existing assets, recommendations for new assets, external link reuse, and text-only posts.',
    true,
    50,
    false  -- DERIVATIVE OUTPUT — exclude from RAG to prevent incestuous retrieval
);

-- Prompt sequence: Social Post Package
INSERT INTO content_prompt_sequences (
    contract_id, content_type_slug, name, description,
    is_default, sort_order, steps, variables
)
VALUES (
    NULL,
    'social_post_package',
    'Standard Social Post Package',
    'Generates a monthly batch of social posts mixing existing-asset references, new-asset recommendations, and text-only posts.',
    true,
    1,
    $steps$[
        {
            "step_order": 1,
            "name": "generate",
            "system_prompt": "You are a social media strategist for {{company_name}}, a {{industry}} company. Brand voice: {{brand_voice}}. You produce monthly social post packages that keep an organization's social presence fresh and varied. You think in *programs*, not isolated posts: variety of angles, hooks, formats, and asset types so the feed doesn't feel monotonous.",
            "user_prompt": "Produce a social post package.\n\n**Platform:** {{platform}}\n**Post count:** {{post_count}}\n**Theme / focus:** {{theme}}\n**Time period:** {{time_period}}\n\n## Available content (use as inspiration; pinned items should be drawn from explicitly)\n{{reference_content_block}}\n\n## Brand visual identity (for asset recommendations)\n{{brand_visual_identity}}\n\n## Output format\n\nReturn a single markdown document. Header followed by N post sections. Each post must declare its asset note as exactly one of four types.\n\n```\n# Social Post Package — {{time_period}} ({{platform}}, {{post_count}} posts)\n\n**Theme:** [theme or 'general']\n**Pinned references:** [list pinned asset titles, comma-separated, or 'none']\n\n---\n\n## Post 1\n**Asset note:** [one of the four below]\n[Post copy here]\n\n**Rationale:** [1-2 sentences — what angle, why this hook, what it does for the feed]\n\n---\n\n## Post 2\n...\n```\n\n## Asset note types (use exactly one per post)\n\n1. **References blog post / ebook / case study:** *[title of the existing asset]*\n2. **Recommended new asset:** *[type — image / illustration / video clip / infographic]* — [vivid one-line description grounded in the brand visual identity]\n3. **Reuse external link:** *[URL or short description of the third-party content]*\n4. **Text-only**\n\n## Mix guidance (don't enforce hard ratios)\n\n- Vary the asset note types — don't make all posts the same kind.\n- Recommend new assets only when no existing asset fits the angle.\n- For platform = linkedin: longer-form OK, line breaks for readability, professional but conversational.\n- For platform = twitter / x: under 280 characters, punchy.\n- Avoid restating the same hook twice across the package.\n- Each post should stand alone — no 'see post 3' references.",
            "output_key": "final"
        }
    ]$steps$::jsonb,
    $vars$[
        {"name": "post_count", "label": "Number of Posts", "type": "number", "required": true, "default": 8},
        {"name": "platform", "label": "Platform", "type": "select", "options": ["linkedin", "twitter", "instagram"], "required": true, "default": "linkedin"},
        {"name": "theme", "label": "Theme / Focus (optional)", "type": "text", "required": false},
        {"name": "time_period", "label": "Time Period (e.g. May 2026)", "type": "text", "required": false}
    ]$vars$::jsonb
);
```

**Notes on the prompt:**

- `{{reference_content_block}}` is whatever the existing content-generation context assembler injects for pinned + auto-RAG-retrieved assets (already wired). The prompt assumes that block is present and well-formatted.
- `{{brand_visual_identity}}` is one of the new variables added in Phase 4 of the cross-repo plan. If Phase 4 hasn't shipped yet, use `{{brand_voice}}` as a fallback or omit the line — the prompt still works, it just produces less brand-aware asset recommendations.

---

## 4. Prerequisite — RAG eligibility flag

**This sequence cannot ship cleanly without this prerequisite.** Without the flag, every generated package gets embedded into `compass_knowledge`, and next month's package generation retrieves last month's posts as "relevant content" → echo chamber.

### 4.1 Schema change

```sql
ALTER TABLE content_types ADD COLUMN is_rag_eligible boolean NOT NULL DEFAULT true;

-- Backfill: mark known derivative output types as ineligible if any exist.
-- (Currently none, but worth the pass to surface candidates.)
-- UPDATE content_types SET is_rag_eligible = false WHERE slug IN ('social_post_package');
```

### 4.2 Backend gate

In `backend/src/services/content-generation/engine.ts` around line 327, before calling `ingestContent`, look up the asset's content type and skip ingestion if `is_rag_eligible = false`:

```ts
// Fire-and-forget: embed generated content into RAG knowledge base
if (contentBody && process.env.OPENAI_API_KEY) {
  const typeRows = await select<Array<{ is_rag_eligible: boolean }>>('content_types', {
    select: 'is_rag_eligible',
    filters: { type_id: content_type_id },
    limit: 1,
  });
  const isRagEligible = typeRows?.[0]?.is_rag_eligible ?? true;

  if (isRagEligible) {
    ingestContent({
      contract_id,
      source_type: 'content',
      source_id: asset_id,
      title: context.variables.topic,
      content: contentBody,
    }).catch((err) => {
      console.error(`[ContentGen] Embedding failed for asset ${asset_id} (non-blocking):`, err);
    });
  } else {
    console.log(`[ContentGen] Skipping RAG ingestion for asset ${asset_id} — content type marked non-eligible`);
  }
}
```

### 4.3 Frontend (Lovable)

Add an **"Eligible for RAG retrieval"** toggle to the content type create/edit form (admin-only — has real consequences for retrieval quality). Default: on. Show a small explanation: "When off, content of this type is not embedded into the knowledge base and won't be retrieved as inspiration for future generations. Use for derivative outputs like social packages or summaries."

### 4.4 Backfill option

If past social post packages or other derivative content already exist in `compass_knowledge`, run a one-time delete:

```sql
DELETE FROM compass_knowledge
WHERE source_type = 'content'
  AND source_id IN (
    SELECT asset_id FROM content_assets ca
    JOIN content_types ct ON ca.content_type_id = ct.type_id
    WHERE ct.is_rag_eligible = false
  );
```

---

## 5. Output asset behavior

- The generated package is saved as a `content_assets` row with `content_type_id` pointing at the `social_post_package` type.
- `content_body` holds the full markdown.
- Per the RAG flag, **no chunks are written to `compass_knowledge`** for this asset.
- Status flow: `draft → approved`. No deeper lifecycle — the package is a planning doc, not a live publication.
- Strategist can edit / regenerate / archive like any other content asset.

---

## 6. Prerequisite — Per-content-type `max_pinned_references`

The default cap is 5 pinned references. For Social Post Package specifically, raise to **15**:

- Most single-output prompts (one blog, one case study) only need a handful of inspirations — 5 is plenty.
- A package generating 8 posts benefits from drawing across more existing content. Capping at 5 forces strategists to pick favorites and produces a less varied feed.
- The cap belongs on the **content type** (same placement as `is_rag_eligible`) — it's a property of *what kind of asset this is*, not of the specific prompt sequence. Two sequences for the same content type should respect the same cap.

### 6.1 Schema change

```sql
ALTER TABLE content_types
  ADD COLUMN max_pinned_references int NOT NULL DEFAULT 5;
```

The `social_post_package` content type seed (in §3) already overrides this to 15 — see the updated INSERT below in §6.4.

### 6.2 Backend

- Whichever endpoint feeds the content-type list to Lovable should include `max_pinned_references` in the response.
- **Defense-in-depth:** the generate endpoint should enforce the cap server-side too. If the request body provides more pinned references than the content type allows, reject with a clear 422 (`error_code: 'TOO_MANY_PINNED_REFERENCES'`). A misbehaving frontend or direct API caller should not be able to bypass the limit.

### 6.3 Frontend (Lovable)

- **Content Type editor** — new numeric input "Max pinned references" (default 5, min 1, max 50). Admin-only edit. Help text: "How many existing content assets a strategist can pin as inspiration when generating with this content type. Most types should keep the default."
- **Generate Content modal** (the "Reference Content (optional, max 5)" dialog from the screenshot) — read `max_pinned_references` from the *currently selected* content type and update both the label text ("max N") and the multi-select limit dynamically. So when the strategist picks "Social Post Package," the modal shows "max 15" and accepts up to 15 pinned references.
- **No change** to the reference deliverables cap — keep that at 5 for now. Don't pre-emptively add a `max_pinned_deliverables` field.

### 6.4 Updated content type seed

The seed insert in §3 should include the cap override. Replace the seed `INSERT` for `content_types` with:

```sql
INSERT INTO content_types (
    contract_id, name, slug, description, is_active, sort_order,
    is_rag_eligible, max_pinned_references
)
VALUES (
    NULL,
    'Social Post Package',
    'social_post_package',
    'A monthly batch of social posts for a single platform — mixes posts about existing assets, recommendations for new assets, external link reuse, and text-only posts.',
    true,
    50,
    false,  -- DERIVATIVE OUTPUT — exclude from RAG
    15      -- raised cap for richer cross-content packages
);
```

---

## 7. Acceptance checklist

**RAG eligibility:**
- [ ] `is_rag_eligible` column added to `content_types` (default `true`).
- [ ] Backend ingestion gate in `engine.ts` respects the flag — non-eligible types skip embedding.
- [ ] Frontend content-type editor exposes the toggle (admin-only edit) with help text.
- [ ] `social_post_package` content type seeded with `is_rag_eligible = false`.
- [ ] No chunks written to `compass_knowledge` after generating a package (verified by query).
- [ ] Backfill removed any pre-existing derivative content from `compass_knowledge`.

**Max pinned references:**
- [ ] `max_pinned_references` column added to `content_types` (default `5`).
- [ ] Content-type API response includes the field.
- [ ] Backend generate endpoint enforces the cap and returns 422 with `error_code: 'TOO_MANY_PINNED_REFERENCES'` if violated.
- [ ] Content-type editor shows a numeric input (admin-only) for the cap.
- [ ] Generate Content modal reads the cap from the selected content type and updates both label and multi-select limit dynamically.
- [ ] Selecting "Social Post Package" in the modal shows "max 15" and allows up to 15 pinned references.
- [ ] Selecting any other content type still shows "max 5."

**Prompt sequence + generation:**
- [ ] Standard Social Post Package prompt sequence seeded.
- [ ] Sequence appears in the Global Prompts tab automatically.
- [ ] Generation produces a markdown package with N posts, each declaring exactly one asset-note type.
- [ ] Asset-note types are correctly varied across the package (not all the same kind).
- [ ] Brand voice is reflected in the post copy.
- [ ] Strategist can edit, regenerate, and archive the package like any other content asset.

---

## 8. Out of scope (intentionally)

- Per-post status / scheduling / publish tracking. The package is a planning doc.
- Hand-off pipeline to Creative Ops for "Recommended new asset" posts. Once Creative Ops exists, we can wire it. For now, the strategist sources recommended assets manually.
- Multi-platform packages. One platform per generation; run twice if needed.
- Hard mix ratios ("must be 3 referencing existing, 2 recommending new"). Let the LLM decide based on the available library and theme.

---

**End of spec.**
