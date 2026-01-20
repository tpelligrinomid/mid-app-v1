-- ClickUp Sync Tables Migration
-- Run this migration to create the necessary tables for ClickUp sync

-- Sync State Tracking
CREATE TABLE IF NOT EXISTS pulse_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,                    -- 'clickup', 'quickbooks', 'hubspot'
    entity_type text NOT NULL,                -- 'tasks', 'time_entries', 'users'
    sync_mode text NOT NULL DEFAULT 'incremental',
    status text DEFAULT 'idle',               -- 'idle', 'running', 'failed', 'completed'
    last_sync_at timestamptz,
    last_successful_sync_at timestamptz,
    last_full_sync_at timestamptz,
    last_modified_cursor timestamptz,         -- For incremental: "changes since"
    next_full_sync_at timestamptz,
    records_processed integer,
    error_message text,
    retry_count integer DEFAULT 0,
    config jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, entity_type)
);

-- Sync Logs (Audit Trail)
CREATE TABLE IF NOT EXISTS pulse_sync_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,
    entity_type text NOT NULL,
    sync_mode text,
    status text NOT NULL,                     -- 'started', 'success', 'failed'
    records_processed integer,
    error_message text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- ClickUp Users
CREATE TABLE IF NOT EXISTS pulse_clickup_users (
    id text PRIMARY KEY,                      -- ClickUp user ID (their ID, not UUID)
    username text,
    email text,
    full_name text,
    profile_picture text,
    initials text,                            -- Generated from name
    user_type text,                           -- 'member', 'owner', 'guest'
    is_assignable boolean DEFAULT true,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Tasks
CREATE TABLE IF NOT EXISTS pulse_tasks (
    task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id) ON DELETE SET NULL,
    clickup_task_id text UNIQUE NOT NULL,
    clickup_folder_id text,
    clickup_list_id text,
    clickup_space_id text,
    parent_task_id uuid REFERENCES pulse_tasks(task_id) ON DELETE SET NULL,
    name text NOT NULL,
    description text,
    status text,                              -- Mapped status
    status_raw text,                          -- Original ClickUp status
    list_type text,                           -- 'Deliverables', 'ToDos', 'Goals', etc.
    points numeric,
    priority text,
    priority_order integer,
    due_date timestamptz,
    start_date timestamptz,
    date_created timestamptz,
    date_updated timestamptz,
    date_done timestamptz,
    time_estimate integer,                    -- In milliseconds
    time_spent integer,                       -- In milliseconds
    -- Flags
    is_internal_only boolean DEFAULT false,
    is_growth_task boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    deletion_detected_at timestamptz,
    -- Metadata
    assignees jsonb,                          -- Array of user objects
    custom_fields jsonb,                      -- All custom fields
    tags jsonb,
    raw_data jsonb,                           -- Full ClickUp response
    -- Sync tracking
    last_seen_at timestamptz,                 -- Updated every sync
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pulse_tasks_contract_id ON pulse_tasks(contract_id);
CREATE INDEX IF NOT EXISTS idx_pulse_tasks_clickup_folder_id ON pulse_tasks(clickup_folder_id);
CREATE INDEX IF NOT EXISTS idx_pulse_tasks_status ON pulse_tasks(status);
CREATE INDEX IF NOT EXISTS idx_pulse_tasks_due_date ON pulse_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_pulse_tasks_last_seen_at ON pulse_tasks(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_pulse_tasks_is_deleted ON pulse_tasks(is_deleted);

-- Time Entries
CREATE TABLE IF NOT EXISTS pulse_time_entries (
    entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES pulse_tasks(task_id) ON DELETE SET NULL,
    clickup_entry_id text UNIQUE NOT NULL,
    clickup_task_id text,                     -- Denormalized for easier queries
    clickup_user_id text REFERENCES pulse_clickup_users(id) ON DELETE SET NULL,
    duration_ms integer NOT NULL,
    start_date timestamptz NOT NULL,
    end_date timestamptz,
    description text,
    billable boolean DEFAULT true,
    tags jsonb,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- Create indexes for time entries
CREATE INDEX IF NOT EXISTS idx_pulse_time_entries_task_id ON pulse_time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_pulse_time_entries_clickup_user_id ON pulse_time_entries(clickup_user_id);
CREATE INDEX IF NOT EXISTS idx_pulse_time_entries_start_date ON pulse_time_entries(start_date);

-- Task Status History (Audit Trail)
CREATE TABLE IF NOT EXISTS pulse_task_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES pulse_tasks(task_id) ON DELETE CASCADE,
    clickup_task_id text,
    status_from text,
    status_to text,
    changed_at timestamptz,
    changed_by text,                          -- ClickUp user ID
    raw_data jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pulse_task_status_history_task_id ON pulse_task_status_history(task_id);

-- Invoice Tasks (Special Handling)
CREATE TABLE IF NOT EXISTS pulse_invoice_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clickup_task_id text UNIQUE NOT NULL,
    contract_external_id text,                -- Links to contracts.external_id
    name text,
    status text,
    due_date date,
    points numeric,
    hours numeric,
    invoice_amount numeric,
    is_deleted boolean DEFAULT false,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pulse_invoice_tasks_contract_external_id ON pulse_invoice_tasks(contract_external_id);
CREATE INDEX IF NOT EXISTS idx_pulse_invoice_tasks_due_date ON pulse_invoice_tasks(due_date);

-- Sync Tokens (for OAuth-based integrations like QuickBooks)
CREATE TABLE IF NOT EXISTS pulse_sync_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,                -- 'clickup', 'quickbooks', 'hubspot'
    identifier text NOT NULL,             -- realm_id, workspace_id, etc.
    access_token text NOT NULL,
    refresh_token text,
    token_type text,                      -- 'personal' or 'oauth'
    expires_at timestamptz,
    is_active boolean DEFAULT true,
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, identifier)
);

-- Enable RLS on all new tables
ALTER TABLE pulse_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_clickup_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_task_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_invoice_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_sync_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow authenticated users to read sync data
-- (Backend uses service role, so these are for reference)

-- Sync state: read-only for authenticated
CREATE POLICY "Allow authenticated read sync_state" ON pulse_sync_state
    FOR SELECT TO authenticated USING (true);

-- Sync logs: read-only for authenticated
CREATE POLICY "Allow authenticated read sync_logs" ON pulse_sync_logs
    FOR SELECT TO authenticated USING (true);

-- ClickUp users: read-only for authenticated
CREATE POLICY "Allow authenticated read clickup_users" ON pulse_clickup_users
    FOR SELECT TO authenticated USING (true);

-- Tasks: authenticated can read all tasks
-- (Client filtering happens in the API layer)
CREATE POLICY "Allow authenticated read tasks" ON pulse_tasks
    FOR SELECT TO authenticated USING (true);

-- Time entries: authenticated can read all
CREATE POLICY "Allow authenticated read time_entries" ON pulse_time_entries
    FOR SELECT TO authenticated USING (true);

-- Task status history: authenticated can read all
CREATE POLICY "Allow authenticated read task_status_history" ON pulse_task_status_history
    FOR SELECT TO authenticated USING (true);

-- Invoice tasks: authenticated can read all
CREATE POLICY "Allow authenticated read invoice_tasks" ON pulse_invoice_tasks
    FOR SELECT TO authenticated USING (true);

-- Sync tokens: no public access (service role only)
-- No policy created = no access

-- Grant usage to service role for all operations
-- (Service role bypasses RLS by default)

COMMENT ON TABLE pulse_sync_state IS 'Tracks the state of sync operations for each service and entity type';
COMMENT ON TABLE pulse_sync_logs IS 'Audit trail of all sync operations';
COMMENT ON TABLE pulse_clickup_users IS 'ClickUp team members synced from the API';
COMMENT ON TABLE pulse_tasks IS 'Tasks synced from ClickUp, linked to contracts';
COMMENT ON TABLE pulse_time_entries IS 'Time tracking entries synced from ClickUp';
COMMENT ON TABLE pulse_task_status_history IS 'Audit trail of task status changes';
COMMENT ON TABLE pulse_invoice_tasks IS 'Invoice tasks from the dedicated invoice list in ClickUp';
COMMENT ON TABLE pulse_sync_tokens IS 'OAuth tokens for integrations (QuickBooks, etc.)';
