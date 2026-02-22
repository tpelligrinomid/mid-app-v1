/**
 * Blog URL Bulk Ingestion Processor
 *
 * Submits blog URLs to Master Marketer for scraping, processes callbacks,
 * creates content assets, and runs AI categorization + custom attribute filling.
 *
 * Pattern follows deliverable-generation/processor.ts:
 *   submitBulkScrape → MM scrapes → webhook callback → processScrapeResult
 */

import { insert, select, update } from '../../utils/edge-functions.js';
import { submitBlogScrape } from '../master-marketer/client.js';
import { ingestContent } from '../rag/ingestion.js';
import type {
  IngestionBatch,
  IngestionItem,
  BlogScrapeCallbackPayload,
} from './types.js';

// ============================================================================
// submitBulkScrape
// ============================================================================

export interface BulkScrapeOptions {
  /** Override default content status for created assets (default: 'published') */
  assetStatus?: string;
}

export interface BulkScrapeResult {
  batch_id: string;
  total: number;
  submitted: number;
  skipped_duplicates: string[];
}

/**
 * Create a batch, deduplicate URLs, submit one MM job per URL.
 * Returns immediately with batch summary for 202 response.
 */
export async function submitBulkScrape(
  contractId: string,
  urls: string[],
  options: BulkScrapeOptions = {},
  userId?: string
): Promise<BulkScrapeResult> {
  // Deduplicate URLs (case-insensitive, trim whitespace)
  const seen = new Set<string>();
  const uniqueUrls: string[] = [];
  for (const raw of urls) {
    const normalized = raw.trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      uniqueUrls.push(raw.trim());
    }
  }

  // Check for existing assets with same external_url in this contract
  const skippedDuplicates: string[] = [];
  const newUrls: string[] = [];

  if (uniqueUrls.length > 0) {
    const existingAssets = await select<Array<{ external_url: string }>>(
      'content_assets',
      {
        select: 'external_url',
        filters: {
          contract_id: contractId,
          external_url: { in: uniqueUrls },
        },
      }
    ).catch(() => [] as Array<{ external_url: string }>);

    const existingUrlSet = new Set(
      (existingAssets || []).map((a) => a.external_url?.toLowerCase())
    );

    for (const url of uniqueUrls) {
      if (existingUrlSet.has(url.toLowerCase())) {
        skippedDuplicates.push(url);
      } else {
        newUrls.push(url);
      }
    }
  }

  if (newUrls.length === 0) {
    // Create a batch that's immediately completed (all duplicates)
    const batch = await insert<IngestionBatch[]>(
      'content_ingestion_batches',
      {
        contract_id: contractId,
        total: 0,
        completed: 0,
        failed: 0,
        status: 'completed',
        options: options,
        created_by: userId || null,
        completed_at: new Date().toISOString(),
      },
      { select: 'batch_id, total' }
    );

    return {
      batch_id: batch[0].batch_id,
      total: 0,
      submitted: 0,
      skipped_duplicates: skippedDuplicates,
    };
  }

  // Create batch
  const batchRows = await insert<IngestionBatch[]>(
    'content_ingestion_batches',
    {
      contract_id: contractId,
      total: newUrls.length,
      options: options,
      created_by: userId || null,
    },
    { select: 'batch_id' }
  );
  const batchId = batchRows[0].batch_id;

  // Create item rows
  const itemData = newUrls.map((url) => ({
    batch_id: batchId,
    contract_id: contractId,
    url,
  }));

  const items = await insert<IngestionItem[]>(
    'content_ingestion_items',
    itemData,
    { select: 'item_id, url' }
  );

  // Submit one MM job per URL (fire-and-forget, don't await all)
  let submitted = 0;
  for (const item of items) {
    try {
      const result = await submitBlogScrape({
        url: item.url,
        metadata: {
          batch_id: batchId,
          item_id: item.item_id,
          contract_id: contractId,
        },
      });

      // Update item with job_id
      await update(
        'content_ingestion_items',
        {
          job_id: result.jobId,
          trigger_run_id: result.triggerRunId || null,
        },
        { item_id: item.item_id }
      );
      submitted++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[Ingestion] Failed to submit URL ${item.url}:`, errorMessage);

      // Mark item as failed immediately
      await update(
        'content_ingestion_items',
        {
          status: 'failed',
          error: `Submission failed: ${errorMessage}`,
          updated_at: new Date().toISOString(),
        },
        { item_id: item.item_id }
      ).catch(() => {});

      // Update batch failed count
      await incrementBatchCounter(batchId, 'failed');
    }
  }

  return {
    batch_id: batchId,
    total: newUrls.length,
    submitted,
    skipped_duplicates: skippedDuplicates,
  };
}

// ============================================================================
// processScrapeResult (webhook callback handler)
// ============================================================================

/**
 * Process a single blog scrape result from Master Marketer.
 * Creates content asset, runs AI categorization + custom attributes.
 */
export async function processScrapeResult(
  payload: BlogScrapeCallbackPayload
): Promise<void> {
  const { job_id, status, metadata, output, error } = payload;
  const { item_id, batch_id, contract_id } = metadata;

  console.log(
    `[Ingestion] Callback: job=${job_id} status=${status} item=${item_id} batch=${batch_id}`
  );

  // Fetch current item for idempotency check
  const items = await select<IngestionItem[]>('content_ingestion_items', {
    select: 'item_id, status, url, batch_id',
    filters: { item_id },
    limit: 1,
  });

  const item = items?.[0];
  if (!item) {
    console.warn(`[Ingestion] Item ${item_id} not found, ignoring callback`);
    return;
  }

  // Idempotency: skip if already terminal
  if (item.status === 'categorized' || item.status === 'failed') {
    console.log(`[Ingestion] Item ${item_id} already ${item.status}, skipping`);
    return;
  }

  // Handle failure
  if (status === 'failed') {
    await update(
      'content_ingestion_items',
      {
        status: 'failed',
        error: error || 'Scrape failed (unknown error)',
        updated_at: new Date().toISOString(),
      },
      { item_id }
    );
    await incrementBatchCounter(batch_id, 'failed');
    await checkBatchCompletion(batch_id);
    return;
  }

  // Handle success
  if (status !== 'completed' || !output) {
    await update(
      'content_ingestion_items',
      {
        status: 'failed',
        error: `Unexpected callback: status=${status}, hasOutput=${!!output}`,
        updated_at: new Date().toISOString(),
      },
      { item_id }
    );
    await incrementBatchCounter(batch_id, 'failed');
    await checkBatchCompletion(batch_id);
    return;
  }

  try {
    // Mark as scraped
    await update(
      'content_ingestion_items',
      { status: 'scraped', updated_at: new Date().toISOString() },
      { item_id }
    );

    // Fetch batch to get created_by for the asset
    let createdBy: string | null = null;
    try {
      const batches = await select<IngestionBatch[]>('content_ingestion_batches', {
        select: 'created_by',
        filters: { batch_id },
        limit: 1,
      });
      createdBy = batches?.[0]?.created_by || null;
    } catch {
      // Non-blocking — created_by is optional
    }

    // Create content asset
    const assetData: Record<string, unknown> = {
      contract_id,
      asset_type: 'content',
      title: output.title || item.url,
      description: output.meta_description || null,
      content_body: output.content_markdown,
      external_url: output.url || item.url,
      status: 'published',
      metadata: {
        source: 'bulk_ingestion',
        batch_id,
        ...(output.author && { author: output.author }),
        ...(output.meta_description && { meta_description: output.meta_description }),
        ...(output.word_count && { word_count: output.word_count }),
      },
      ...(output.published_date && { published_date: output.published_date }),
      ...(createdBy && { created_by: createdBy }),
    };

    const assets = await insert<Array<{ asset_id: string }>>(
      'content_assets',
      assetData,
      { select: 'asset_id' }
    );
    const assetId = assets[0].asset_id;

    // Update item with asset reference
    await update(
      'content_ingestion_items',
      {
        asset_id: assetId,
        status: 'asset_created',
        updated_at: new Date().toISOString(),
      },
      { item_id }
    );

    // Ingest content for RAG embeddings (non-blocking)
    if (output.content_markdown && process.env.OPENAI_API_KEY) {
      try {
        await ingestContent({
          contract_id,
          source_type: 'content',
          source_id: assetId,
          title: output.title || item.url,
          content: output.content_markdown,
        });
        console.log(`[Ingestion] Embeddings created for asset ${assetId}`);
      } catch (embedErr) {
        console.error(`[Ingestion] Embedding failed for asset ${assetId} (non-blocking):`, embedErr);
      }
    }

    // Fire-and-forget: categorize with attributes using edge functions
    (async () => {
      try {
        const { categorizeWithAttributes } = await import('../claude/categorize-with-attributes.js');

        const catResult = await categorizeWithAttributes(
          output.content_markdown,
          output.title || item.url,
          contract_id,
          'blog_post' // Known type for bulk blog ingestion
        );

        if (catResult) {
          await applyCategorizationViaEdgeFn(
            assetId,
            contract_id,
            assetData.metadata as Record<string, unknown>,
            catResult
          );
        }

        await update(
          'content_ingestion_items',
          { status: 'categorized', updated_at: new Date().toISOString() },
          { item_id }
        );
      } catch (catErr) {
        console.error(`[Ingestion] Categorization failed for item ${item_id} (non-blocking):`, catErr);
        // Still mark as categorized (asset was created successfully)
        await update(
          'content_ingestion_items',
          { status: 'categorized', updated_at: new Date().toISOString() },
          { item_id }
        ).catch(() => {});
      }

      await incrementBatchCounter(batch_id, 'completed');
      await checkBatchCompletion(batch_id);
    })();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Ingestion] Failed to process scrape result for item ${item_id}:`, errorMessage);

    await update(
      'content_ingestion_items',
      {
        status: 'failed',
        error: errorMessage,
        updated_at: new Date().toISOString(),
      },
      { item_id }
    ).catch(() => {});

    await incrementBatchCounter(batch_id, 'failed');
    await checkBatchCompletion(batch_id);
  }
}

