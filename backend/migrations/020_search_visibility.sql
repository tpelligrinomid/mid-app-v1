-- Migration 020: Search Visibility Tracking
-- Keyword + prompt tracking with history, per contract.
-- Spec: docs/spec-search-visibility-tracking.md
--
-- Idempotent (IF NOT EXISTS / guarded policy creation) so it's safe to apply via
-- either this repo's deploy flow or Lovable's Supabase migration flow.
--
-- Tables created here:
--   content_tracked_queries          the curated target list (keywords + prompts)
--   content_rank_snapshots           DataForSEO SERP positions over time
--   content_gsc_snapshots            Search Console metrics by query and date
--   content_ai_visibility_snapshots  aggregated prompt results (Phase 4 writes)
--   content_ai_response_samples      raw LLM responses (Phase 4 writes)
--   content_query_discoveries        GSC triage inbox
--   content_tracking_config          per-contract settings
--   content_tracking_runs            collection run log
--   content_query_current            rollup table the trends UI reads
--
-- Phase 4 tables are created now so the prompt work needs no further migration.

-- ============================================================================
-- 1. content_tracked_queries — the target list
-- ============================================================================
-- One row per tracked keyword or prompt. This is the reporting spine: movement
-- is always measured against this list, never against whatever GSC surfaced.

