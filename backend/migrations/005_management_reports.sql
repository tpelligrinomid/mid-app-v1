-- Management Reports Migration
-- Run this in Supabase SQL Editor
--
-- Creates the pulse_management_reports table for portfolio-wide
-- frozen snapshots of all active non-hosting contracts.

-- ============================================
-- PULSE MANAGEMENT REPORTS
-- Portfolio-wide management report snapshots
-- ============================================
CREATE TABLE IF NOT EXISTS pulse_management_reports (
    report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Report metadata
    report_type text NOT NULL DEFAULT 'monthly',  -- 'monthly', 'weekly', 'quarterly'
    generated_at timestamptz NOT NULL DEFAULT now(),
    period_start date NOT NULL,
    period_end date NOT NULL,

    -- Trigger info
    triggered_by text NOT NULL DEFAULT 'manual',  -- 'manual', 'scheduled'
    triggered_by_user_id uuid REFERENCES auth.users(id),

    -- Report data
    summary jsonb,       -- { total_contracts, on_track, off_track }
    contracts jsonb,     -- Array of contract snapshots with financials, meetings, points

    -- Status
    status text NOT NULL DEFAULT 'generating',  -- 'generating', 'completed', 'failed'
    error_message text,

    -- Timestamps
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE pulse_management_reports IS 'Portfolio-wide management report snapshots with frozen financial, sentiment, and production data';
COMMENT ON COLUMN pulse_management_reports.summary IS 'Aggregated counts: { total_contracts, on_track, off_track }';
COMMENT ON COLUMN pulse_management_reports.contracts IS 'Array of per-contract snapshots with financials, meetings_90d, point_production_90d';
COMMENT ON COLUMN pulse_management_reports.triggered_by IS 'How the report was triggered: manual or scheduled';

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_pulse_management_reports_generated_at
    ON pulse_management_reports(generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pulse_management_reports_status
    ON pulse_management_reports(status);

CREATE INDEX IF NOT EXISTS idx_pulse_management_reports_report_type
    ON pulse_management_reports(report_type);

-- ============================================
-- Enable RLS (Row Level Security)
-- ============================================
ALTER TABLE pulse_management_reports ENABLE ROW LEVEL SECURITY;

-- Admin and team_member can read reports
CREATE POLICY "Allow authenticated read on pulse_management_reports"
    ON pulse_management_reports FOR SELECT
    TO authenticated
    USING (true);

-- Only admin can delete reports
CREATE POLICY "Allow admin delete on pulse_management_reports"
    ON pulse_management_reports FOR DELETE
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
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_pulse_management_reports_updated_at
    BEFORE UPDATE ON pulse_management_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