// ============================================================================
// getBatchStatus
// ============================================================================

export interface BatchStatus {
  batch: IngestionBatch;
  items: IngestionItem[];
}

export async function getBatchStatus(batchId: string): Promise<BatchStatus | null> {
  const batches = await select<IngestionBatch[]>('content_ingestion_batches', {
    select: '*',
    filters: { batch_id: batchId },
    limit: 1,
  });

  if (!batches || batches.length === 0) return null;

  const items = await select<IngestionItem[]>('content_ingestion_items', {
    select: '*',
    filters: { batch_id: batchId },
  });

  return {
    batch: batches[0],
    items: items || [],
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Apply categorization results via edge functions (service role).
 * Mirrors apply-categorization.ts logic but uses edge functions instead of supabase client.
 */
async function applyCategorizationViaEdgeFn(
  assetId: string,
  contractId: string,
  existingMetadata: Record<string, unknown> | null,
  result: import('../claude/categorize-with-attributes.js').ExtendedCategorizationResult
): Promise<void> {
  const updates: Record<string, unknown> = {};

  // Resolve content_type_slug → UUID
  try {
    const typeRows = await select<Array<{ type_id: string }>>(
      'content_types',
      {
        select: 'type_id',
        filters: { slug: result.content_type_slug, is_active: true },
        limit: 1,
      }
    );
    if (typeRows?.[0]) {
      updates.content_type_id = typeRows[0].type_id;
    }
  } catch (err) {
    console.warn('[Ingestion] Failed to resolve content type slug:', err);
  }

  // Resolve category_slug → UUID
  try {
    const catRows = await select<Array<{ category_id: string }>>(
      'content_categories',
      {
        select: 'category_id',
        filters: { slug: result.category_slug, is_active: true },
        limit: 1,
      }
    );
    if (catRows?.[0]) {
      updates.category_id = catRows[0].category_id;
    }
  } catch (err) {
    console.warn('[Ingestion] Failed to resolve category slug:', err);
  }

  // Merge AI metadata
  updates.metadata = {
    ...(existingMetadata || {}),
    ...result.metadata,
  };

  // Custom attributes
  if (result.custom_attributes && Object.keys(result.custom_attributes).length > 0) {
    updates.custom_attributes = result.custom_attributes;
  }

  await update('content_assets', updates, { asset_id: assetId });

  console.log(
    `[Ingestion] Categorization applied to asset ${assetId}: type=${result.content_type_slug}, category=${result.category_slug}`
  );
}

async function incrementBatchCounter(
  batchId: string,
  field: 'completed' | 'failed'
): Promise<void> {
  try {
    // Fetch current values and increment
    const batches = await select<IngestionBatch[]>('content_ingestion_batches', {
      select: 'completed, failed',
      filters: { batch_id: batchId },
      limit: 1,
    });

    if (!batches || batches.length === 0) return;

    const current = batches[0];
    const updateData: Record<string, unknown> = {};
    if (field === 'completed') {
      updateData.completed = current.completed + 1;
    } else {
      updateData.failed = current.failed + 1;
    }

    await update('content_ingestion_batches', updateData, { batch_id: batchId });
  } catch (err) {
    console.error(`[Ingestion] Failed to increment ${field} for batch ${batchId}:`, err);
  }
}

async function checkBatchCompletion(batchId: string): Promise<void> {
  try {
    const batches = await select<IngestionBatch[]>('content_ingestion_batches', {
      select: 'total, completed, failed, status',
      filters: { batch_id: batchId },
      limit: 1,
    });

    if (!batches || batches.length === 0) return;

    const batch = batches[0];
    const processed = batch.completed + batch.failed;

    if (processed >= batch.total && batch.status === 'in_progress') {
      const finalStatus = batch.failed > 0 ? 'completed_with_errors' : 'completed';
      await update(
        'content_ingestion_batches',
        {
          status: finalStatus,
          completed_at: new Date().toISOString(),
        },
        { batch_id: batchId }
      );
      console.log(
        `[Ingestion] Batch ${batchId} ${finalStatus}: ${batch.completed} completed, ${batch.failed} failed of ${batch.total}`
      );
    }
  } catch (err) {
    console.error(`[Ingestion] Failed to check batch completion for ${batchId}:`, err);
  }
}
