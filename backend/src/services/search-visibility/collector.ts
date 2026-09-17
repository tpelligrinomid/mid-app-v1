/**
 * Search Visibility — collection
 *
 * Runs daily and processes whatever is due. Cadence lives on the data
 * (`next_run_at` per query, resolved against per-contract config) rather than
 * in cron configuration, so changing a contract from weekly to monthly — or
 * promoting twenty priority keywords to weekly — is a settings change, not a
 * deploy.
 *
 * Order per contract:
 *   1. GSC pull        — always; daily, free
 *   2. Rank checks     — keyword queries where next_run_at <= now()
 *   3. Discovery       — recompute the triage inbox from trailing 28d GSC
 *   4. Rollup          — refresh content_query_current
 *   5. Log             — content_tracking_runs
 *
 * Spec: docs/spec-search-visibility-tracking.md §4
 */

import { select, insert, update, upsert } from '../../utils/edge-functions.js';
import { fetchRankBatch } from '../master-marketer/client.js';
import {
  fetchSearchAnalytics,
  isoDate,
  GscAccessError,
  isConfigured as gscConfigured,
} from './gsc-client.js';
import { normalizeQuery } from './normalize.js';
import { refreshRollup } from './rollup.js';
import type { TrackedQuery, TrackingConfig, Cadence, QueryDiscovery } from '../../types/search-visibility.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Search Console data for the last couple of days is incomplete, and Google
 * restates it afterwards. Everything here reads up to today minus this many
 * days, and re-reads a trailing window rather than trusting a single write.
 */
const GSC_LAG_DAYS = 3;

/** Re-pulled and upserted every run, because Google revises recent days. */
const GSC_TRAILING_WINDOW_DAYS = 7;

/**
 * First pull for a contract reaches back this far. Unlike rank history — which
 * is gone forever if it wasn't collected — GSC history already exists on
 * Google's side and can be backfilled, so there is no reason to start at zero.
 */
const GSC_BACKFILL_DAYS = 180;

/** Keywords per Master Marketer rank-batch call. */
const RANK_BATCH_SIZE = 100;

/**
 * Discovery only considers queries in this position band. Above it the site
 * already wins; below it the gap is too large for a rank improvement to convert.
 */
const DISCOVERY_MIN_POSITION = 5;
const DISCOVERY_MAX_POSITION = 25;

export interface ContractRunResult {
  contract_id: string;
  gsc_rows: number;
  rank_queries_checked: number;
  snapshots_written: number;
  discoveries_found: number;
  rollup_rows: number;
  api_calls: number;
  status: 'completed' | 'partial' | 'failed';
  errors: string[];
}

// ============================================================================
// Cadence
// ============================================================================

function resolveCadence(query: TrackedQuery, config: TrackingConfig): Cadence {
  if (query.cadence) return query.cadence;
  return query.query_type === 'prompt' ? config.prompt_cadence : config.keyword_cadence;
}

function advanceFrom(cadence: Cadence): string {
  const next = new Date();
  if (cadence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString();
}

// ============================================================================
// 1. GSC pull
// ============================================================================

async function pullGsc(
  config: TrackingConfig,
  normalizedToQueryId: Map<string, string>
): Promise<{ rows: number; calls: number }> {
  if (!config.gsc_property) return { rows: 0, calls: 0 };

  const end = new Date(Date.now() - GSC_LAG_DAYS * DAY_MS);

  // Has this contract been pulled before? If not, backfill.
  const existing = await select<Array<{ date: string }>>('content_gsc_snapshots', {
    select: 'date',
    filters: { contract_id: config.contract_id },
    order: [{ column: 'date', ascending: false }],
    limit: 1,
  });

  const hasHistory = Array.isArray(existing) && existing.length > 0;
  const start = new Date(
    end.getTime() - (hasHistory ? GSC_TRAILING_WINDOW_DAYS : GSC_BACKFILL_DAYS) * DAY_MS
  );

  const rows = await fetchSearchAnalytics(config.gsc_property, isoDate(start), isoDate(end));

  if (rows.length === 0) return { rows: 0, calls: 1 };

  const payload = rows.map((row) => {
    const normalized = normalizeQuery(row.query);
    return {
      contract_id: config.contract_id,
      query_id: normalizedToQueryId.get(normalized) ?? null,
      query_normalized: normalized,
      query_text: row.query,
      date: row.date,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      avg_position: row.position,
      ingested_at: new Date().toISOString(),
    };
  });

  // Upsert, never plain insert: the trailing window deliberately re-reads days
  // already stored so Google's restatements land on top of the earlier values.
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    await upsert('content_gsc_snapshots', payload.slice(i, i + CHUNK), {
      onConflict: 'contract_id,query_normalized,date',
    });
  }

  return { rows: payload.length, calls: 1 };
}

