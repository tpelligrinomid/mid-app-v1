-- Client Status Reports (Compass) Migration
-- Run this in Supabase SQL Editor
--
-- Creates the compass_report_configs table for per-contract
-- automated client status report scheduling.

-- ============================================
-- COMPASS REPORT CONFIGS
-- Per-contract scheduling for client status reports
-- ============================================
CREATE TABLE IF NOT EXISTS compass_report_configs (
    config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contract link
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),

    -- Scheduling
    enabled boolean NOT NULL DEFAULT true,
    cadence text NOT NULL,                    -- 'weekly' or 'monthly'
    day_of_week integer,                      -- 0-6 (0=Sunday), for weekly cadence
    day_of_month integer,                     -- 1-28, for monthly cadence
    send_time time NOT NULL,                  -- e.g. '16:00:00'
    timezone text NOT NULL DEFAULT 'America/New_York',  -- IANA timezone

    -- Report parameters
    lookback_days integer NOT NULL DEFAULT 14,   -- Days to look back for delivered tasks
    lookahead_days integer NOT NULL DEFAULT 30,  -- Days to look ahead for working tasks

    -- Recipients
    recipients text[] NOT NULL,               -- Email addresses

    -- Run tracking
    next_run_at timestamptz,                  -- Pre-computed next send time
    last_run_at timestamptz,                  -- When last report was sent

    -- Audit
    created_by uuid REFERENCES auth.users(id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),

    -- Constraints
    CONSTRAINT valid_cadence CHECK (cadence IN ('weekly', 'monthly')),
    CONSTRAINT valid_day_of_week CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6)),
    CONSTRAINT valid_day_of_month CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 28)),
    CONSTRAINT weekly_requires_day_of_week CHECK (cadence != 'weekly' OR day_of_week IS NOT NULL),
    CONSTRAINT monthly_requires_day_of_month CHECK (cadence != 'monthly' OR day_of_month IS NOT NULL)
);

COMMENT ON TABLE compass_report_configs IS 'Per-contract scheduling configuration for automated client status reports';
COMMENT ON COLUMN compass_report_configs.cadence IS 'Report frequency: weekly or monthly';
COMMENT ON COLUMN compass_report_configs.day_of_week IS '0=Sunday through 6=Saturday, required for weekly cadence';
COMMENT ON COLUMN compass_report_configs.day_of_month IS '1-28, required for monthly cadence';
COMMENT ON COLUMN compass_report_configs.send_time IS 'Time of day to send in the configured timezone';
COMMENT ON COLUMN compass_report_configs.lookback_days IS 'Number of days to look back for delivered tasks';
COMMENT ON COLUMN compass_report_configs.lookahead_days IS 'Number of days to look ahead for working tasks';
COMMENT ON COLUMN compass_report_configs.next_run_at IS 'Pre-computed next send time (UTC), updated after each run';
COMMENT ON COLUMN compass_report_configs.recipients IS 'Array of email addresses to receive the report';

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_compass_report_configs_contract_id
    ON compass_report_configs(contract_id);

CREATE INDEX IF NOT EXISTS idx_compass_report_configs_enabled_next_run
    ON compass_report_configs(enabled, next_run_at)
    WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_compass_report_configs_next_run_at
    ON compass_report_configs(next_run_at);

-- ============================================
-- Enable RLS (Row Level Security)
-- ============================================
ALTER TABLE compass_report_configs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read configs
CREATE POLICY "Allow authenticated read on compass_report_configs"
    ON compass_report_configs FOR SELECT
    TO authenticated
    USING (true);

-- Only admin can delete configs
CREATE POLICY "Allow admin delete on compass_report_configs"
    ON compass_report_configs FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.auth_id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- Service role (backend-proxy) handles INSERT and UPDATE — no policy needed
-- as service_role bypasses RLS

-- ============================================
-- Update trigger for updated_at
-- ============================================
-- Reuse existing function (created in earlier migrations)
CREATE TRIGGER update_compass_report_configs_updated_at
    BEFORE UPDATE ON compass_report_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
