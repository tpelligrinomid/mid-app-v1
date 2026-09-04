/**
 * Deliverable Recovery
 *
 * Master Marketer POSTs generated deliverables back to our webhook. When that
 * POST fails, the job still completed successfully on MM's side and the output
 * is retrievable by Trigger.dev run ID — but the deliverable sits in Compass
 * looking like it silently never finished.
 *
 * Observed cause: Render's WAF rejecting the callback at the edge with a 403
 * before it reaches Express (so nothing appears in our logs). Any other
 * delivery failure — a restart mid-callback, a network blip, MM redeploying —
 * strands a deliverable the same way.
 *
 * This module owns pulling that output back. It backs both the manual recovery
 * endpoint and the cron sweep, so the two can't drift apart.
 */

import { select } from '../../utils/edge-functions.js';
import { setGenerationState } from './state.js';
import { getJobByRunId } from '../master-marketer/client.js';
import { ingestContent } from '../rag/ingestion.js';
import { attachTechnologyToOptions } from './program-roadmap.js';
import type { GenerationState } from './types.js';

interface DeliverableRow {
  deliverable_id?: string;
  metadata: GenerationState | null;
  contract_id?: string;
  title?: string;
}

export type RecoveryOutcome =
  | 'recovered'
  | 'recovered_failed'
  | 'still_running'
  | 'already_completed'
  | 'not_found'
  | 'no_run_id'
  | 'no_output'
  | 'error';

export interface RecoveryResult {
  deliverable_id: string;
  outcome: RecoveryOutcome;
  message?: string;
}

/** Generation states that mean "MM was handed this and we're still waiting". */
const IN_FLIGHT_STATUSES = new Set(['pending', 'assembling_context', 'submitted']);

/**
 * Normalize MM output into { content_raw, content_structured }.
 *
 * MM's raw Trigger.dev output uses `full_document_markdown` for the markdown
 * and the entire object as the structured data. The webhook callback *may*
 * already use our field names. This handles both shapes.
 */
export function normalizeOutput(raw: Record<string, unknown>): {
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
} {
  let contentRaw: string | null = null;
  let contentStructured: Record<string, unknown> | null = null;

  // If MM already mapped to our field names (webhook callback)
  if (typeof raw.content_raw === 'string' || raw.content_structured) {
    contentRaw = (raw.content_raw as string) || null;
    contentStructured = (raw.content_structured as Record<string, unknown>) || null;
  } else {
    // Raw Trigger.dev output: full_document_markdown + structured object
    contentRaw = (raw.full_document_markdown as string) || null;
    const { full_document_markdown: _, ...structured } = raw;
    contentStructured = Object.keys(structured).length > 0 ? structured : null;
  }

  // If content_structured itself contains a nested content_structured key
  // (MM convert endpoints return this shape), unwrap it and merge top-level
  // fields (summary, title, metadata) alongside the inner structured data.
  if (
    contentStructured &&
    typeof contentStructured.content_structured === 'object' &&
    contentStructured.content_structured !== null
  ) {
    const inner = contentStructured.content_structured as Record<string, unknown>;
    const { content_structured: _, ...outerFields } = contentStructured;
    contentStructured = { ...inner, ...outerFields };
  }

  return { content_raw: contentRaw, content_structured: contentStructured };
}

/**
 * Pull a single deliverable's output from MM and write it into Compass.
 *
 * Safe to call repeatedly — a deliverable already marked completed short-circuits,
 * and a job still running is reported rather than treated as a failure.
 */
