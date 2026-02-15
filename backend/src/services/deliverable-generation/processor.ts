/**
 * Background Processor for Deliverable Generation
 *
 * Assembles context and submits to Master Marketer with a callback_url.
 * MM calls our webhook when the job completes — no polling needed.
 *
 * State is tracked in compass_deliverables.metadata.generation.
 */

import { update as edgeFnUpdate, select } from '../../utils/edge-functions.js';
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
 * Resolve the previous roadmap for evolutionary generation.
 * If an explicit ID is given, fetch that specific deliverable.
 * Otherwise, auto-detect the most recent completed roadmap for the contract
 * (excluding the one currently being generated).
 */
async function resolvePreviousRoadmap(
  contractId: string,
  currentDeliverableId: string,
  explicitId?: string
): Promise<Record<string, unknown> | undefined> {
  try {
    if (explicitId) {
      const result = await select<Array<{ content_structured: Record<string, unknown> | null }>>(
        'compass_deliverables',
        {
          select: 'content_structured',
          filters: { deliverable_id: explicitId },
          single: true,
        }
      );
      const structured = (result as unknown as { content_structured: Record<string, unknown> | null })?.content_structured;
      if (structured) {
        console.log(`[Deliverable Generation] Using explicit previous roadmap: ${explicitId}`);
        return structured;
      }
      console.warn(`[Deliverable Generation] Explicit previous_roadmap_id ${explicitId} has no content_structured, skipping`);
      return undefined;
    }

    // Auto-detect: find the latest completed roadmap for this contract
    const results = await select<Array<{ deliverable_id: string; content_structured: Record<string, unknown> | null }>>(
      'compass_deliverables',
      {
        select: 'deliverable_id, content_structured',
        filters: {
          contract_id: contractId,
          deliverable_type: 'roadmap',
          deliverable_id: { neq: currentDeliverableId },
        },
        order: [{ column: 'created_at', ascending: false }],
        limit: 1,
      }
    );

    const prev = results?.[0];
    if (prev?.content_structured) {
      console.log(`[Deliverable Generation] Auto-detected previous roadmap: ${prev.deliverable_id}`);
      return prev.content_structured;
    }

    console.log('[Deliverable Generation] No previous roadmap found for contract, generating from scratch');
    return undefined;
  } catch (err) {
    console.warn('[Deliverable Generation] Failed to resolve previous roadmap (non-blocking):', err);
    return undefined;
  }
}

/**
 * Generic helper: resolve the latest completed deliverable of a given type for a contract.
 * Returns the full content_structured or undefined.
 */
async function resolvePriorDeliverable(
  contractId: string,
  type: string,
  currentDeliverableId: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const results = await select<Array<{ deliverable_id: string; content_structured: Record<string, unknown> | null }>>(
      'compass_deliverables',
      {
        select: 'deliverable_id, content_structured',
        filters: {
          contract_id: contractId,
          deliverable_type: type,
          deliverable_id: { neq: currentDeliverableId },
        },
        order: [{ column: 'created_at', ascending: false }],
        limit: 1,
      }
    );

    const prev = results?.[0];
    if (prev?.content_structured) {
      console.log(`[Deliverable Generation] Auto-detected prior ${type}: ${prev.deliverable_id}`);
      return prev.content_structured;
    }

    console.log(`[Deliverable Generation] No prior ${type} found for contract`);
    return undefined;
  } catch (err) {
    console.warn(`[Deliverable Generation] Failed to resolve prior ${type} (non-blocking):`, err);
    return undefined;
  }
}

/**
 * Resolve the latest completed research deliverable for a contract.
 * Extracts the specific fields MM expects for research context.
 */
