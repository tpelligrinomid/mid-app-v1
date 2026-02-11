/**
 * Background Processor for Deliverable Generation
 *
 * Assembles context and submits to Master Marketer with a callback_url.
 * MM calls our webhook when the job completes — no polling needed.
 *
 * State is tracked in compass_deliverables.metadata.generation.
 */

import { update as edgeFnUpdate } from '../../utils/edge-functions.js';
import { submitDeliverable } from '../master-marketer/client.js';
import { assembleContext } from './context.js';
import type { GenerationState, ResearchInputs } from './types.js';

/** Update the generation state in compass_deliverables.metadata */
async function updateGenerationState(
  deliverableId: string,
  state: GenerationState['generation']
): Promise<void> {
  try {
    await edgeFnUpdate(
      'compass_deliverables',
      { metadata: { generation: state } },
      { deliverable_id: deliverableId }
    );
  } catch (err) {
    console.error(`[Deliverable Generation] Failed to update state for ${deliverableId}:`, err);
  }
}

/**
 * Generate a deliverable in the background (fire-and-forget).
 *
 * State machine: pending -> assembling_context -> submitted -> (webhook) -> completed | failed
 */
export async function generateDeliverableInBackground(
  deliverableId: string,
  contractId: string,
  title: string,
  deliverableType: string,
  instructions?: string,
  primaryMeetingIds?: string[],
  researchInputs?: ResearchInputs
): Promise<void> {
  try {
    // 1. Assembling context
    await updateGenerationState(deliverableId, {
      status: 'assembling_context',
    });

    const context = await assembleContext(contractId, title, primaryMeetingIds);

    const contextSummary = {
      meetings_count: context.primary_meetings.length + context.other_meetings.length,
      notes_count: context.notes.length,
      processes_count: context.processes.length,
    };

    console.log(
      `[Deliverable Generation] Context assembled for "${title}":`,
      contextSummary
    );

    // 2. Submit to Master Marketer (includes callback_url for webhook delivery)
    const { jobId, triggerRunId } = await submitDeliverable({
      deliverable_type: deliverableType,
      contract_id: contractId,
      title,
      instructions,
      client: researchInputs?.client,
      competitors: researchInputs?.competitors,
      context: {},
      knowledge_base: context,
      metadata: { deliverable_id: deliverableId },
    });

    // 3. Record submitted state — webhook handles the rest
    await updateGenerationState(deliverableId, {
      status: 'submitted',
      job_id: jobId,
      trigger_run_id: triggerRunId,
      submitted_at: new Date().toISOString(),
      context_summary: contextSummary,
    });

    console.log(
      `[Deliverable Generation] Submitted "${title}" (job ${jobId}, run ${triggerRunId}), awaiting webhook callback`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[Deliverable Generation] Failed for deliverable ${deliverableId}:`,
      errorMessage
    );

    // Reset top-level status back to 'planned' so the UI isn't stuck on 'working'
    try {
      await edgeFnUpdate(
        'compass_deliverables',
        {
          status: 'planned',
          metadata: {
            generation: {
              status: 'failed',
              error: errorMessage,
              completed_at: new Date().toISOString(),
            },
          },
        },
        { deliverable_id: deliverableId }
      );
    } catch (updateErr) {
      console.error(`[Deliverable Generation] Failed to update failure state for ${deliverableId}:`, updateErr);
    }
  }
}
