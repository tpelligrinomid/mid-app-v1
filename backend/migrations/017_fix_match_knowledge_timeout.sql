-- Migration 017: Fix match_knowledge timeout on large knowledge bases
--
-- Problem: As the compass_knowledge table grew, the match_knowledge RPC
-- started hitting statement timeouts (PostgreSQL error 57014) for broad
-- queries with high match_count (50) and low match_threshold (0.3).
--
-- Root causes:
--   1. The OR clause "contract_id = X OR contract_id IS NULL" prevented
--      efficient use of the HNSW vector index (requires full scan)
--   2. HNSW ef_search default (40) is too low for match_count = 50
--   3. No per-function timeout override to survive broad scans
--
-- Fix:
--   1. Drop the NULL branch — queries always have a contract_id now
--   2. Increase hnsw.ef_search for this function only
--   3. Add partial index for contract_id (speeds up the filter)

-- Partial index to make contract filtering fast
CREATE INDEX IF NOT EXISTS idx_compass_knowledge_contract_has_embedding
  ON compass_knowledge (contract_id)
  WHERE embedding IS NOT NULL;

-- Drop old overload
DROP FUNCTION IF EXISTS match_knowledge(text, uuid, int, float);

-- Recreate with tuned HNSW search and contract-only filter
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding text,
  match_contract_id uuid,
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id uuid, contract_id uuid, source_type text, source_id uuid,
  title text, content text, chunk_index int, metadata jsonb, similarity float
)
LANGUAGE plpgsql AS $$
DECLARE
  query_vector vector(1536);
BEGIN
  -- Tune HNSW for higher recall on broad queries (match_count up to 50)
  SET LOCAL hnsw.ef_search = 100;

  -- Safety net: override the default 8s timeout for broad cold-cache queries
  SET LOCAL statement_timeout = '30s';

  -- Explicitly cast text to vector
  query_vector := query_embedding::vector(1536);

  RETURN QUERY
  SELECT
    ck.chunk_id, ck.contract_id, ck.source_type, ck.source_id,
    ck.title, ck.content, ck.chunk_index, ck.metadata,
    1 - (ck.embedding <=> query_vector) AS similarity
  FROM compass_knowledge ck
  WHERE ck.contract_id = match_contract_id
    AND ck.embedding IS NOT NULL
    AND 1 - (ck.embedding <=> query_vector) >= match_threshold
  ORDER BY ck.embedding <=> query_vector
  LIMIT match_count;
END;
$$;