async function resolvePriorResearch(
  contractId: string,
  currentDeliverableId: string
): Promise<{ full_document_markdown: string; competitive_scores: Record<string, unknown> } | undefined> {
  const data = await resolvePriorDeliverable(contractId, 'research', currentDeliverableId);
  if (!data) return undefined;
  return {
    full_document_markdown: (data.full_document_markdown as string) || '',
    competitive_scores: (data.competitive_scores as Record<string, unknown>) || {},
  };
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
  researchInputs?: ResearchInputs,
  previousRoadmapId?: string,
  seedTopics?: string[],
  maxCrawlPages?: number
): Promise<void> {
  try {
    // 1. Assembling context
    await updateGenerationState(deliverableId, {
      status: 'assembling_context',
    });

    // SEO audits skip knowledge_base context — they use client/competitors + research_context
    if (deliverableType === 'seo_audit') {
      // Resolve prior research report for context
      const researchContext = await resolvePriorResearch(contractId, deliverableId);

      console.log(
        `[Deliverable Generation] SEO audit context for "${title}":`,
        {
          has_research_context: !!researchContext,
          has_client: !!researchInputs?.client,
          competitors_count: researchInputs?.competitors?.length,
          seed_topics_count: seedTopics?.length ?? 0,
          max_crawl_pages: maxCrawlPages,
        }
      );

      const { jobId, triggerRunId } = await submitDeliverable({
        deliverable_type: deliverableType,
        contract_id: contractId,
        title,
        instructions,
        client: researchInputs?.client,
        competitors: researchInputs?.competitors,
        metadata: { deliverable_id: deliverableId },
        seed_topics: seedTopics,
        max_crawl_pages: maxCrawlPages,
        ...(researchContext && { research_context: researchContext }),
      });

      await updateGenerationState(deliverableId, {
        status: 'submitted',
        job_id: jobId,
        trigger_run_id: triggerRunId,
        submitted_at: new Date().toISOString(),
      });

      console.log(
        `[Deliverable Generation] Submitted SEO audit "${title}" (job ${jobId}, run ${triggerRunId}), awaiting webhook callback`
      );
      return;
    }

    // Content plans pull from prior deliverables (roadmap, SEO audit, research) + meeting transcripts
    if (deliverableType === 'content_plan') {
      const [roadmapData, seoAuditData, researchData, previousContentPlan, context] = await Promise.all([
        resolvePriorDeliverable(contractId, 'roadmap', deliverableId),
        resolvePriorDeliverable(contractId, 'seo_audit', deliverableId),
        resolvePriorResearch(contractId, deliverableId),
        resolvePriorDeliverable(contractId, 'content_plan', deliverableId),
        assembleContext(contractId, title, primaryMeetingIds),
      ]);

      // Extract transcripts from primary meetings (brainstorm/planning sessions)
      const transcripts = context.primary_meetings.map(m => m.transcript);

      console.log(
        `[Deliverable Generation] Content plan context for "${title}":`,
        {
          has_roadmap: !!roadmapData,
          has_seo_audit: !!seoAuditData,
          has_research: !!researchData,
          has_previous_content_plan: !!previousContentPlan,
          transcript_count: transcripts.length,
          meetings_count: context.primary_meetings.length + context.other_meetings.length,
        }
      );

      const { jobId: cpJobId, triggerRunId: cpRunId } = await submitDeliverable({
        deliverable_type: deliverableType,
        contract_id: contractId,
        title,
        instructions,
        metadata: { deliverable_id: deliverableId },
        ...(roadmapData && { roadmap: roadmapData }),
        ...(seoAuditData && { seo_audit: seoAuditData }),
        ...(researchData && { research: researchData }),
        ...(transcripts.length > 0 && { transcripts }),
        ...(previousContentPlan && { previous_content_plan: previousContentPlan }),
      });

      await updateGenerationState(deliverableId, {
        status: 'submitted',
        job_id: cpJobId,
        trigger_run_id: cpRunId,
        submitted_at: new Date().toISOString(),
        context_summary: {
          meetings_count: context.primary_meetings.length + context.other_meetings.length,
          notes_count: context.notes.length,
          processes_count: context.processes.length,
        },
      });

      console.log(
        `[Deliverable Generation] Submitted content plan "${title}" (job ${cpJobId}, run ${cpRunId}), awaiting webhook callback`
      );
      return;
    }

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

    // 2. For roadmaps, resolve previous roadmap for evolutionary generation
    let previousRoadmap: Record<string, unknown> | undefined;
    if (deliverableType === 'roadmap') {
      previousRoadmap = await resolvePreviousRoadmap(contractId, deliverableId, previousRoadmapId);
    }

    // 3. Submit to Master Marketer (includes callback_url for webhook delivery)
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
      ...(previousRoadmap && { previous_roadmap: previousRoadmap }),
    });

    // 4. Record submitted state — webhook handles the rest
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
