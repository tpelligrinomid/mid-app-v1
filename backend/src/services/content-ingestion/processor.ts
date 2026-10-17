/**
 * Blog URL Bulk Ingestion Processor
 *
 * Submits blog URLs to Master Marketer for scraping, processes callbacks,
 * creates content assets, and runs AI categorization + custom attribute filling.
 *
 * Pattern follows deliverable-generation/processor.ts:
 *   submitBulkScrape → MM scrapes → webhook callback → processScrapeResult
 */

import { del, insert, select, update } from '../../utils/edge-functions.js';
import { submitBlogScrape } from '../master-marketer/client.js';
import { ingestContent } from '../rag/ingestion.js';
import type {
  IngestionBatch,
  IngestionItem,
  BlogScrapeCallbackPayload,
  FileExtractCallbackPayload,
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
    select: 'item_id, status, url, batch_id, asset_id',
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
    await failLiveSync(item.asset_id, item.url, error || 'Scrape failed (unknown error)');
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
    await failLiveSync(item.asset_id, item.url, 'The scrape returned no content');
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

    // Fetch batch to get created_by and options (content_type_id, category_id)
    let createdBy: string | null = null;
    let batchOptions: Record<string, unknown> = {};
    try {
      const batches = await select<IngestionBatch[]>('content_ingestion_batches', {
        select: 'created_by, options',
        filters: { batch_id },
        limit: 1,
      });
      createdBy = batches?.[0]?.created_by || null;
      batchOptions = (batches?.[0]?.options as Record<string, unknown>) || {};
    } catch {
      // Non-blocking — created_by is optional
    }

    // Live sync: update the target asset instead of creating one.
    const targetAssetId = batchOptions.target_asset_id as string | undefined;
    if (targetAssetId) {
      await applyLiveSyncResult(targetAssetId, item_id, batch_id, item.url, output);
      return;
    }

    // Create content asset (respect user-provided content_type_id / category_id from batch options)
    const userContentTypeId = batchOptions.content_type_id as string | undefined;
    const userCategoryId = batchOptions.category_id as string | undefined;


    const assetData: Record<string, unknown> = {
      contract_id,
      asset_type: 'content',
      title: output.title || item.url,
      description: output.meta_description || null,
      content_body: output.content_markdown,
      external_url: output.url || item.url,
      status: 'published',
      ...(userContentTypeId && { content_type_id: userContentTypeId }),
      ...(userCategoryId && { category_id: userCategoryId }),
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

        // Resolve user-provided content_type_id to slug for categorization hint
        let typeHint: string | undefined = 'blog_post';
        if (userContentTypeId) {
          try {
            const typeRows = await select<Array<{ slug: string }>>(
              'content_types',
              { select: 'slug', filters: { type_id: userContentTypeId }, limit: 1 }
            );
            typeHint = typeRows?.[0]?.slug || undefined;
          } catch {
            // Fall back to no hint
            typeHint = undefined;
          }
        }

        const catResult = await categorizeWithAttributes(
          output.content_markdown,
          output.title || item.url,
          contract_id,
          typeHint
        );

        if (catResult) {
          await applyCategorizationViaEdgeFn(
            assetId,
            contract_id,
            assetData.metadata as Record<string, unknown>,
            catResult,
            { skipContentType: !!userContentTypeId, skipCategory: !!userCategoryId }
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
// processFileExtractResult (webhook callback handler for file uploads)
// ============================================================================

/**
 * Process a file extraction result from Master Marketer.
 * Updates the asset with extracted content, runs AI categorization + embeddings.
 */
export async function processFileExtractResult(
  payload: FileExtractCallbackPayload
): Promise<void> {
  const { job_id, status, metadata, output, error } = payload;
  const { asset_id, contract_id, content_type_slug } = metadata;

  console.log(
    `[FileIngest] Callback: job=${job_id} status=${status} asset=${asset_id}`
  );

  // Handle failure
  if (status === 'failed') {
    await update(
      'content_assets',
      {
        metadata: {
          source: 'file_upload',
          file_extraction: {
            status: 'failed',
            job_id,
            error: error || 'Extraction failed (unknown error)',
            completed_at: new Date().toISOString(),
          },
        },
      },
      { asset_id }
    );
    console.error(`[FileIngest] Extraction failed for asset ${asset_id}: ${error}`);
    return;
  }

  // Handle success
  if (status !== 'completed' || !output) {
    await update(
      'content_assets',
      {
        metadata: {
          source: 'file_upload',
          file_extraction: {
            status: 'failed',
            job_id,
            error: `Unexpected callback: status=${status}, hasOutput=${!!output}`,
            completed_at: new Date().toISOString(),
          },
        },
      },
      { asset_id }
    );
    return;
  }

  try {
    // Update asset with extracted content
    const assetUpdates: Record<string, unknown> = {
      content_body: output.content_markdown,
      metadata: {
        source: 'file_upload',
        file_extraction: {
          status: 'completed',
          job_id,
          extraction_method: output.extraction_method,
          word_count: output.word_count,
          page_count: output.page_count,
          completed_at: new Date().toISOString(),
        },
      },
    };

    if (output.title) {
      assetUpdates.title = output.title;
    }

    await update('content_assets', assetUpdates, { asset_id });
    console.log(`[FileIngest] Content extracted for asset ${asset_id}`);

    // Ingest content for RAG embeddings (non-blocking)
    if (output.content_markdown && process.env.OPENAI_API_KEY) {
      try {
        await ingestContent({
          contract_id,
          source_type: 'content',
          source_id: asset_id,
          title: output.title || asset_id,
          content: output.content_markdown,
        });
        console.log(`[FileIngest] Embeddings created for asset ${asset_id}`);
      } catch (embedErr) {
        console.error(`[FileIngest] Embedding failed for asset ${asset_id} (non-blocking):`, embedErr);
      }
    }

    // Fire-and-forget: categorize with attributes
    (async () => {
      try {
        const { categorizeWithAttributes } = await import('../claude/categorize-with-attributes.js');

        const catResult = await categorizeWithAttributes(
          output.content_markdown,
          output.title || asset_id,
          contract_id,
          content_type_slug
        );

        if (catResult) {
          await applyCategorizationViaEdgeFn(
            asset_id,
            contract_id,
            {
              source: 'file_upload',
              file_extraction: {
                status: 'completed',
                job_id,
                extraction_method: output.extraction_method,
                completed_at: new Date().toISOString(),
              },
            },
            catResult
          );
        }
      } catch (catErr) {
        console.error(`[FileIngest] Categorization failed for asset ${asset_id} (non-blocking):`, catErr);
      }
    })();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[FileIngest] Failed to process extract result for asset ${asset_id}:`, errorMessage);

    await update(
      'content_assets',
      {
        metadata: {
          source: 'file_upload',
          file_extraction: {
            status: 'failed',
            job_id,
            error: errorMessage,
            completed_at: new Date().toISOString(),
          },
        },
      },
      { asset_id }
    ).catch(() => {});
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Apply categorization results via edge functions (service role).
 * Mirrors apply-categorization.ts logic but uses edge functions instead of supabase client.
 */
export async function applyCategorizationViaEdgeFn(
  assetId: string,
  contractId: string,
  existingMetadata: Record<string, unknown> | null,
  result: import('../claude/categorize-with-attributes.js').ExtendedCategorizationResult,
  options?: { skipContentType?: boolean; skipCategory?: boolean }
): Promise<void> {
  const updates: Record<string, unknown> = {};

  // Resolve content_type_slug → UUID (skip if user already set one)
  if (!options?.skipContentType) {
    try {
      const typeRows = await select<Array<{ type_id: string }>>(
        'content_types',
        {
          select: 'type_id',
          filters: { contract_id: contractId, slug: result.content_type_slug, is_active: true },
          limit: 1,
        }
      );
      if (typeRows?.[0]) {
        updates.content_type_id = typeRows[0].type_id;
      }
    } catch (err) {
      console.warn('[Ingestion] Failed to resolve content type slug:', err);
    }
  }

  // Resolve category_slug → UUID (skip if user already set one)
  if (!options?.skipCategory) {
    try {
      const catRows = await select<Array<{ category_id: string }>>(
        'content_categories',
        {
          select: 'category_id',
          filters: { contract_id: contractId, slug: result.category_slug, is_active: true },
          limit: 1,
        }
      );
      if (catRows?.[0]) {
        updates.category_id = catRows[0].category_id;
      }
    } catch (err) {
      console.warn('[Ingestion] Failed to resolve category slug:', err);
    }
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

// ============================================================================
// Live sync: refresh an existing asset from its published page
// ============================================================================
//
// Once a generated (or manual) asset is live on the client's site, the live
// page is the canonical version. A live sync scrapes the URL through the same
// Master Marketer job as bulk ingestion, but the callback updates the existing
// asset (content, URL, status, re-embedding) instead of creating a new one.
// The batch carries options.target_asset_id; the item has asset_id preset.

// A scrape shorter than this is treated as a failed read (login wall, empty
// page) rather than overwriting the asset's content with it.
const MIN_LIVE_CONTENT_CHARS = 200;

interface LiveSyncAssetRow {
  asset_id: string;
  contract_id: string;
  title: string;
  description: string | null;
  published_date: string | null;
  metadata: Record<string, unknown> | null;
}

async function setLiveSyncState(assetId: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  const rows = await select<Array<{ metadata: Record<string, unknown> | null }>>('content_assets', {
    select: 'metadata',
    filters: { asset_id: assetId },
    limit: 1,
  });
  const metadata = { ...(rows?.[0]?.metadata ?? {}), live_sync: state };
  await update('content_assets', { metadata, ...extra, updated_at: new Date().toISOString() }, { asset_id: assetId });
}

/** Host of a URL without "www.", or null if it isn't an http(s) URL. */
export function urlHost(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the URL is on the client's own site (its primary domain or a subdomain of it). */
export function isOnDomain(url: string, primaryDomain: string | null): boolean {
  const host = urlHost(url);
  const domain = primaryDomain ? (urlHost(primaryDomain.includes('://') ? primaryDomain : `https://${primaryDomain}`) ?? null) : null;
  return !!host && !!domain && (host === domain || host.endsWith(`.${domain}`));
}

/**
 * Start a live sync: scrape `url` and, when the result comes back, replace the
 * asset's content with the live page. Returns immediately; the asset shows
 * metadata.live_sync.status = 'pending' until the callback lands.
 */
export async function requestLiveSync(
  assetId: string,
  contractId: string,
  url: string,
  userId?: string
): Promise<{ batch_id: string }> {
  if (!urlHost(url)) throw new Error('A full http(s) URL is required');
  const requestedAt = new Date().toISOString();

  const batchRows = await insert<IngestionBatch[]>(
    'content_ingestion_batches',
    {
      contract_id: contractId,
      total: 1,
      options: { mode: 'live_sync', target_asset_id: assetId },
      created_by: userId || null,
    },
    { select: 'batch_id' }
  );
  const batchId = batchRows[0].batch_id;
  const items = await insert<IngestionItem[]>(
    'content_ingestion_items',
    { batch_id: batchId, contract_id: contractId, url, asset_id: assetId },
    { select: 'item_id' }
  );
  const itemId = items[0].item_id;

  await setLiveSyncState(assetId, { status: 'pending', url, requested_at: requestedAt }, { external_url: url });

  try {
    const result = await submitBlogScrape({ url, metadata: { batch_id: batchId, item_id: itemId, contract_id: contractId } });
    await update('content_ingestion_items', { job_id: result.jobId, trigger_run_id: result.triggerRunId || null }, { item_id: itemId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await update('content_ingestion_items', { status: 'failed', error: `Submission failed: ${message}`, updated_at: new Date().toISOString() }, { item_id: itemId }).catch(() => {});
    await incrementBatchCounter(batchId, 'failed');
    await checkBatchCompletion(batchId);
    await setLiveSyncState(assetId, { status: 'failed', url, requested_at: requestedAt, error: `Couldn't start the scrape: ${message}`.slice(0, 500) }).catch(() => {});
    throw new Error(`Couldn't start the scrape: ${message}`);
  }

  console.log(`[LiveSync] Requested: asset=${assetId} url=${url}`);
  return { batch_id: batchId };
}

/**
 * Retire an asset in favor of another: status 'superseded', linked to its
 * replacement, and removed from the knowledge base so answers cite the new one.
 */
export async function supersedeAsset(sourceAssetId: string, replacementAssetId: string): Promise<void> {
  await update(
    'content_assets',
    { status: 'superseded', superseded_by_asset_id: replacementAssetId, updated_at: new Date().toISOString() },
    { asset_id: sourceAssetId }
  );
  await del('compass_knowledge', { source_id: sourceAssetId }).catch((err) =>
    console.warn(`[Content] Could not remove chunks for superseded asset ${sourceAssetId}:`, err)
  );
  console.log(`[Content] Asset ${sourceAssetId} superseded by ${replacementAssetId}`);
}

/** URL identity for "same page": host without www, path without trailing slash, no query/hash. */
function pageKey(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Other current assets of the contract for the same page; the live-synced asset replaces them. */
async function supersedeOtherAssetsForPage(assetId: string, contractId: string, url: string): Promise<string[]> {
  const key = pageKey(url);
  if (!key) return [];
  const path = key.slice(key.indexOf('/'));
  if (path.length < 2) return []; // never match on a bare homepage
  const rows = await select<Array<{ asset_id: string; title: string; status: string; external_url: string | null }>>('content_assets', {
    select: 'asset_id, title, status, external_url',
    filters: { contract_id: contractId, external_url: { ilike: `%${path}%` } },
  });
  const retired: string[] = [];
  for (const r of rows ?? []) {
    if (r.asset_id === assetId || r.status === 'superseded' || r.status === 'archived') continue;
    if (!r.external_url || pageKey(r.external_url) !== key) continue;
    await supersedeAsset(r.asset_id, assetId);
    retired.push(r.title);
  }
  return retired;
}

/** Marks a live sync failed on its asset (no-op for ordinary ingestion items). */
async function failLiveSync(assetId: string | null, url: string, error: string): Promise<void> {
  if (!assetId) return;
  await setLiveSyncState(assetId, { status: 'failed', url, failed_at: new Date().toISOString(), error: error.slice(0, 500) }).catch((err) =>
    console.error(`[LiveSync] Could not record failure on asset ${assetId}:`, err)
  );
}

/** Callback half of a live sync: write the scraped page onto the existing asset. */
async function applyLiveSyncResult(
  assetId: string,
  itemId: string,
  batchId: string,
  url: string,
  output: NonNullable<BlogScrapeCallbackPayload['output']>
): Promise<void> {
  const markdown = output.content_markdown?.trim() ?? '';
  if (markdown.length < MIN_LIVE_CONTENT_CHARS) {
    const error = `The page returned too little text (${markdown.length} characters), so the asset was left unchanged. Check the URL is public.`;
    await update('content_ingestion_items', { status: 'failed', error, updated_at: new Date().toISOString() }, { item_id: itemId });
    await incrementBatchCounter(batchId, 'failed');
    await checkBatchCompletion(batchId);
    await failLiveSync(assetId, url, error);
    return;
  }

  const rows = await select<LiveSyncAssetRow[]>('content_assets', {
    select: 'asset_id, contract_id, title, description, published_date, metadata',
    filters: { asset_id: assetId },
    limit: 1,
  });
  const asset = rows?.[0];
  if (!asset) {
    await update('content_ingestion_items', { status: 'failed', error: 'Asset no longer exists', updated_at: new Date().toISOString() }, { item_id: itemId });
    await incrementBatchCounter(batchId, 'failed');
    await checkBatchCompletion(batchId);
    return;
  }

  const syncedAt = new Date().toISOString();
  const liveUrl = output.url || url;
  await update(
    'content_assets',
    {
      content_body: markdown,
      external_url: liveUrl,
      status: 'published',
      published_date: asset.published_date || output.published_date || syncedAt.slice(0, 10),
      ...(!asset.description && output.meta_description && { description: output.meta_description }),
      metadata: {
        ...(asset.metadata ?? {}),
        live_sync: {
          status: 'synced',
          url: liveUrl,
          synced_at: syncedAt,
          ...(output.title && { page_title: output.title }),
          ...(output.word_count && { word_count: output.word_count }),
          ...(output.author && { author: output.author }),
        },
      },
      updated_at: syncedAt,
    },
    { asset_id: assetId }
  );

  // Re-embed: replaces the asset's previous chunks with the live version.
  if (process.env.OPENAI_API_KEY) {
    try {
      await ingestContent({ contract_id: asset.contract_id, source_type: 'content', source_id: assetId, title: asset.title, content: markdown });
    } catch (err) {
      console.error(`[LiveSync] Embedding failed for asset ${assetId} (non-blocking):`, err);
    }
  }

  // The live page replaces any older asset for the same URL (e.g. a post rewritten in place).
  try {
    const retired = await supersedeOtherAssetsForPage(assetId, asset.contract_id, liveUrl);
    if (retired.length > 0) {
      await setLiveSyncState(assetId, {
        status: 'synced',
        url: liveUrl,
        synced_at: syncedAt,
        ...(output.title && { page_title: output.title }),
        ...(output.word_count && { word_count: output.word_count }),
        superseded: retired,
      });
    }
  } catch (err) {
    console.error(`[LiveSync] Superseding older assets for ${liveUrl} failed (non-blocking):`, err);
  }

  await update('content_ingestion_items', { status: 'categorized', updated_at: new Date().toISOString() }, { item_id: itemId });
  await incrementBatchCounter(batchId, 'completed');
  await checkBatchCompletion(batchId);
  console.log(`[LiveSync] Synced asset ${assetId} from ${liveUrl} (${markdown.length} chars)`);
}
