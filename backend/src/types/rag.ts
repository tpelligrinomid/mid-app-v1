// RAG pipeline types for compass_knowledge and embedding infrastructure

// ============================================================================
// Source types
// ============================================================================

export type SourceType = 'note' | 'deliverable' | 'meeting' | 'content' | 'process' | 'competitive_intel';

export const SOURCE_TYPE_VALUES: SourceType[] = ['note', 'deliverable', 'meeting', 'content', 'process', 'competitive_intel'];

// ============================================================================
// Embeddings
// ============================================================================

export interface EmbeddingResult {
  embedding: number[];
  tokens_used: number;
}

// ============================================================================
// Chunking
// ============================================================================

export interface TextChunk {
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
}

export interface ChunkingOptions {
  max_tokens?: number;
  overlap_sentences?: number;
}

// ============================================================================
// Knowledge (compass_knowledge row)
// ============================================================================

export interface KnowledgeChunk {
  chunk_id: string;
  contract_id: string;
  source_type: SourceType;
  source_id: string;
  title: string;
  content: string;
  chunk_index: number;
  embedding: number[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeInsert {
  contract_id: string | null;
  source_type: SourceType;
  source_id: string;
  title: string;
  content: string;
  chunk_index: number;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Search results
// ============================================================================

export interface SimilarityResult {
  chunk_id: string;
  contract_id: string;
  source_type: string;
  source_id: string;
  title: string;
  content: string;
  chunk_index: number;
  metadata: Record<string, unknown> | null;
  similarity: number;
}