CREATE TABLE IF NOT EXISTS content_tracked_queries (
  query_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid NOT NULL REFERENCES contracts(contract_id),
  query_type       text NOT NULL DEFAULT 'keyword',
  query_text       text NOT NULL,
  query_normalized text NOT NULL,
  asset_id         uuid REFERENCES content_assets(asset_id),
  priority         text DEFAULT 'medium',
  status           text NOT NULL DEFAULT 'tracking',
  source           text NOT NULL DEFAULT 'manual',
  cadence          text,
  location_code    integer,
  language_code    text,
  tags             text[],
  next_run_at      timestamptz DEFAULT now(),
  added_at         timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_query_type_valid') THEN
    ALTER TABLE content_tracked_queries ADD CONSTRAINT tracked_query_type_valid
      CHECK (query_type IN ('keyword', 'prompt'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_query_status_valid') THEN
    ALTER TABLE content_tracked_queries ADD CONSTRAINT tracked_query_status_valid
      CHECK (status IN ('tracking', 'paused', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_query_source_valid') THEN
    ALTER TABLE content_tracked_queries ADD CONSTRAINT tracked_query_source_valid
      CHECK (source IN ('manual', 'gsc_discovery', 'dfs_gap', 'competitor_gap', 'dfs_suggestion'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_query_cadence_valid') THEN
    ALTER TABLE content_tracked_queries ADD CONSTRAINT tracked_query_cadence_valid
      CHECK (cadence IS NULL OR cadence IN ('weekly', 'monthly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_query_priority_valid') THEN
    ALTER TABLE content_tracked_queries ADD CONSTRAINT tracked_query_priority_valid
      CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low'));
  END IF;
END $$;

-- location_code is part of identity: the same keyword tracked in two locations is
-- two rows. COALESCE keeps the constraint usable while location is optional.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_queries_unique
  ON content_tracked_queries (contract_id, query_type, query_normalized, COALESCE(location_code, -1));

CREATE INDEX IF NOT EXISTS idx_tracked_queries_contract_status
  ON content_tracked_queries (contract_id, status);

CREATE INDEX IF NOT EXISTS idx_tracked_queries_due
  ON content_tracked_queries (next_run_at)
  WHERE status = 'tracking';

CREATE INDEX IF NOT EXISTS idx_tracked_queries_normalized
  ON content_tracked_queries (contract_id, query_normalized);

CREATE INDEX IF NOT EXISTS idx_tracked_queries_asset
  ON content_tracked_queries (asset_id);

-- ============================================================================
-- 2. content_rank_snapshots — DataForSEO SERP positions
-- ============================================================================
-- position NULL means "checked, not ranking in the top 100" — that is real data.
-- A failed check writes NO ROW AT ALL, so a gap means "not checked". Never
-- conflate the two: doing so puts a cliff in the trend chart that never happened.

CREATE TABLE IF NOT EXISTS content_rank_snapshots (
  snapshot_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id       uuid NOT NULL REFERENCES content_tracked_queries(query_id) ON DELETE CASCADE,
  position       integer,
  ranking_url    text,
  serp_features  text[],
  in_ai_overview boolean DEFAULT false,
  search_volume  integer,
  difficulty     integer,
  volume_method  text,
  captured_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_snapshots_unique
  ON content_rank_snapshots (query_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_query_time
  ON content_rank_snapshots (query_id, captured_at DESC);

-- ============================================================================
-- 3. content_gsc_snapshots — Search Console, by query and date
-- ============================================================================
-- Separate from rank snapshots on purpose. Different grain (daily, not per-run),
-- different revision semantics (Google restates recent days), and it holds rows
-- for queries that are not tracked — that is what feeds discovery.
--
-- avg_position is numeric, never integer: GSC reports a weighted decimal.

CREATE TABLE IF NOT EXISTS content_gsc_snapshots (
  gsc_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id      uuid NOT NULL REFERENCES contracts(contract_id),
  query_id         uuid REFERENCES content_tracked_queries(query_id) ON DELETE SET NULL,
  query_normalized text NOT NULL,
  query_text       text NOT NULL,
  date             date NOT NULL,
  clicks           integer NOT NULL DEFAULT 0,
  impressions      integer NOT NULL DEFAULT 0,
  ctr              numeric,
  avg_position     numeric,
  top_url          text,
  ingested_at      timestamptz NOT NULL DEFAULT now()
);

-- Upsert target for the trailing re-pull window.
CREATE UNIQUE INDEX IF NOT EXISTS idx_gsc_snapshots_unique
  ON content_gsc_snapshots (contract_id, query_normalized, date);

CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_contract_date
  ON content_gsc_snapshots (contract_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_gsc_snapshots_query_date
  ON content_gsc_snapshots (query_id, date DESC);

-- ============================================================================
-- 4. content_ai_visibility_snapshots — aggregated prompt results (Phase 4)
-- ============================================================================
-- method distinguishes the two collection routes, which produce DIFFERENT
-- measurements and must never be averaged or drawn as one series:
--   sampled     — N responses we generated; metric is mention_rate
--   mentions_db — DataForSEO's crawl database; metric is mention_count
-- mention_rate is a rate out of a known N. mention_count is an occurrence count
-- out of an unknown one. They share no unit.

CREATE TABLE IF NOT EXISTS content_ai_visibility_snapshots (
  snapshot_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id             uuid NOT NULL REFERENCES content_tracked_queries(query_id) ON DELETE CASCADE,
  method               text NOT NULL DEFAULT 'sampled',
  engine               text NOT NULL,
  samples_taken        integer,
  samples_mentioned    integer,
  mention_rate         numeric,
  mention_count        integer,
  avg_mention_position numeric,
  cited                boolean DEFAULT false,
  citation_domains     jsonb,
  competitor_mentions  jsonb,
  captured_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_visibility_method_valid') THEN
    ALTER TABLE content_ai_visibility_snapshots ADD CONSTRAINT ai_visibility_method_valid
      CHECK (method IN ('sampled', 'mentions_db'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_visibility_unique
  ON content_ai_visibility_snapshots (query_id, method, engine, captured_at);

CREATE INDEX IF NOT EXISTS idx_ai_visibility_query_time
  ON content_ai_visibility_snapshots (query_id, method, captured_at DESC);

-- ============================================================================
-- 5. content_ai_response_samples — raw LLM responses (Phase 4)
-- ============================================================================
-- The verbatim text is the most persuasive artifact in the whole report and
-- cannot be reconstructed from aggregates. Retained ~90 days, pruned by cron.

CREATE TABLE IF NOT EXISTS content_ai_response_samples (
  sample_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES content_ai_visibility_snapshots(snapshot_id) ON DELETE CASCADE,
  sample_index    integer NOT NULL,
  response_text   text,
  citations       jsonb,
  brand_mentioned boolean DEFAULT false,
  matched_span    text,
  captured_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_samples_snapshot
  ON content_ai_response_samples (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_ai_samples_captured
  ON content_ai_response_samples (captured_at);

-- ============================================================================
-- 6. content_query_discoveries — the GSC triage inbox
-- ============================================================================
-- Queries earning impressions that are NOT on the target list. A strategist
-- promotes, ignores, or leaves each one. Discovery never auto-promotes: if it
-- did, the denominator behind "% of targets in the top 10" would move every
-- week and list churn would be indistinguishable from performance.

CREATE TABLE IF NOT EXISTS content_query_discoveries (
  discovery_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       uuid NOT NULL REFERENCES contracts(contract_id),
  query_normalized  text NOT NULL,
  query_text        text NOT NULL,
  impressions_28d   integer NOT NULL DEFAULT 0,
  clicks_28d        integer NOT NULL DEFAULT 0,
  avg_position      numeric,
  opportunity_score numeric,
  status            text NOT NULL DEFAULT 'pending',
  promoted_query_id uuid REFERENCES content_tracked_queries(query_id) ON DELETE SET NULL,
  reviewed_by       uuid REFERENCES users(user_id),
  reviewed_at       timestamptz,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discovery_status_valid') THEN
    ALTER TABLE content_query_discoveries ADD CONSTRAINT discovery_status_valid
      CHECK (status IN ('pending', 'promoted', 'ignored'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_discoveries_unique
  ON content_query_discoveries (contract_id, query_normalized);

CREATE INDEX IF NOT EXISTS idx_discoveries_triage
  ON content_query_discoveries (contract_id, status, opportunity_score DESC);

-- ============================================================================
-- 7. content_tracking_config — per-contract settings
-- ============================================================================
-- No GSC token column: access is via a single shared MiD service account that
-- clients add as a user on their property. gsc_property holds the exact siteUrl
-- returned by sites.list — never hand-typed, because a wrong property yields a
-- thin dataset that reads as poor SEO performance rather than misconfiguration.

CREATE TABLE IF NOT EXISTS content_tracking_config (
  config_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id            uuid NOT NULL UNIQUE REFERENCES contracts(contract_id),
  domain                 text,
  competitor_domains     text[],
  brand_terms            text[],
  keyword_cadence        text NOT NULL DEFAULT 'weekly',
  prompt_cadence         text NOT NULL DEFAULT 'monthly',
  prompt_samples_per_run integer NOT NULL DEFAULT 5,
  prompt_engines         text[] DEFAULT ARRAY['chatgpt', 'claude', 'gemini', 'perplexity'],
  location_code          integer DEFAULT 2840,
  language_code          text DEFAULT 'en',
  gsc_property           text,
  gsc_property_type      text,
  gsc_permission_level   text,
  gsc_access_verified_at timestamptz,
  enabled                boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_config_keyword_cadence_valid') THEN
    ALTER TABLE content_tracking_config ADD CONSTRAINT tracking_config_keyword_cadence_valid
      CHECK (keyword_cadence IN ('weekly', 'monthly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_config_prompt_cadence_valid') THEN
    ALTER TABLE content_tracking_config ADD CONSTRAINT tracking_config_prompt_cadence_valid
      CHECK (prompt_cadence IN ('weekly', 'monthly'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_config_property_type_valid') THEN
    ALTER TABLE content_tracking_config ADD CONSTRAINT tracking_config_property_type_valid
      CHECK (gsc_property_type IS NULL OR gsc_property_type IN ('domain', 'url_prefix'));
  END IF;

  -- Below 3 samples a rate is not meaningful: 1-of-1 rendered as 100% is worse
  -- than showing nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracking_config_samples_valid') THEN
    ALTER TABLE content_tracking_config ADD CONSTRAINT tracking_config_samples_valid
      CHECK (prompt_samples_per_run >= 3 AND prompt_samples_per_run <= 20);
  END IF;
END $$;

-- ============================================================================
-- 8. content_tracking_runs — collection run log
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_tracking_runs (
  run_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       uuid REFERENCES contracts(contract_id),
  run_type          text NOT NULL,
  queries_processed integer NOT NULL DEFAULT 0,
  snapshots_written integer NOT NULL DEFAULT 0,
  discoveries_found integer NOT NULL DEFAULT 0,
  api_calls         integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'completed',
  error_detail      text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tracking_runs_contract
  ON content_tracking_runs (contract_id, started_at DESC);

-- ============================================================================
-- 9. content_query_current — the rollup
-- ============================================================================
-- A real table, refreshed at the end of each run, not a view. The trends table
-- renders ~1,000 rows with 7/30/90-day deltas; computing that live over the
-- snapshot history on every page load is the one real performance trap here.

CREATE TABLE IF NOT EXISTS content_query_current (
  query_id            uuid PRIMARY KEY REFERENCES content_tracked_queries(query_id) ON DELETE CASCADE,
  contract_id         uuid NOT NULL REFERENCES contracts(contract_id),
  current_position    integer,
  position_7d_ago     integer,
  position_30d_ago    integer,
  position_90d_ago    integer,
  position_delta_7d   integer,
  position_delta_30d  integer,
  position_delta_90d  integer,
  best_position_ever  integer,
  trend               text,
  last_checked_at     timestamptz,
  clicks_28d          integer,
  impressions_28d     integer,
  ctr_28d             numeric,
  gsc_avg_position    numeric,
  mention_rate_avg    numeric,
  sparkline           jsonb,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'query_current_trend_valid') THEN
    ALTER TABLE content_query_current ADD CONSTRAINT query_current_trend_valid
      CHECK (trend IS NULL OR trend IN ('climbing', 'declining', 'stable', 'unranked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_query_current_contract
  ON content_query_current (contract_id);

CREATE INDEX IF NOT EXISTS idx_query_current_trend
  ON content_query_current (contract_id, trend);

CREATE INDEX IF NOT EXISTS idx_query_current_position
  ON content_query_current (contract_id, current_position);

-- ============================================================================
-- Row Level Security
-- ============================================================================
-- Two policy families per table:
--   service_role  — the backend collector and proxy, unrestricted
--   authenticated — admins and team members see everything; clients see only
--                   contracts granted through user_contract_access
--
-- Writes are restricted to admin/team_member: clients never edit a target list.
-- Child tables (snapshots, samples) inherit scope by joining to their parent.

DO $$
DECLARE
  t text;
  contract_scoped text[] := ARRAY[
    'content_tracked_queries',
    'content_gsc_snapshots',
    'content_query_discoveries',
    'content_tracking_config',
    'content_tracking_runs',
    'content_query_current'
  ];
  query_scoped text[] := ARRAY[
    'content_rank_snapshots',
    'content_ai_visibility_snapshots'
  ];
BEGIN
  -- Enable RLS everywhere
  FOREACH t IN ARRAY contract_scoped || query_scoped || ARRAY['content_ai_response_samples']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = format('Service role full access on %s', t)
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        format('Service role full access on %s', t), t
      );
    END IF;
  END LOOP;

  -- Contract-scoped read + write
  FOREACH t IN ARRAY contract_scoped
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = format('Authenticated read on %s', t)
    ) THEN
      EXECUTE format($f$
        CREATE POLICY %I ON %I FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1 FROM users u
          WHERE u.auth_id = auth.uid()
            AND u.status = 'active'
            AND (
              u.role IN ('admin', 'team_member')
              OR EXISTS (
                SELECT 1 FROM user_contract_access uca
                WHERE uca.user_id = u.user_id
                  AND uca.contract_id = %I.contract_id
              )
            )
        ))
      $f$, format('Authenticated read on %s', t), t, t);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = format('Staff write on %s', t)
    ) THEN
      EXECUTE format($f$
        CREATE POLICY %I ON %I FOR ALL TO authenticated
        USING (EXISTS (
          SELECT 1 FROM users u
          WHERE u.auth_id = auth.uid()
            AND u.status = 'active'
            AND u.role IN ('admin', 'team_member')
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM users u
          WHERE u.auth_id = auth.uid()
            AND u.status = 'active'
            AND u.role IN ('admin', 'team_member')
        ))
      $f$, format('Staff write on %s', t), t);
    END IF;
  END LOOP;

  -- Query-scoped: reachable if the parent tracked query is reachable
  FOREACH t IN ARRAY query_scoped
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = t AND policyname = format('Authenticated read on %s', t)
    ) THEN
      EXECUTE format($f$
        CREATE POLICY %I ON %I FOR SELECT TO authenticated
        USING (EXISTS (
          SELECT 1 FROM content_tracked_queries q
          JOIN users u ON u.auth_id = auth.uid() AND u.status = 'active'
          WHERE q.query_id = %I.query_id
            AND (
              u.role IN ('admin', 'team_member')
              OR EXISTS (
                SELECT 1 FROM user_contract_access uca
                WHERE uca.user_id = u.user_id
                  AND uca.contract_id = q.contract_id
              )
            )
        ))
      $f$, format('Authenticated read on %s', t), t, t);
    END IF;
  END LOOP;

  -- Raw samples: reachable through their snapshot
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'content_ai_response_samples'
      AND policyname = 'Authenticated read on content_ai_response_samples'
  ) THEN
    CREATE POLICY "Authenticated read on content_ai_response_samples"
      ON content_ai_response_samples FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM content_ai_visibility_snapshots s
        JOIN content_tracked_queries q ON q.query_id = s.query_id
        JOIN users u ON u.auth_id = auth.uid() AND u.status = 'active'
        WHERE s.snapshot_id = content_ai_response_samples.snapshot_id
          AND (
            u.role IN ('admin', 'team_member')
            OR EXISTS (
              SELECT 1 FROM user_contract_access uca
              WHERE uca.user_id = u.user_id
                AND uca.contract_id = q.contract_id
            )
          )
      ));
  END IF;
END $$;
