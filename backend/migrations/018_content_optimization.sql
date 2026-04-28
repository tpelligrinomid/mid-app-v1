-- Migration 018: Content Optimization
-- Adds the schema additions for the Optimize action pattern + SEO enrichment.
-- Spec: docs/spec-content-optimization.md
--
-- Idempotent (uses IF NOT EXISTS) so it's safe to apply via either:
--   - this repo's migration runner on backend deploy, OR
--   - Lovable's Supabase migration flow ahead of the backend deploy.

-- ============================================================================
-- 1. content_prompt_sequences.purpose
-- ============================================================================
-- Distinguishes generate (creates from scratch) vs optimize (transforms existing).
-- All existing sequences default to 'generate' — no behavior change for shipped content.

ALTER TABLE content_prompt_sequences
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'generate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_sequence_purpose_valid'
  ) THEN
    ALTER TABLE content_prompt_sequences
      ADD CONSTRAINT prompt_sequence_purpose_valid
      CHECK (purpose IN ('generate', 'optimize'));
  END IF;
END $$;

-- ============================================================================
-- 2. content_assets — source / supersede links
-- ============================================================================
-- source_asset_id: set on assets created via Optimize, points to the input.
-- superseded_by_asset_id: set when this asset is replaced by an approved optimization.

ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS source_asset_id uuid REFERENCES content_assets(asset_id);

ALTER TABLE content_assets
  ADD COLUMN IF NOT EXISTS superseded_by_asset_id uuid REFERENCES content_assets(asset_id);

CREATE INDEX IF NOT EXISTS idx_content_assets_source
  ON content_assets(source_asset_id);

CREATE INDEX IF NOT EXISTS idx_content_assets_superseded_by
  ON content_assets(superseded_by_asset_id);

-- ============================================================================
-- 3. landing_page content type
-- ============================================================================
-- Required for SEO Optimize Landing Page sequence + future generate-new-landing-page work.

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
  true,
  5
)
ON CONFLICT (contract_id, slug) DO NOTHING;

-- ============================================================================
-- 4. seo_keyword_cache
-- ============================================================================
-- Caches Master Marketer's enrich-keyword responses to avoid re-fetching the same
-- keyword within TTL. Backend reads/writes; Lovable does not need to read this.

CREATE TABLE IF NOT EXISTS seo_keyword_cache (
  cache_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword     text NOT NULL,
  country     text NOT NULL DEFAULT 'us',
  payload     jsonb NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (keyword, country)
);

CREATE INDEX IF NOT EXISTS idx_seo_keyword_cache_lookup
  ON seo_keyword_cache(keyword, country, fetched_at);

-- RLS: this table is backend-internal. Service role only.
ALTER TABLE seo_keyword_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'seo_keyword_cache'
      AND policyname = 'Service role full access on seo_keyword_cache'
  ) THEN
    CREATE POLICY "Service role full access on seo_keyword_cache"
      ON seo_keyword_cache
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