export async function recoverDeliverable(
  deliverableId: string,
  explicitRunId?: string
): Promise<RecoveryResult> {
  try {
    const rows = await select<DeliverableRow[]>('compass_deliverables', {
      select: 'metadata,contract_id,title',
      filters: { deliverable_id: deliverableId },
      limit: 1,
    });

    const row = rows?.[0];
    const generation = row?.metadata?.generation;

    // An explicit run ID bypasses stored state entirely. Necessary because
    // metadata.generation is not reliably persisted — see the note on
    // findStuckDeliverables — and MM resolves run IDs against Trigger.dev,
    // which retains runs for 14 days regardless of what we stored.
    const runId = explicitRunId || generation?.trigger_run_id;

    if (!explicitRunId) {
      if (!generation) {
        return { deliverable_id: deliverableId, outcome: 'not_found', message: 'No generation metadata' };
      }
      if (generation.status === 'completed') {
        return { deliverable_id: deliverableId, outcome: 'already_completed' };
      }
    }

    if (!runId) {
      return { deliverable_id: deliverableId, outcome: 'no_run_id', message: 'No trigger_run_id stored' };
    }

    console.log(
      `[Recovery] Attempting deliverable ${deliverableId}, run ${runId}` +
      (explicitRunId ? ' (explicit run id)' : '')
    );

    const result = await getJobByRunId(runId);
    const normalizedStatus = result.status?.toLowerCase();

    if (normalizedStatus === 'completed' || normalizedStatus === 'complete') {
      if (!result.output) {
        return { deliverable_id: deliverableId, outcome: 'no_output', message: 'MM completed but returned no output' };
      }

      const output = normalizeOutput(result.output as unknown as Record<string, unknown>);

      // Same attachment the webhook does, so a recovered roadmap is not a lesser one.
      const contentStructured = attachTechnologyToOptions(
        output.content_structured,
        row?.metadata as unknown as Record<string, unknown> | null
      );

      await setGenerationState(
        deliverableId,
        {
          status: 'completed',
          job_id: generation?.job_id,
          trigger_run_id: runId,
          completed_at: new Date().toISOString(),
        },
        {
          status: 'planned',
          content_raw: output.content_raw,
          content_structured: contentStructured,
        }
      );

      // Auto-embed (non-blocking)
      const contentToEmbed =
        output.content_raw ||
        (contentStructured ? JSON.stringify(contentStructured) : null);

      if (contentToEmbed && process.env.OPENAI_API_KEY && row?.contract_id) {
        ingestContent({
          contract_id: row.contract_id,
          source_type: 'deliverable',
          source_id: deliverableId,
          title: row.title || 'Deliverable',
          content: contentToEmbed,
        }).catch((err) => {
          console.error('[Recovery] Embedding failed (non-blocking):', err);
        });
      }

      console.log(`[Recovery] Succeeded for deliverable ${deliverableId}`);
      return { deliverable_id: deliverableId, outcome: 'recovered' };
    }

    if (normalizedStatus === 'failed' || normalizedStatus === 'fail') {
      await setGenerationState(
        deliverableId,
        {
          status: 'failed',
          job_id: generation?.job_id,
          trigger_run_id: runId,
          error: result.error || 'Job failed (recovered from MM)',
          completed_at: new Date().toISOString(),
        },
        { status: 'planned' }
      );

      return { deliverable_id: deliverableId, outcome: 'recovered_failed' };
    }

    return {
      deliverable_id: deliverableId,
      outcome: 'still_running',
      message: `Job still ${result.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Recovery] Failed for deliverable ${deliverableId}:`, message);
    return { deliverable_id: deliverableId, outcome: 'error', message };
  }
}

/**
 * Find deliverables that were handed to MM and never came back.
 *
 * `stuckAfterMinutes` must exceed the slowest generator's runtime or the sweep
 * will pick up jobs that are simply still working. The SEO audit is the long pole
 * at up to 45 minutes (its Trigger.dev maxDuration), so the default leaves headroom.
 *
 * Candidates come from the top-level `status` column, which is set to 'working'
 * when generation is submitted and back to 'planned' when it completes or fails
 * (see routes/compass/deliverables.ts). That makes it an exact, server-side
 * filterable marker for "handed to MM and still waiting".
 *
 * Do NOT filter on `updated_at` here: nothing maintains that column on the
 * generation-state writes, so a deliverable created weeks ago but generated
 * today keeps a stale timestamp and gets silently excluded. That bug let a
 * stranded deliverable sit unrecovered for 11 hours.
 *
 * Generation status lives inside the JSON metadata column, so those checks stay
 * in memory (same approach as the RAG backfill).
 */
