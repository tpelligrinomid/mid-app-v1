-- 013: Fix match_knowledge to accept text input for PostgREST compatibility
--
-- PostgREST passes RPC parameters as JSON values. When query_embedding is
-- a JSON string like "[0.1,0.2,...]", PostgreSQL needs an implicit cast from
-- text to vector — but pgvector only provides an assignment cast, which does
-- not work in function calls. This causes the RPC to silently fail (0 results).
--
-- Fix: Create a text-accepting overload that explicitly casts to vector(1536).
-- The original vector(1536) overload is kept for direct SQL usage.

-- Drop the old function first (since we're changing the parameter type)
DROP FUNCTION IF EXISTS match_knowledge(vector, uuid, int, float);

-- Recreate with text parameter — handles both PostgREST and direct SQL calls
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
  -- Explicitly cast text to vector
  query_vector := query_embedding::vector(1536);

  RETURN QUERY
  SELECT
    ck.chunk_id, ck.contract_id, ck.source_type, ck.source_id,
    ck.title, ck.content, ck.chunk_index, ck.metadata,
    1 - (ck.embedding <=> query_vector) AS similarity
  FROM compass_knowledge ck
  WHERE (ck.contract_id = match_contract_id OR ck.contract_id IS NULL)
    AND ck.embedding IS NOT NULL
    AND 1 - (ck.embedding <=> query_vector) >= match_threshold
  ORDER BY ck.embedding <=> query_vector
  LIMIT match_count;
END;
$$;
