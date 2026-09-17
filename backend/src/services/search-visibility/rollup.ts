/**
 * Search Visibility — rollup refresh
 *
 * Recomputes `content_query_current` for a contract at the end of each run.
 *
 * This is a table rather than a view on purpose: the trends UI renders ~1,000
 * rows with 7/30/90-day deltas and a sparkline each, and computing that live
 * over the snapshot history on every page load is the one real performance
 * trap in this module.
 *
 * Spec: docs/spec-search-visibility-tracking.md §3, §7
 */

import { select, upsert } from '../../utils/edge-functions.js';
import type { RankSnapshot, GscSnapshot, TrackedQuery, Trend } from '../../types/search-visibility.js';

/**
 * Movement smaller than this is SERP jitter, not a result. Without a deadband
 * every ordinary wobble gets reported to a client as a trend.
 */
const TREND_DEADBAND = 2;

/** Points kept in the sparkline column, matching the table's inline chart. */
const SPARKLINE_POINTS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

interface RollupResult {
  rows_written: number;
}

/**
 * Delta convention, used everywhere downstream:
 *
 *   positive = improvement (position got smaller / closer to #1)
 *   negative = decline
 *
 * So delta = previous - current. Position 20 -> 10 is +10, a gain. Getting this
 * backwards inverts every arrow and every "top movers" list in the UI, so it is
 * defined once, here.
 */
function computeDelta(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null) return null;
  return previous - current;
}

/**
 * The position as of (at or before) a point in time.
 *
 * Snapshots must be sorted newest-first. Returns null when the query wasn't
 * being tracked yet, which is different from "was tracked and not ranking" —
 * that case is a snapshot row whose position is null.
 */
function positionAsOf(snapshots: RankSnapshot[], cutoff: number): number | null {
  for (const snapshot of snapshots) {
    if (new Date(snapshot.captured_at).getTime() <= cutoff) {
      return snapshot.position;
    }
  }
  return null;
}

function classifyTrend(current: number | null, delta30d: number | null): Trend {
  if (current === null) return 'unranked';
  if (delta30d === null) return 'stable';
  if (delta30d > TREND_DEADBAND) return 'climbing';
  if (delta30d < -TREND_DEADBAND) return 'declining';
  return 'stable';
}

/**
 * Refresh the rollup for every tracked query on a contract.
 */
export async function refreshRollup(contractId: string): Promise<RollupResult> {
  const queries = await select<TrackedQuery[]>('content_tracked_queries', {
    select: 'query_id, contract_id, query_type, status',
    filters: { contract_id: contractId, status: 'tracking' },
  });

  if (!queries || queries.length === 0) {
    return { rows_written: 0 };
  }

  const queryIds = queries.map((q) => q.query_id);
  const now = Date.now();
  const ninetyDaysAgo = new Date(now - 90 * DAY_MS).toISOString();
  const twentyEightDaysAgo = new Date(now - 28 * DAY_MS).toISOString().slice(0, 10);

  // Snapshots for the whole contract in one read, then grouped in memory. At
  // realistic volumes (a few hundred keywords x ~13 weekly snapshots) this is
  // far cheaper than a query per tracked keyword.
  const rankSnapshots = await select<RankSnapshot[]>('content_rank_snapshots', {
    select: 'query_id, position, captured_at',
    filters: {
      query_id: { in: queryIds },
      captured_at: { gte: ninetyDaysAgo },
    },
    order: [{ column: 'captured_at', ascending: false }],
  });

  const gscRows = await select<GscSnapshot[]>('content_gsc_snapshots', {
    select: 'query_id, clicks, impressions, avg_position, date',
    filters: {
      query_id: { in: queryIds },
      date: { gte: twentyEightDaysAgo },
    },
  });

  const snapshotsByQuery = new Map<string, RankSnapshot[]>();
  for (const snapshot of rankSnapshots ?? []) {
    const list = snapshotsByQuery.get(snapshot.query_id);
    if (list) list.push(snapshot);
    else snapshotsByQuery.set(snapshot.query_id, [snapshot]);
  }

  const gscByQuery = new Map<string, GscSnapshot[]>();
  for (const row of gscRows ?? []) {
    if (!row.query_id) continue;
    const list = gscByQuery.get(row.query_id);
    if (list) list.push(row);
    else gscByQuery.set(row.query_id, [row]);
  }

  const rows = queries.map((query) => {
    const snapshots = snapshotsByQuery.get(query.query_id) ?? [];
    const latest = snapshots[0];

    const current = latest ? latest.position : null;
    const at7d = positionAsOf(snapshots, now - 7 * DAY_MS);
    const at30d = positionAsOf(snapshots, now - 30 * DAY_MS);
    const at90d = positionAsOf(snapshots, now - 90 * DAY_MS);

    const delta30d = computeDelta(at30d, current);

    const ranked = snapshots
      .map((s) => s.position)
      .filter((p): p is number => p !== null && p !== undefined);

    const gsc = gscByQuery.get(query.query_id) ?? [];
    const clicks28d = gsc.reduce((sum, r) => sum + (r.clicks ?? 0), 0);
    const impressions28d = gsc.reduce((sum, r) => sum + (r.impressions ?? 0), 0);

    // Weighted by impressions, not a plain mean of the daily averages. An
    // unweighted mean lets a single-impression day count as much as a
    // thousand-impression one and quietly skews the number.
    const weightedPositionSum = gsc.reduce(
      (sum, r) => sum + (r.avg_position ?? 0) * (r.impressions ?? 0),
      0
    );

    return {
      query_id: query.query_id,
      contract_id: contractId,
      current_position: current,
      position_7d_ago: at7d,
      position_30d_ago: at30d,
      position_90d_ago: at90d,
      position_delta_7d: computeDelta(at7d, current),
      position_delta_30d: delta30d,
      position_delta_90d: computeDelta(at90d, current),
      best_position_ever: ranked.length > 0 ? Math.min(...ranked) : null,
      trend: classifyTrend(current, delta30d),
      last_checked_at: latest ? latest.captured_at : null,
      clicks_28d: clicks28d,
      impressions_28d: impressions28d,
      ctr_28d: impressions28d > 0 ? clicks28d / impressions28d : null,
      gsc_avg_position: impressions28d > 0 ? weightedPositionSum / impressions28d : null,
      mention_rate_avg: null, // Phase 4
      sparkline: snapshots
        .slice(0, SPARKLINE_POINTS)
        .reverse()
        .map((s) => ({ t: s.captured_at, p: s.position })),
      updated_at: new Date().toISOString(),
    };
  });

  // Chunked so a large contract doesn't build one oversized proxy payload.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await upsert('content_query_current', rows.slice(i, i + CHUNK), {
      onConflict: 'query_id',
    });
  }

  return { rows_written: rows.length };
}
