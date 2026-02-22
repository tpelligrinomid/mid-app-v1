-- Batch tracking tables for blog URL bulk ingestion pipeline.
-- Batches track overall progress; items track per-URL status.

CREATE TABLE content_ingestion_batches (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contracts(contract_id),
  total INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'completed_with_errors')),
  options JSONB DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE content_ingestion_items (
  item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES content_ingestion_batches(batch_id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES contracts(contract_id),
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'scraped', 'asset_created', 'categorized', 'failed')),
  job_id TEXT,
  trigger_run_id TEXT,
  asset_id UUID REFERENCES content_assets(asset_id),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_items_batch ON content_ingestion_items(batch_id);
CREATE INDEX idx_ingestion_items_batch_status ON content_ingestion_items(batch_id, status);

ALTER TABLE content_ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ingestion_items ENABLE ROW LEVEL SECURITY;

-- Service-role access (backend uses edge functions)
CREATE POLICY "Service role full access" ON content_ingestion_batches FOR ALL USING (true);
CREATE POLICY "Service role full access" ON content_ingestion_items FOR ALL USING (true);
