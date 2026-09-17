/**
 * Search Visibility Tracking — types
 *
 * Spec: docs/spec-search-visibility-tracking.md
 */

// ============================================================================
// Enums / value sets
// ============================================================================

export const QUERY_TYPE_VALUES = ['keyword', 'prompt'] as const;
export type QueryType = (typeof QUERY_TYPE_VALUES)[number];

export const QUERY_STATUS_VALUES = ['tracking', 'paused', 'archived'] as const;
export type QueryStatus = (typeof QUERY_STATUS_VALUES)[number];

export const QUERY_SOURCE_VALUES = [
  'manual',
  'gsc_discovery',
  'dfs_gap',
  'competitor_gap',
  'dfs_suggestion',
] as const;
export type QuerySource = (typeof QUERY_SOURCE_VALUES)[number];

export const CADENCE_VALUES = ['weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCE_VALUES)[number];

export const PRIORITY_VALUES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITY_VALUES)[number];

export const TREND_VALUES = ['climbing', 'declining', 'stable', 'unranked'] as const;
export type Trend = (typeof TREND_VALUES)[number];

export const DISCOVERY_STATUS_VALUES = ['pending', 'promoted', 'ignored'] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUS_VALUES)[number];

export const VISIBILITY_METHOD_VALUES = ['sampled', 'mentions_db'] as const;
export type VisibilityMethod = (typeof VISIBILITY_METHOD_VALUES)[number];

export const GSC_PROPERTY_TYPE_VALUES = ['domain', 'url_prefix'] as const;
export type GscPropertyType = (typeof GSC_PROPERTY_TYPE_VALUES)[number];

export const RUN_TYPE_VALUES = ['keywords', 'gsc', 'prompts', 'full'] as const;
export type RunType = (typeof RUN_TYPE_VALUES)[number];

// ============================================================================
// Entities
// ============================================================================

