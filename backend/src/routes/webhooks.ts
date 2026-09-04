/**
 * Webhook Routes (server-to-server, no JWT auth)
 *
 * Authenticated via x-api-key header check against MASTER_MARKETER_API_KEY.
 */

import { Router, Request, Response } from 'express';
import { update as edgeFnUpdate } from '../utils/edge-functions.js';
import { ingestContent } from '../services/rag/ingestion.js';
import type { WebhookCallbackPayload, GenerationState } from '../services/deliverable-generation/types.js';
import type { BlogScrapeCallbackPayload, FileExtractCallbackPayload } from '../services/content-ingestion/types.js';
import { select } from '../utils/edge-functions.js';
import { getJobByRunId } from '../services/master-marketer/client.js';
import { processScrapeResult, processFileExtractResult } from '../services/content-ingestion/processor.js';
import { recoverDeliverable, normalizeOutput } from '../services/deliverable-generation/recover.js';
import { attachTechnologyToOptions } from '../services/deliverable-generation/program-roadmap.js';

interface DeliverableRow {
  metadata: GenerationState | null;
  contract_id?: string;
  title?: string;
}

const router = Router();

// ============================================================================
// Helpers
// ============================================================================


// ============================================================================
// Auth middleware for webhook routes
// ============================================================================

