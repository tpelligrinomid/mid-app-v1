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
  const embeddingStr = JSON.stringify(embedding);
  console.log('[searchKnowledge] Embedding: dimensions =', embedding.length,
    ', first 3 values =', embedding.slice(0, 3),
    ', string length =', embeddingStr.length);

  // 2. Call RPC
  console.log('[searchKnowledge] Calling match_knowledge with threshold =', match_threshold, ', count =', match_count);
  const results = await rpc<SimilarityResult[]>('match_knowledge', {
    query_embedding: embeddingStr,
    match_contract_id: contract_id,
    match_count,
    match_threshold,
  });
  console.log('[searchKnowledge] RPC raw response:', results === null ? 'null' : results === undefined ? 'undefined' : `array of ${results.length}`);

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