export async function findStuckDeliverables(options?: {
  stuckAfterMinutes?: number;
  max?: number;
}): Promise<{ rowsExamined: number; stuck: string[] }> {
  const stuckAfterMinutes = options?.stuckAfterMinutes ?? 60;
  const max = options?.max ?? 25;

  const stuckBefore = Date.now() - stuckAfterMinutes * 60 * 1000;

  const rows = await select<DeliverableRow[]>('compass_deliverables', {
    select: 'deliverable_id,metadata',
    filters: { status: 'working' },
    limit: 500,
  });

  const examined = rows || [];
  const stuck: string[] = [];

  for (const row of examined) {
    const generation = row?.metadata?.generation;
    if (!row.deliverable_id || !generation) continue;
    if (!IN_FLIGHT_STATUSES.has(generation.status)) continue;
    if (!generation.trigger_run_id) continue;

    // Without a submitted_at we can't tell how long it's been waiting — skip
    // rather than risk interrupting a job that only just started.
    if (!generation.submitted_at) continue;
    const submittedAt = Date.parse(generation.submitted_at);
    if (!Number.isFinite(submittedAt) || submittedAt > stuckBefore) continue;

    stuck.push(row.deliverable_id);
    if (stuck.length >= max) break;
  }

  // rowsExamined disambiguates a quiet run: examined>0 with stuck=0 means we
  // looked at in-flight generations and none were stranded, whereas examined=0
  // means no deliverable is currently in 'working' status at all.
  return { rowsExamined: examined.length, stuck };
}

/**
 * Diagnostic: dump the generation state of every deliverable that has any, with
 * no top-level status filter, so we can see why a stranded one isn't matching.
 *
 * Read-only. Reached via ?debug=1 on the cron route.
 */
export async function diagnoseDeliverables(limit = 200): Promise<
  Array<{
    deliverable_id?: string;
    row_status?: string;
    gen_status?: string;
    has_run_id: boolean;
    submitted_at?: string;
    age_minutes?: number | null;
    would_match: boolean;
  }>
> {
  // Select ONLY small columns. Pulling content_raw/content_structured across
  // hundreds of deliverables exhausts the edge function's memory
  // (Proxy 546 WORKER_RESOURCE_LIMIT) — each row can be hundreds of KB.
  const rows = await select<Array<DeliverableRow & { status?: string }>>('compass_deliverables', {
    select: 'deliverable_id,status,metadata',
    order: [{ column: 'created_at', ascending: false }],
    limit,
  });

  const now = Date.now();

  return (rows || [])
    .filter((r) => r?.metadata?.generation)
    .map((r) => {
      const g = r.metadata!.generation!;
      const submittedAt = g.submitted_at ? Date.parse(g.submitted_at) : NaN;
      const ageMinutes = Number.isFinite(submittedAt)
        ? Math.round((now - submittedAt) / 60000)
        : null;

      return {
        deliverable_id: r.deliverable_id,
        row_status: r.status,
        gen_status: g.status,
        has_run_id: !!g.trigger_run_id,
        submitted_at: g.submitted_at,
        age_minutes: ageMinutes,
        would_match:
          IN_FLIGHT_STATUSES.has(g.status) && !!g.trigger_run_id && !!g.submitted_at,
      };
    });
}

/**
 * Sweep for stranded deliverables and pull each one back. Used by the cron route.
 */
export async function recoverStuckDeliverables(options?: {
  stuckAfterMinutes?: number;
  max?: number;
}): Promise<{ rowsExamined: number; scanned: number; results: RecoveryResult[] }> {
  const { rowsExamined, stuck } = await findStuckDeliverables(options);

  if (stuck.length === 0) {
    return { rowsExamined, scanned: 0, results: [] };
  }

  console.log(`[Recovery] Sweep found ${stuck.length} stuck deliverable(s): ${stuck.join(', ')}`);

  const results: RecoveryResult[] = [];
  // Sequential on purpose — each recovery pulls a full deliverable payload from
  // MM and writes it back; a burst of these would spike memory and DB writes.
  for (const deliverableId of stuck) {
    results.push(await recoverDeliverable(deliverableId));
  }

  return { rowsExamined, scanned: stuck.length, results };
}
