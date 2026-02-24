-- Migration 015: Brand Voice
-- One brand voice document per contract, used for content generation context.

CREATE TABLE compass_brand_voice (
  brand_voice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(contract_id),

  -- Core voice definition
  voice_summary text NOT NULL,
  tone text[] DEFAULT '{}',
  personality text[] DEFAULT '{}',

  -- Detailed guidelines
  writing_style text,
  do_guidelines text[] DEFAULT '{}',
  dont_guidelines text[] DEFAULT '{}',

  -- Examples
  example_excerpts jsonb DEFAULT '[]',

  -- Audience context
  target_audience text,
  industry_context text,

  -- Metadata
  is_active boolean DEFAULT true,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(contract_id)
);

-- Index for lookups
CREATE INDEX idx_brand_voice_contract ON compass_brand_voice(contract_id);

-- RLS
ALTER TABLE compass_brand_voice ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on compass_brand_voice"
  ON compass_brand_voice
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
