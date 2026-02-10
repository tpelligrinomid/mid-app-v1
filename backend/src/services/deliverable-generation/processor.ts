/**
 * Background Processor for Deliverable Generation
 *
 * Follows the same fire-and-forget pattern as meetings.ts:163-221:
 * assemble context -> submit to Master Marketer -> poll -> write results.
 *
 * State is tracked in compass_deliverables.metadata.generation.
 */

import { update as edgeFnUpdate } from '../../utils/edge-functions.js';
import { submitDeliverable, pollUntilComplete } from '../master-marketer/client.js';
import type { DeliverableJobOutput } from '../master-marketer/types.js';
import { ingestContent } from '../rag/ingestion.js';
import { assembleContext } from './context.js';
import type { GenerationState, ResearchInputs } from './types.js';

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Main
// ============================================================================

/**
 * Generate a deliverable in the background (fire-and-forget).
 *
 * State machine: pending -> assembling_context -> submitted -> polling -> completed | failed
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

    // 2. Submit to Master Marketer
    await updateGenerationState(deliverableId, {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      context_summary: contextSummary,
    });

    const { jobId } = await submitDeliverable({
      deliverable_type: deliverableType,
      contract_id: contractId,
      title,
      instructions,
      client: researchInputs?.client,
      competitors: researchInputs?.competitors,
      context,
    });

    // 3. Poll for completion
    await updateGenerationState(deliverableId, {
      status: 'polling',
      job_id: jobId,
      submitted_at: new Date().toISOString(),
      context_summary: contextSummary,
    });

    const result = await pollUntilComplete(jobId, {
      intervalMs: 7000,
      timeoutMs: 600_000, // 10 min — deliverables may take longer than meetings
    });

    if (!result.output) {
      throw new Error('Master Marketer returned completed status but no output');
    }

    // Cast output to deliverable shape
    const output = result.output as unknown as DeliverableJobOutput;

    // 4. Write results back to deliverable
    await edgeFnUpdate(
      'compass_deliverables',
      {
        content_raw: output.content_raw || null,
        content_structured: output.content_structured || null,
        metadata: {
          generation: {
            status: 'completed',
            job_id: jobId,
            submitted_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            context_summary: contextSummary,
          },
        },
      },
      { deliverable_id: deliverableId }
    );

    // 5. Auto-embed the generated content
    const contentToEmbed =
      output.content_raw ||
      (output.content_structured ? JSON.stringify(output.content_structured) : null);

    if (contentToEmbed && process.env.OPENAI_API_KEY) {
      try {
        await ingestContent({
          contract_id: contractId,
          source_type: 'deliverable',
          source_id: deliverableId,
          title,
          content: contentToEmbed,
        });
      } catch (embedErr) {
        console.error('[Deliverable Generation] Embedding failed (non-blocking):', embedErr);
      }
    }

    console.log(
      `[Deliverable Generation] Completed "${title}" (job ${jobId})`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[Deliverable Generation] Failed for deliverable ${deliverableId}:`,
      errorMessage
    );

    await updateGenerationState(deliverableId, {
      status: 'failed',
      error: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }
}