function verifyApiKey(req: Request, res: Response, next: () => void) {
  const apiKey = process.env.MASTER_MARKETER_API_KEY;
  if (!apiKey) {
    console.error('[Webhooks] MASTER_MARKETER_API_KEY not configured');
    res.status(500).json({ error: 'Webhook auth not configured' });
    return;
  }

  const providedKey = req.headers['x-api-key'];
  if (providedKey !== apiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

// ============================================================================
// POST /master-marketer/job-complete
// ============================================================================

router.post(
  '/master-marketer/job-complete',
  verifyApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const payload = req.body as WebhookCallbackPayload;

    const { job_id, status, deliverable_id, contract_id, title } = payload;

    if (!job_id || !status || !deliverable_id) {
      res.status(400).json({ error: 'Missing required fields: job_id, status, deliverable_id' });
      return;
    }

    console.log(
      `[Webhooks] MM job-complete: job=${job_id} status=${status} deliverable=${deliverable_id}`
    );

    try {
      // Idempotency: check if already completed
      const existing = await select<DeliverableRow[]>(
        'compass_deliverables',
        {
          select: 'metadata',
          filters: { deliverable_id },
          limit: 1,
        }
      );

      /**
       * Everything else already stored under metadata.
       *
       * The writes below used to replace metadata outright, so every completion and every
       * failure discarded whatever else lived there -- generation_request, context_summary,
       * trigger_run_id. That is how a submission that saved correctly was gone by the time
       * anyone came to replay it: not a race, just an unconditional overwrite on the way
       * out.
       */
      const existingMetadata = (existing?.[0]?.metadata ?? {}) as Record<string, unknown>;
      const currentGenStatus = existing?.[0]?.metadata?.generation?.status;
      if (currentGenStatus === 'completed') {
        console.log(`[Webhooks] Deliverable ${deliverable_id} already completed, skipping`);
        res.status(200).json({ ok: true, skipped: true });
        return;
      }

      if (status === 'completed') {
        if (!payload.output) {
          res.status(400).json({ error: 'Completed status requires output field' });
          return;
        }

        const output = normalizeOutput(payload.output as unknown as Record<string, unknown>);

        // Program roadmaps only: lift the technology resolved at submission onto each
        // option, so the viewer can name the stack the monthly platform figure pays for.
        // A no-op for everything else.
        const contentStructured = attachTechnologyToOptions(
          output.content_structured,
          existingMetadata
        );

        // Write content + update status
        await edgeFnUpdate(
          'compass_deliverables',
          {
            status: 'planned',
            content_raw: output.content_raw,
            content_structured: contentStructured,
            metadata: {
              ...existingMetadata,
              generation: {
                ...(existingMetadata.generation as Record<string, unknown> | undefined),
                status: 'completed',
                job_id,
                completed_at: new Date().toISOString(),
              },
            },
          },
          { deliverable_id }
        );

        console.log(`[Webhooks] Deliverable ${deliverable_id} updated with generated content`);

        // Auto-embed (non-blocking)
        const contentToEmbed =
          output.content_raw ||
          (contentStructured
            ? JSON.stringify(contentStructured)
            : null);

        if (contentToEmbed && process.env.OPENAI_API_KEY) {
          ingestContent({
            contract_id,
            source_type: 'deliverable',
            source_id: deliverable_id,
            title: title || 'Deliverable',
            content: contentToEmbed,
          }).catch((err) => {
            console.error('[Webhooks] Embedding failed (non-blocking):', err);
          });
        }
      } else if (status === 'failed') {
        await edgeFnUpdate(
          'compass_deliverables',
          {
            status: 'planned',
            metadata: {
              ...existingMetadata,
              generation: {
                ...(existingMetadata.generation as Record<string, unknown> | undefined),
                status: 'failed',
                job_id,
                error: payload.error || 'Unknown error from Master Marketer',
                completed_at: new Date().toISOString(),
              },
            },
          },
          { deliverable_id }
        );

        console.log(`[Webhooks] Deliverable ${deliverable_id} marked as failed: ${payload.error}`);
      } else {
        res.status(400).json({ error: `Unknown status: ${status}` });
        return;
      }

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(`[Webhooks] Error processing job-complete for ${deliverable_id}:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================================================
// POST /master-marketer/recover/:deliverableId
// Manual recovery: fetch output from MM by triggerRunId if webhook failed
// ============================================================================

router.post(
  '/master-marketer/recover/:deliverableId',
  verifyApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const { deliverableId } = req.params;
    const result = await recoverDeliverable(deliverableId);

    switch (result.outcome) {
      case 'recovered':
        res.status(200).json({ ok: true, recovered: true });
        return;
      case 'recovered_failed':
        res.status(200).json({ ok: true, recovered: true, status: 'failed' });
        return;
      case 'already_completed':
        res.status(200).json({ ok: true, skipped: true, message: 'Already completed' });
        return;
      case 'still_running':
        res.status(200).json({ ok: true, recovered: false, message: result.message });
        return;
      case 'not_found':
        res.status(404).json({ error: 'No generation metadata found for this deliverable' });
        return;
      case 'no_run_id':
        res.status(400).json({ error: 'No trigger_run_id stored — cannot recover' });
        return;
      case 'no_output':
        res.status(502).json({ error: 'MM returned completed but no output' });
        return;
      default:
        res.status(500).json({ error: 'Recovery failed' });
        return;
    }
  }
);

// ============================================================================
// POST /master-marketer/blog-scrape-complete
// Callback from MM when a blog URL has been scraped
// ============================================================================

router.post(
  '/master-marketer/blog-scrape-complete',
  verifyApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const payload = req.body as BlogScrapeCallbackPayload;

    if (!payload.job_id || !payload.status || !payload.metadata?.item_id) {
      res.status(400).json({ error: 'Missing required fields: job_id, status, metadata.item_id' });
      return;
    }

    console.log(
      `[Webhooks] Blog scrape complete: job=${payload.job_id} status=${payload.status} item=${payload.metadata.item_id}`
    );

    try {
      await processScrapeResult(payload);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(`[Webhooks] Error processing blog-scrape-complete:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ============================================================================
// POST /master-marketer/file-extract-complete
// Callback from MM when a file has been text-extracted
// ============================================================================

router.post(
  '/master-marketer/file-extract-complete',
  verifyApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const payload = req.body as FileExtractCallbackPayload;

    if (!payload.job_id || !payload.status || !payload.metadata?.asset_id) {
      res.status(400).json({ error: 'Missing required fields: job_id, status, metadata.asset_id' });
      return;
    }

    console.log(
      `[Webhooks] File extract complete: job=${payload.job_id} status=${payload.status} asset=${payload.metadata.asset_id}`
    );

    try {
      await processFileExtractResult(payload);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error(`[Webhooks] Error processing file-extract-complete:`, err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
