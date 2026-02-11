/**
 * Webhook Routes (server-to-server, no JWT auth)
 *
 * Authenticated via x-api-key header check against MASTER_MARKETER_API_KEY.
 */

import { Router, Request, Response } from 'express';
import { update as edgeFnUpdate } from '../utils/edge-functions.js';
import { ingestContent } from '../services/rag/ingestion.js';
import type { WebhookCallbackPayload, GenerationState } from '../services/deliverable-generation/types.js';
import { select } from '../utils/edge-functions.js';

interface DeliverableRow {
  metadata: GenerationState | null;
}

const router = Router();

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

        // Write content + update status
        await edgeFnUpdate(
          'compass_deliverables',
          {
            status: 'planned',
            content_raw: payload.output.content_raw || null,
            content_structured: payload.output.content_structured || null,
            metadata: {
              generation: {
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
          payload.output.content_raw ||
          (payload.output.content_structured
            ? JSON.stringify(payload.output.content_structured)
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
              generation: {
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

export default router;
