/**
 * Generation state persistence.
 *
 * Two things every caller needs to get right, centralised here so they can't
 * be got wrong individually:
 *
 * 1. `metadata` is a WHOLE-OBJECT REPLACE, not a merge. Writing
 *    `{ metadata: { generation } }` discards every other key the column held.
 *    We read-modify-write so unrelated metadata written by the frontend
 *    survives a generation-state update.
 *
 * 2. A failed state write must be LOUD. It was silently swallowed for months:
 *    the update was being routed to an RPC that didn't accept `metadata` and
 *    returned success anyway, so generation state — including trigger_run_id —
 *    was never persisted and recovery was impossible for any deliverable.
 *    Generation itself still succeeds without this state, so a failure here is
 *    logged rather than thrown, but it must be obvious in the logs and it must
 *    say what it costs.
 */

import { select, update as edgeFnUpdate } from '../../utils/edge-functions.js';
import type { GenerationState } from './types.js';

interface MetadataRow {
  metadata: Record<string, unknown> | null;
}

/**
 * Merge generation state into a deliverable's metadata, preserving other keys,
 * and optionally set columns alongside it in the same write.
 *
 * @throws if the write fails — callers decide whether that is fatal.
 */
export async function setGenerationState(
  deliverableId: string,
  generation: GenerationState['generation'],
  columns?: Record<string, unknown>
): Promise<void> {
  let existing: Record<string, unknown> = {};

  try {
    const rows = await select<MetadataRow[]>('compass_deliverables', {
      select: 'metadata',
      filters: { deliverable_id: deliverableId },
      limit: 1,
    });
    const current = rows?.[0]?.metadata;
    if (current && typeof current === 'object') {
      existing = current as Record<string, unknown>;
    }
  } catch (err) {
    // Non-fatal: fall back to writing just the generation key. Losing sibling
    // metadata is worse than losing generation state, but both are worse than
    // failing the generation, so continue with what we can write.
    console.warn(
      `[Generation State] Could not read existing metadata for ${deliverableId}, ` +
      `writing generation only (sibling keys may be lost):`,
      err instanceof Error ? err.message : err
    );
  }

  await edgeFnUpdate(
    'compass_deliverables',
    { ...(columns || {}), metadata: { ...existing, generation } },
    { deliverable_id: deliverableId }
  );
}

/**
 * Fire-and-forget variant for the generation pipeline.
 *
 * Generation still succeeds without persisted state, so this never aborts a
 * run — but it logs at error level and spells out the consequence, because a
 * silent failure here is what made deliverables unrecoverable.
 */
export async function setGenerationStateSafe(
  deliverableId: string,
  generation: GenerationState['generation'],
  columns?: Record<string, unknown>
): Promise<boolean> {
  try {
    await setGenerationState(deliverableId, generation, columns);
    return true;
  } catch (err) {
    console.error(
      `[Generation State] FAILED to persist generation state for ${deliverableId} ` +
      `(status=${generation?.status}, run=${generation?.trigger_run_id ?? 'n/a'}). ` +
      `Generation will continue, but this deliverable CANNOT be auto-recovered ` +
      `if delivery fails — recovery needs trigger_run_id from this write. Error:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}
