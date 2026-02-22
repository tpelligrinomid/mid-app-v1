/**
 * Apply Categorization Results to Database
 *
 * Resolves AI-returned slugs to UUIDs and updates the content asset.
 * Only fills empty fields — user-provided values are never overwritten.
 * AI metadata (ai_ prefixed keys) is always merged into existing metadata.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CategorizationResult } from './categorize.js';

interface CurrentFields {
  content_type_id: string | null;
  category_id: string | null;
  metadata: Record<string, unknown> | null;
}

export async function applyCategorization(
  supabase: SupabaseClient,
  assetId: string,
  contractId: string,
  currentFields: CurrentFields,
  result: CategorizationResult
): Promise<void> {
  const updates: Record<string, unknown> = {};

  // Resolve content_type_slug → UUID (only if user didn't already set one)
  if (!currentFields.content_type_id) {
    const { data: typeRow } = await supabase
      .from('content_types')
      .select('type_id')
      .or(`contract_id.eq.${contractId},contract_id.is.null`)
      .eq('slug', result.content_type_slug)
      .eq('is_active', true)
      .order('contract_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (typeRow) {
      updates.content_type_id = typeRow.type_id;
    }
  }

  // Resolve category_slug → UUID (only if user didn't already set one)
  if (!currentFields.category_id) {
    const { data: catRow } = await supabase
      .from('content_categories')
      .select('category_id')
      .or(`contract_id.eq.${contractId},contract_id.is.null`)
      .eq('slug', result.category_slug)
      .eq('is_active', true)
      .order('contract_id', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (catRow) {
      updates.category_id = catRow.category_id;
    }
  }

  // AI metadata: always merge into existing metadata
  const existingMetadata = currentFields.metadata || {};
  updates.metadata = {
    ...existingMetadata,
    ...result.metadata,
  };

  // Only update if there's something to write
  if (Object.keys(updates).length === 0) {
    return;
  }

  const { error } = await supabase
    .from('content_assets')
    .update(updates)
    .eq('asset_id', assetId);

  if (error) {
    console.error('[Categorization] Failed to apply results:', error);
  } else {
    console.log(`[Categorization] Applied to asset ${assetId}: type=${result.content_type_slug}, category=${result.category_slug}`);
  }
}
