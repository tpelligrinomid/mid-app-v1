/**
 * Vector Similarity Search Service
 *
 * Searches compass_knowledge via the match_knowledge RPC function.
 */

import type { SourceType, SimilarityResult } from '../../types/rag.js';
import { getEmbedding } from './embeddings.js';
import { rpc, select } from '../../utils/edge-functions.js';

export interface SearchParams {
  query: string;
  contract_id: string;
  match_count?: number;
  match_threshold?: number;
  source_types?: SourceType[];
}

/**
 * Search compass_knowledge for similar content
 *
 * 1. Embed the query string
 * 2. Call match_knowledge RPC via edge-functions proxy
 * 3. Optionally filter by source_type
 * 4. Return ranked results with similarity scores
 */
export async function searchKnowledge(
  params: SearchParams
): Promise<SimilarityResult[]> {
  const {
    query,
    contract_id,
    match_count = 10,
    match_threshold = 0.7,
    source_types,
  } = params;

  // 1. Embed the query
  const { embedding } = await getEmbedding(query);

  // DEBUG: Check if compass_knowledge has ANY rows for this contract
  try {
    const rows = await select<{ source_type: string; title: string }[]>('compass_knowledge', {
      select: 'source_type, title',
      filters: { contract_id },
      limit: 5,
    });
    console.log('[searchKnowledge] compass_knowledge has', rows?.length ?? 0, 'rows (showing up to 5) for contract', contract_id,
      rows?.map(r => `${r.source_type}: "${r.title}"`));
  } catch (dbErr) {
    console.error('[searchKnowledge] Direct DB check failed:', dbErr);
  }

  // 2. Call RPC
  const results = await rpc<SimilarityResult[]>('match_knowledge', {
    query_embedding: JSON.stringify(embedding),
    match_contract_id: contract_id,
    match_count,
    match_threshold,
  });

  // 3. Filter by source_type if specified
  if (source_types && source_types.length > 0) {
    const allTypes = (results || []).map(r => r.source_type);
    const uniqueTypes = [...new Set(allTypes)];
    console.log('[searchKnowledge] RPC returned', (results || []).length, 'results with source_types:', uniqueTypes, '— filtering to:', source_types);
    return (results || []).filter((r) =>
      source_types.includes(r.source_type as SourceType)
    );
  }

  return results || [];
}
