-- 007_deliverables_rag.sql
-- Add content columns to deliverables tables and vector infrastructure for RAG

-- Add content columns to compass_deliverables
ALTER TABLE compass_deliverables
  ADD COLUMN IF NOT EXISTS content_raw text,
  ADD COLUMN IF NOT EXISTS content_structured jsonb;

-- Add content_structured to compass_deliverable_versions
ALTER TABLE compass_deliverable_versions
  ADD COLUMN IF NOT EXISTS content_structured jsonb;

-- HNSW vector index on compass_knowledge for fast similarity search
CREATE INDEX IF NOT EXISTS idx_compass_knowledge_embedding
  ON compass_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RPC function: match_knowledge (vector similarity search)
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(1536),
  match_contract_id uuid,
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id uuid,
  contract_id uuid,
  source_type text,
  source_id uuid,
  title text,
  content text,
  chunk_index int,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ck.chunk_id, ck.contract_id, ck.source_type, ck.source_id,
    ck.title, ck.content, ck.chunk_index, ck.metadata,
    1 - (ck.embedding <=> query_embedding) AS similarity
  FROM compass_knowledge ck
  WHERE ck.contract_id = match_contract_id
    AND ck.embedding IS NOT NULL
    AND 1 - (ck.embedding <=> query_embedding) >= match_threshold
  ORDER BY ck.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RLS for compass_knowledge (if not already set)
ALTER TABLE compass_knowledge ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'compass_knowledge' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON compass_knowledge FOR ALL USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'compass_knowledge' AND policyname = 'Authenticated users can read'
  ) THEN
    CREATE POLICY "Authenticated users can read" ON compass_knowledge
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$$;
