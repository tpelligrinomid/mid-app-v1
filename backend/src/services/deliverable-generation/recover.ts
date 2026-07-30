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

import { select, update as edgeFnUpdate } from '../../utils/edge-functions.js';
import { getJobByRunId } from '../master-marketer/client.js';
import { ingestContent } from '../rag/ingestion.js';
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
export async function recoverDeliverable(deliverableId: string): Promise<RecoveryResult> {
  try {
    const rows = await select<DeliverableRow[]>('compass_deliverables', {
      select: 'metadata,contract_id,title',
      filters: { deliverable_id: deliverableId },
      limit: 1,
    });

    const row = rows?.[0];
    const generation = row?.metadata?.generation;

    if (!generation) {
      return { deliverable_id: deliverableId, outcome: 'not_found', message: 'No generation metadata' };
    }
    if (generation.status === 'completed') {
      return { deliverable_id: deliverableId, outcome: 'already_completed' };
    }
    if (!generation.trigger_run_id) {
      return { deliverable_id: deliverableId, outcome: 'no_run_id', message: 'No trigger_run_id stored' };
    }

    console.log(
      `[Recovery] Attempting deliverable ${deliverableId}, run ${generation.trigger_run_id}`
    );

    const result = await getJobByRunId(generation.trigger_run_id);
    const normalizedStatus = result.status?.toLowerCase();

    if (normalizedStatus === 'completed' || normalizedStatus === 'complete') {
      if (!result.output) {
        return { deliverable_id: deliverableId, outcome: 'no_output', message: 'MM completed but returned no output' };
      }

      const output = normalizeOutput(result.output as unknown as Record<string, unknown>);

      await edgeFnUpdate(
        'compass_deliverables',
        {
          status: 'planned',
          content_raw: output.content_raw,
          content_structured: output.content_structured,
          metadata: {
            generation: {
              status: 'completed',
              job_id: generation.job_id,
              trigger_run_id: generation.trigger_run_id,
              completed_at: new Date().toISOString(),
            },
          },
        },
        { deliverable_id: deliverableId }
      );

      // Auto-embed (non-blocking)
      const contentToEmbed =
        output.content_raw ||
        (output.content_structured ? JSON.stringify(output.content_structured) : null);

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
      await edgeFnUpdate(
        'compass_deliverables',
        {
          status: 'planned',
          metadata: {
            generation: {
              status: 'failed',
              job_id: generation.job_id,
              trigger_run_id: generation.trigger_run_id,
              error: result.error || 'Job failed (recovered from MM)',
              completed_at: new Date().toISOString(),
            },
          },
        },
        { deliverable_id: deliverableId }
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
 * The date filter bounds the scan; generation status lives inside a JSON column,
 * so that part is filtered in memory (same approach as the RAG backfill).
 */
export async function findStuckDeliverables(options?: {
  stuckAfterMinutes?: number;
  lookbackDays?: number;
  max?: number;
}): Promise<{ rowsExamined: number; stuck: string[] }> {
  const stuckAfterMinutes = options?.stuckAfterMinutes ?? 60;
  const lookbackDays = options?.lookbackDays ?? 7;
  const max = options?.max ?? 25;

  const lookbackFrom = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const stuckBefore = Date.now() - stuckAfterMinutes * 60 * 1000;

  const rows = await select<DeliverableRow[]>('compass_deliverables', {
    select: 'deliverable_id,metadata',
    filters: { updated_at: { gte: lookbackFrom } },
    order: [{ column: 'updated_at', ascending: false }],
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
  // looked and found nothing wrong, whereas examined=0 means the date filter
  // returned nothing and the sweep isn't actually inspecting anything.
  return { rowsExamined: examined.length, stuck };
}

/**
 * Sweep for stranded deliverables and pull each one back. Used by the cron route.
 */
export async function recoverStuckDeliverables(options?: {
  stuckAfterMinutes?: number;
  lookbackDays?: number;
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
