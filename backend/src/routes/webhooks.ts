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

interface DeliverableRow {
  metadata: GenerationState | null;
  contract_id?: string;
  title?: string;
}

const router = Router();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize MM output into { content_raw, content_structured }.
 *
 * MM's raw Trigger.dev output uses `full_document_markdown` for the markdown
 * and the entire object as the structured data. The webhook callback *may*
 * already use our field names. This handles both shapes.
 */
function normalizeOutput(raw: Record<string, unknown>): {
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
  if (contentStructured && typeof contentStructured.content_structured === 'object' && contentStructured.content_structured !== null) {
    const inner = contentStructured.content_structured as Record<string, unknown>;
    const { content_structured: _, ...outerFields } = contentStructured;
    contentStructured = { ...inner, ...outerFields };
  }

  return { content_raw: contentRaw, content_structured: contentStructured };
}

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

        const output = normalizeOutput(payload.output as unknown as Record<string, unknown>);

        // Write content + update status
        await edgeFnUpdate(
          'compass_deliverables',
          {
            status: 'planned',
            content_raw: output.content_raw,
            content_structured: output.content_structured,
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
          output.content_raw ||
          (output.content_structured
            ? JSON.stringify(output.content_structured)
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

// ============================================================================
// POST /master-marketer/recover/:deliverableId
// Manual recovery: fetch output from MM by triggerRunId if webhook failed
// ============================================================================

router.post(
  '/master-marketer/recover/:deliverableId',
  verifyApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const { deliverableId } = req.params;

    try {
      // Look up the deliverable to get the trigger_run_id
      const rows = await select<DeliverableRow[]>(
        'compass_deliverables',
        {
          select: 'metadata,contract_id,title',
          filters: { deliverable_id: deliverableId },
          limit: 1,
        }
      );

      const row = rows?.[0];
      const generation = row?.metadata?.generation;

      if (!generation) {
        res.status(404).json({ error: 'No generation metadata found for this deliverable' });
        return;
      }

      if (generation.status === 'completed') {
        res.status(200).json({ ok: true, skipped: true, message: 'Already completed' });
        return;
      }

      if (!generation.trigger_run_id) {
        res.status(400).json({ error: 'No trigger_run_id stored — cannot recover' });
        return;
      }

      console.log(
        `[Webhooks] Recovery attempt for deliverable ${deliverableId}, run ${generation.trigger_run_id}`
      );

      // Fetch output from MM via Trigger.dev run ID
      const result = await getJobByRunId(generation.trigger_run_id);
      const normalizedStatus = result.status?.toLowerCase();

      if (normalizedStatus === 'completed' || normalizedStatus === 'complete') {
        if (!result.output) {
          res.status(502).json({ error: 'MM returned completed but no output' });
          return;
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
          (output.content_structured
            ? JSON.stringify(output.content_structured)
            : null);

        if (contentToEmbed && process.env.OPENAI_API_KEY && row?.contract_id) {
          ingestContent({
            contract_id: row.contract_id,
            source_type: 'deliverable',
            source_id: deliverableId,
            title: row.title || 'Deliverable',
            content: contentToEmbed,
          }).catch((err) => {
            console.error('[Webhooks] Recovery embedding failed (non-blocking):', err);
          });
        }

        console.log(`[Webhooks] Recovery succeeded for deliverable ${deliverableId}`);
        res.status(200).json({ ok: true, recovered: true });
      } else if (normalizedStatus === 'failed' || normalizedStatus === 'fail') {
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

        res.status(200).json({ ok: true, recovered: true, status: 'failed' });
      } else {
        res.status(200).json({
          ok: true,
          recovered: false,
          message: `Job still ${result.status} — not yet complete`,
        });
      }
    } catch (err) {
      console.error(`[Webhooks] Recovery failed for deliverable ${deliverableId}:`, err);
      res.status(500).json({ error: 'Recovery failed' });
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
