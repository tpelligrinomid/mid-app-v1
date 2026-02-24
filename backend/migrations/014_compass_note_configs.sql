-- Migration 014: Compass Note Configs
-- Configurable automated note generation per contract per note type.
-- Supports strategy notes now; extensible to ABM, paid, content, web in the future.

CREATE TABLE compass_note_configs (
  config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(contract_id),

  -- What type of note to generate
  note_type text NOT NULL,            -- 'strategy' | 'abm' | 'paid' | 'content' | 'web'

  -- Schedule
  enabled boolean DEFAULT false,
  day_of_week integer NOT NULL,       -- 0=Sunday, 1=Monday, ..., 6=Saturday
  generate_time time DEFAULT '20:00', -- Time to generate (default 8 PM)
  timezone text DEFAULT 'America/New_York',

  -- Lookback configuration
  lookback_days integer DEFAULT 7,    -- How far back to look for completed tasks/meetings
  lookahead_days integer DEFAULT 30,  -- How far ahead to look for working tasks

  -- Generation settings
  additional_instructions text,       -- Optional per-contract instructions for Claude

  -- Scheduling state
  next_run_at timestamptz,            -- Pre-computed next generation time
  last_run_at timestamptz,
  last_note_id uuid,                  -- FK to the most recently generated note

  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- One config per note_type per contract
  UNIQUE(contract_id, note_type),

  CONSTRAINT valid_note_type CHECK (note_type IN ('strategy', 'abm', 'paid', 'content', 'web')),
  CONSTRAINT valid_day_of_week CHECK (day_of_week BETWEEN 0 AND 6)
);

CREATE INDEX idx_note_configs_next_run ON compass_note_configs(next_run_at)
  WHERE enabled = true;
CREATE INDEX idx_note_configs_contract ON compass_note_configs(contract_id);
