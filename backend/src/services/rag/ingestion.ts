/**
 * Content Ingestion Service
 *
 * Idempotent pipeline: chunk → embed → upsert into compass_knowledge.
 * Deletes existing chunks for the same source_id before re-ingesting.
 */

import type { SourceType, KnowledgeInsert } from '../../types/rag.js';
import { chunkText } from './chunking.js';
import { getEmbeddings } from './embeddings.js';
import { insert, del } from '../../utils/edge-functions.js';

export interface IngestParams {
  contract_id: string | null;
  source_type: SourceType;
  source_id: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Ingest content into compass_knowledge
 *
 * 1. Delete existing chunks for this source_id (idempotent re-ingestion)
 * 2. Chunk the content
 * 3. Embed all chunks in batch
 * 4. Insert into compass_knowledge
 */
export async function ingestContent(
  params: IngestParams
): Promise<{ chunks_created: number }> {
  const { contract_id, source_type, source_id, title, content, metadata } = params;

  if (!content || content.trim().length === 0) {
    return { chunks_created: 0 };
  }

  // 1. Delete existing chunks for this source_id
  try {
    await del('compass_knowledge', { source_id });
  } catch (err) {
    // Ignore delete errors (may not exist yet)
    console.warn(`[Ingestion] Delete existing chunks warning for ${source_id}:`, err);
  }

  // 2. Chunk the content
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    return { chunks_created: 0 };
  }

  console.log(`[Ingestion] Chunked "${title}" into ${chunks.length} chunks`);

  // 3. Embed all chunks
  const texts = chunks.map((c) => c.content);
  const embeddings = await getEmbeddings(texts);

  // 4. Build insert records
  const records: Record<string, unknown>[] = chunks.map((chunk, i) => ({
    contract_id,
    source_type,
    source_id,
    title,
    content: chunk.content,
    chunk_index: chunk.chunk_index,
    embedding: JSON.stringify(embeddings[i].embedding),
    metadata: {
      ...metadata,
      ...chunk.metadata,
    },
  }));

  // 5. Insert into compass_knowledge
  await insert('compass_knowledge', records);

  console.log(`[Ingestion] Inserted ${records.length} chunks for "${title}"`);

  return { chunks_created: records.length };
}
