-- Migration 009: Process Library table + updated match_knowledge function
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS compass_process_library (
  process_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_task_id text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,              -- "External Description" custom field
  points numeric,                -- from Points custom field
  time_estimate_ms integer,      -- ClickUp native time estimate
  phase text,                    -- folder name: AGE, Launch, Research, Roadmap, Foundation, Execution, Analysis
  phase_order integer,           -- parsed from prefix: 0 (AGE), 1 (Launch), 2 (Research), etc.
  category text,                 -- list name: "Required", "Optional", "Templates", etc.
  clickup_folder_id text,
  clickup_list_id text,
  is_active boolean DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_process_library_phase ON compass_process_library(phase);
CREATE INDEX idx_process_library_active ON compass_process_library(is_active);

-- Update match_knowledge to include global items (contract_id IS NULL)
CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding vector(1536),
  match_contract_id uuid,
  match_count int DEFAULT 10,
  match_threshold float DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id uuid, contract_id uuid, source_type text, source_id uuid,
  title text, content text, chunk_index int, metadata jsonb, similarity float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ck.chunk_id, ck.contract_id, ck.source_type, ck.source_id,
    ck.title, ck.content, ck.chunk_index, ck.metadata,
    1 - (ck.embedding <=> query_embedding) AS similarity
  FROM compass_knowledge ck
  WHERE (ck.contract_id = match_contract_id OR ck.contract_id IS NULL)
    AND ck.embedding IS NOT NULL
    AND 1 - (ck.embedding <=> query_embedding) >= match_threshold
  ORDER BY ck.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