export interface TrackedQuery {
  query_id: string;
  contract_id: string;
  query_type: QueryType;
  query_text: string;
  query_normalized: string;
  asset_id: string | null;
  priority: Priority | null;
  status: QueryStatus;
  source: QuerySource;
  cadence: Cadence | null;
  location_code: number | null;
  language_code: string | null;
  tags: string[] | null;
  next_run_at: string | null;
  added_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RankSnapshot {
  snapshot_id: string;
  query_id: string;
  /** NULL means checked and not ranking in the top 100 — that is data, not a gap. */
  position: number | null;
  ranking_url: string | null;
  serp_features: string[] | null;
  in_ai_overview: boolean;
  search_volume: number | null;
  difficulty: number | null;
  volume_method: string | null;
  captured_at: string;
}

export interface GscSnapshot {
  gsc_id: string;
  contract_id: string;
  query_id: string | null;
  query_normalized: string;
  query_text: string;
  date: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  avg_position: number | null;
  top_url: string | null;
  ingested_at: string;
}

export interface QueryDiscovery {
  discovery_id: string;
  contract_id: string;
  query_normalized: string;
  query_text: string;
  impressions_28d: number;
  clicks_28d: number;
  avg_position: number | null;
  opportunity_score: number | null;
  status: DiscoveryStatus;
  promoted_query_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface TrackingConfig {
  config_id: string;
  contract_id: string;
  domain: string | null;
  competitor_domains: string[] | null;
  brand_terms: string[] | null;
  keyword_cadence: Cadence;
  prompt_cadence: Cadence;
  prompt_samples_per_run: number;
  prompt_engines: string[] | null;
  location_code: number | null;
  language_code: string | null;
  gsc_property: string | null;
  gsc_property_type: GscPropertyType | null;
  gsc_permission_level: string | null;
  gsc_access_verified_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrackingRun {
  run_id: string;
  contract_id: string | null;
  run_type: RunType;
  queries_processed: number;
  snapshots_written: number;
  discoveries_found: number;
  api_calls: number;
  status: 'completed' | 'partial' | 'failed';
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface QueryCurrent {
  query_id: string;
  contract_id: string;
  current_position: number | null;
  position_7d_ago: number | null;
  position_30d_ago: number | null;
  position_90d_ago: number | null;
  position_delta_7d: number | null;
  position_delta_30d: number | null;
  position_delta_90d: number | null;
  best_position_ever: number | null;
  trend: Trend | null;
  last_checked_at: string | null;
  clicks_28d: number | null;
  impressions_28d: number | null;
  ctr_28d: number | null;
  gsc_avg_position: number | null;
  mention_rate_avg: number | null;
  sparkline: Array<{ t: string; p: number | null }> | null;
  updated_at: string;
}

// ============================================================================
// DTOs
// ============================================================================

export interface CreateTrackedQueryDTO {
  contract_id: string;
  query_text: string;
  query_type?: QueryType;
  asset_id?: string | null;
  priority?: Priority;
  source?: QuerySource;
  cadence?: Cadence | null;
  location_code?: number | null;
  language_code?: string | null;
  tags?: string[];
}

export interface UpdateTrackedQueryDTO {
  query_text?: string;
  asset_id?: string | null;
  priority?: Priority;
  status?: QueryStatus;
  cadence?: Cadence | null;
  location_code?: number | null;
  language_code?: string | null;
  tags?: string[];
}

export interface BulkCreateTrackedQueriesDTO {
  contract_id: string;
  query_type?: QueryType;
  /** Newline- or comma-separated, or an array. Deduped against existing rows. */
  queries: string[] | string;
  priority?: Priority;
  cadence?: Cadence | null;
  tags?: string[];
  source?: QuerySource;
}

export interface UpdateTrackingConfigDTO {
  contract_id: string;
  domain?: string | null;
  competitor_domains?: string[];
  brand_terms?: string[];
  keyword_cadence?: Cadence;
  prompt_cadence?: Cadence;
  prompt_samples_per_run?: number;
  prompt_engines?: string[];
  location_code?: number | null;
  language_code?: string | null;
  enabled?: boolean;
}

// ============================================================================
// Guards
// ============================================================================

export function isValidQueryType(v: unknown): v is QueryType {
  return typeof v === 'string' && (QUERY_TYPE_VALUES as readonly string[]).includes(v);
}

export function isValidQueryStatus(v: unknown): v is QueryStatus {
  return typeof v === 'string' && (QUERY_STATUS_VALUES as readonly string[]).includes(v);
}

export function isValidQuerySource(v: unknown): v is QuerySource {
  return typeof v === 'string' && (QUERY_SOURCE_VALUES as readonly string[]).includes(v);
}

export function isValidCadence(v: unknown): v is Cadence {
  return typeof v === 'string' && (CADENCE_VALUES as readonly string[]).includes(v);
}

export function isValidPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITY_VALUES as readonly string[]).includes(v);
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateTrackedQueryInput(
  input: Partial<CreateTrackedQueryDTO & UpdateTrackedQueryDTO>,
  { requireText }: { requireText: boolean }
): ValidationResult {
  const errors: string[] = [];

  if (requireText) {
    if (!input.query_text || typeof input.query_text !== 'string' || !input.query_text.trim()) {
      errors.push('query_text is required');
    }
  } else if (input.query_text !== undefined) {
    if (typeof input.query_text !== 'string' || !input.query_text.trim()) {
      errors.push('query_text must be a non-empty string');
    }
  }

  if (input.query_text && input.query_text.length > 500) {
    errors.push('query_text must be 500 characters or fewer');
  }

  if (input.query_type !== undefined && !isValidQueryType(input.query_type)) {
    errors.push(`query_type must be one of: ${QUERY_TYPE_VALUES.join(', ')}`);
  }

  if (input.priority !== undefined && input.priority !== null && !isValidPriority(input.priority)) {
    errors.push(`priority must be one of: ${PRIORITY_VALUES.join(', ')}`);
  }

  if (input.source !== undefined && !isValidQuerySource(input.source)) {
    errors.push(`source must be one of: ${QUERY_SOURCE_VALUES.join(', ')}`);
  }

  if (input.cadence !== undefined && input.cadence !== null && !isValidCadence(input.cadence)) {
    errors.push(`cadence must be one of: ${CADENCE_VALUES.join(', ')}, or null to inherit`);
  }

  if ('status' in input && input.status !== undefined && !isValidQueryStatus(input.status)) {
    errors.push(`status must be one of: ${QUERY_STATUS_VALUES.join(', ')}`);
  }

  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    errors.push('tags must be an array of strings');
  }

  if (input.location_code !== undefined && input.location_code !== null) {
    if (!Number.isInteger(input.location_code)) {
      errors.push('location_code must be an integer');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateTrackingConfigInput(input: Partial<UpdateTrackingConfigDTO>): ValidationResult {
  const errors: string[] = [];

  if (input.keyword_cadence !== undefined && !isValidCadence(input.keyword_cadence)) {
    errors.push(`keyword_cadence must be one of: ${CADENCE_VALUES.join(', ')}`);
  }

  if (input.prompt_cadence !== undefined && !isValidCadence(input.prompt_cadence)) {
    errors.push(`prompt_cadence must be one of: ${CADENCE_VALUES.join(', ')}`);
  }

  if (input.prompt_samples_per_run !== undefined) {
    const n = input.prompt_samples_per_run;
    if (!Number.isInteger(n) || n < 3 || n > 20) {
      // Below 3, a rate is not meaningful — 1-of-1 shown as 100% is worse than nothing.
      errors.push('prompt_samples_per_run must be an integer between 3 and 20');
    }
  }

  for (const field of ['competitor_domains', 'brand_terms', 'prompt_engines'] as const) {
    if (input[field] !== undefined && !Array.isArray(input[field])) {
      errors.push(`${field} must be an array of strings`);
    }
  }

  return { valid: errors.length === 0, errors };
}