// ============================================================================
// 2. Rank checks
// ============================================================================

async function runRankChecks(
  config: TrackingConfig,
  dueQueries: TrackedQuery[]
): Promise<{ checked: number; written: number; calls: number; errors: string[] }> {
  const errors: string[] = [];

  if (dueQueries.length === 0) return { checked: 0, written: 0, calls: 0, errors };

  if (!config.domain) {
    return {
      checked: 0,
      written: 0,
      calls: 0,
      errors: ['No domain configured; rank checks skipped'],
    };
  }

  let written = 0;
  let calls = 0;
  const capturedAt = new Date().toISOString();

  for (let i = 0; i < dueQueries.length; i += RANK_BATCH_SIZE) {
    const batch = dueQueries.slice(i, i + RANK_BATCH_SIZE);

    try {
      const response = await fetchRankBatch({
        domain: config.domain,
        keywords: batch.map((q) => q.query_text),
        location_code: config.location_code ?? undefined,
        language_code: config.language_code ?? undefined,
      });
      calls++;

      const byNormalized = new Map(
        (response.results ?? []).map((r) => [normalizeQuery(r.keyword), r])
      );

      const snapshots: Record<string, unknown>[] = [];
      const succeeded: TrackedQuery[] = [];

      for (const query of batch) {
        const result = byNormalized.get(query.query_normalized);

        // A keyword absent from the response was NOT checked. Writing a null
        // position for it would be indistinguishable from "checked and not
        // ranking" and would put a cliff in the trend chart that never happened.
        if (!result) continue;

        snapshots.push({
          query_id: query.query_id,
          position: result.position ?? null,
          ranking_url: result.ranking_url ?? null,
          serp_features: result.serp_features ?? null,
          in_ai_overview: result.in_ai_overview ?? false,
          search_volume: result.search_volume ?? null,
          difficulty: result.difficulty ?? null,
          volume_method: result.volume_method ?? null,
          captured_at: capturedAt,
        });
        succeeded.push(query);
      }

      if (snapshots.length > 0) {
        await insert('content_rank_snapshots', snapshots);
        written += snapshots.length;
      }

      // Only queries that actually produced a snapshot get rescheduled. The
      // rest keep their past-due next_run_at and are retried tomorrow.
      //
      // Grouped by resolved cadence so this is one update per cadence rather
      // than one per keyword — the difference between 2 round-trips and 100.
      const byCadence = new Map<Cadence, string[]>();
      for (const query of succeeded) {
        const cadence = resolveCadence(query, config);
        const ids = byCadence.get(cadence);
        if (ids) ids.push(query.query_id);
        else byCadence.set(cadence, [query.query_id]);
      }

      for (const [cadence, ids] of byCadence) {
        await update(
          'content_tracked_queries',
          { next_run_at: advanceFrom(cadence), updated_at: capturedAt },
          { query_id: { in: ids } }
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Rank batch ${i / RANK_BATCH_SIZE + 1} failed: ${message}`);
      // Leave next_run_at untouched so the whole batch retries on the next run.
    }
  }

  return { checked: dueQueries.length, written, calls, errors };
}

// ============================================================================
// 3. Discovery
// ============================================================================

async function recomputeDiscovery(
  config: TrackingConfig,
  trackedNormalized: Set<string>
): Promise<number> {
  const since = isoDate(new Date(Date.now() - 28 * DAY_MS));

  const rows = await select<
    Array<{ query_normalized: string; query_text: string; clicks: number; impressions: number; avg_position: number | null }>
  >('content_gsc_snapshots', {
    select: 'query_normalized, query_text, clicks, impressions, avg_position',
    filters: { contract_id: config.contract_id, date: { gte: since } },
  });

  if (!rows || rows.length === 0) return 0;

  interface Agg {
    query_text: string;
    clicks: number;
    impressions: number;
    weightedPosition: number;
  }

  const aggregates = new Map<string, Agg>();

  for (const row of rows) {
    if (trackedNormalized.has(row.query_normalized)) continue;

    const existing = aggregates.get(row.query_normalized) ?? {
      query_text: row.query_text,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
    };

    existing.clicks += row.clicks ?? 0;
    existing.impressions += row.impressions ?? 0;
    existing.weightedPosition += (row.avg_position ?? 0) * (row.impressions ?? 0);
    aggregates.set(row.query_normalized, existing);
  }

  const candidates: Array<{
    query_normalized: string;
    query_text: string;
    impressions_28d: number;
    clicks_28d: number;
    avg_position: number;
    opportunity_score: number;
  }> = [];

  for (const [normalized, agg] of aggregates) {
    if (agg.impressions === 0) continue;

    const avgPosition = agg.weightedPosition / agg.impressions;
    if (avgPosition < DISCOVERY_MIN_POSITION || avgPosition > DISCOVERY_MAX_POSITION) continue;

    candidates.push({
      query_normalized: normalized,
      query_text: agg.query_text,
      impressions_28d: agg.impressions,
      clicks_28d: agg.clicks,
      avg_position: avgPosition,
      // Impressions are the opportunity; the position band above is the filter.
      opportunity_score: agg.impressions,
    });
  }

  if (candidates.length === 0) return 0;

  // Existing rows keep their triage decision. An ignored query must never
  // reappear in the queue — a strategist rejecting it once should be final —
  // so the prior status and review fields are carried through the upsert
  // rather than reset by it.
  const existing = await select<QueryDiscovery[]>('content_query_discoveries', {
    select: 'discovery_id, query_normalized, status, promoted_query_id, reviewed_by, reviewed_at, first_seen_at',
    filters: { contract_id: config.contract_id },
  });

  const existingByNormalized = new Map(
    (existing ?? []).map((d) => [d.query_normalized, d])
  );

  const now = new Date().toISOString();
  let newCount = 0;

  const discoveryRows = candidates.map((candidate) => {
    const prior = existingByNormalized.get(candidate.query_normalized);
    if (!prior) newCount++;

    return {
      contract_id: config.contract_id,
      ...candidate,
      status: prior?.status ?? 'pending',
      promoted_query_id: prior?.promoted_query_id ?? null,
      reviewed_by: prior?.reviewed_by ?? null,
      reviewed_at: prior?.reviewed_at ?? null,
      first_seen_at: prior?.first_seen_at ?? now,
      updated_at: now,
    };
  });

  const CHUNK = 500;
  for (let i = 0; i < discoveryRows.length; i += CHUNK) {
    await upsert('content_query_discoveries', discoveryRows.slice(i, i + CHUNK), {
      onConflict: 'contract_id,query_normalized',
    });
  }

  return newCount;
}

// ============================================================================
// Orchestration
// ============================================================================

export async function runContract(contractId: string): Promise<ContractRunResult> {
  const startedAt = new Date().toISOString();
  const result: ContractRunResult = {
    contract_id: contractId,
    gsc_rows: 0,
    rank_queries_checked: 0,
    snapshots_written: 0,
    discoveries_found: 0,
    rollup_rows: 0,
    api_calls: 0,
    status: 'completed',
    errors: [],
  };

  const configs = await select<TrackingConfig[]>('content_tracking_config', {
    filters: { contract_id: contractId },
    limit: 1,
  });

  const config = configs?.[0];
  if (!config) {
    result.status = 'failed';
    result.errors.push('No tracking config for contract');
    return result;
  }

  if (!config.enabled) {
    result.errors.push('Tracking disabled for contract');
    return result;
  }

  const queries = await select<TrackedQuery[]>('content_tracked_queries', {
    filters: { contract_id: contractId, status: 'tracking' },
  });

  const allQueries = queries ?? [];
  const normalizedToQueryId = new Map(allQueries.map((q) => [q.query_normalized, q.query_id]));
  const trackedNormalized = new Set(allQueries.map((q) => q.query_normalized));

  // --- 1. GSC ---------------------------------------------------------------
  if (config.gsc_property && gscConfigured()) {
    try {
      const gsc = await pullGsc(config, normalizedToQueryId);
      result.gsc_rows = gsc.rows;
      result.api_calls += gsc.calls;
    } catch (error) {
      result.status = 'partial';
      result.errors.push(
        error instanceof GscAccessError
          ? `GSC access lost for ${config.gsc_property}: ${error.message}`
          : `GSC pull failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // --- 2. Rank checks -------------------------------------------------------
  const now = Date.now();
  const dueKeywords = allQueries.filter(
    (q) =>
      q.query_type === 'keyword' &&
      (!q.next_run_at || new Date(q.next_run_at).getTime() <= now)
  );

  try {
    const ranks = await runRankChecks(config, dueKeywords);
    result.rank_queries_checked = ranks.checked;
    result.snapshots_written = ranks.written;
    result.api_calls += ranks.calls;
    if (ranks.errors.length > 0) {
      result.status = 'partial';
      result.errors.push(...ranks.errors);
    }
  } catch (error) {
    result.status = 'partial';
    result.errors.push(`Rank checks failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --- 3. Discovery ---------------------------------------------------------
  try {
    result.discoveries_found = await recomputeDiscovery(config, trackedNormalized);
  } catch (error) {
    result.status = 'partial';
    result.errors.push(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --- 4. Rollup ------------------------------------------------------------
  try {
    const rollup = await refreshRollup(contractId);
    result.rollup_rows = rollup.rows_written;
  } catch (error) {
    result.status = 'partial';
    result.errors.push(`Rollup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // --- 5. Log ---------------------------------------------------------------
  await insert('content_tracking_runs', {
    contract_id: contractId,
    run_type: 'full',
    queries_processed: result.rank_queries_checked,
    snapshots_written: result.snapshots_written,
    discoveries_found: result.discoveries_found,
    api_calls: result.api_calls,
    status: result.status,
    error_detail: result.errors.length > 0 ? result.errors.join('; ').substring(0, 2000) : null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  });

  return result;
}

/**
 * Every enabled contract, in sequence.
 *
 * Sequential rather than parallel on purpose: this shares one Master Marketer
 * account and one Google service-account principal, and a burst across thirty
 * contracts is the one thing that would put either near a rate limit. The job
 * has all day.
 */
export async function runAllContracts(): Promise<ContractRunResult[]> {
  const configs = await select<TrackingConfig[]>('content_tracking_config', {
    select: 'contract_id',
    filters: { enabled: true },
  });

  const results: ContractRunResult[] = [];

  for (const config of configs ?? []) {
    try {
      results.push(await runContract(config.contract_id));
    } catch (error) {
      results.push({
        contract_id: config.contract_id,
        gsc_rows: 0,
        rank_queries_checked: 0,
        snapshots_written: 0,
        discoveries_found: 0,
        rollup_rows: 0,
        api_calls: 0,
        status: 'failed',
        errors: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  return results;
}
