-- ============================================================================
-- MiD Platform Database Schema
-- ============================================================================
-- Generated from: platform-rebuild-plan.md
-- Last updated: January 2026
--
-- EXECUTION ORDER:
-- 1. Extensions
-- 2. Core Tables (no dependencies)
-- 3. User Tables
-- 4. Pulse Tables
-- 5. Compass Tables
-- 6. Future Module Tables (Content, SEO)
-- 7. System Tables
-- 8. Materialized Views
-- 9. Indexes
-- ============================================================================

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";      -- For uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- For gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";         -- For AI embeddings (if using pgvector)

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE contract_status_enum AS ENUM ('pending', 'active', 'canceled', 'inactive');
CREATE TYPE contract_type_enum AS ENUM ('recurring', 'project');
CREATE TYPE payment_type_enum AS ENUM ('invoice', 'credit_card');
CREATE TYPE engagement_type_enum AS ENUM ('strategic', 'tactical');
CREATE TYPE customer_display_type_enum AS ENUM ('points', 'hours', 'none');
CREATE TYPE priority_tier AS ENUM ('Tier 1', 'Tier 2', 'Tier 3', 'Tier 4');

-- ============================================================================
-- CORE TABLES (Shared by Pulse and Compass)
-- ============================================================================

-- Organizations (renamed from agencies)
CREATE TABLE organizations (
    organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    quickbooks_realm_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Accounts
CREATE TABLE accounts (
    account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES organizations(organization_id),
    name text NOT NULL,
    status text NOT NULL,
    hubspot_account_id text,
    hubspot_owner_id text,
    industry text,
    website text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- PULSE TABLES - ClickUp Users (needed before contracts for FK)
-- ============================================================================

-- ClickUp users (synced from ClickUp for manager assignment)
CREATE TABLE pulse_clickup_users (
    id text PRIMARY KEY, -- ClickUp user ID (not uuid, uses their ID)
    username text,
    email text,
    full_name text,
    profile_picture text,
    user_type text, -- 'member', 'owner', 'guest'
    is_assignable boolean DEFAULT true, -- Only member/owner should be true
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- CORE TABLES (continued)
-- ============================================================================

-- Contracts
CREATE TABLE contracts (
    contract_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid REFERENCES accounts(account_id),
    external_id text UNIQUE, -- For external references (e.g., "MID-2025-001")
    contract_name text NOT NULL,
    contract_status contract_status_enum NOT NULL,
    contract_type contract_type_enum NOT NULL,
    engagement_type engagement_type_enum,
    -- Financial fields
    amount numeric, -- Monthly recurring revenue
    payment_type payment_type_enum,
    monthly_points_allotment integer, -- For points burden calculation
    dollar_per_hour numeric, -- Hourly billing rate
    -- Date fields
    contract_start_date date NOT NULL,
    contract_end_date date,
    contract_renewal_date date,
    next_invoice_date date, -- Next scheduled invoice date
    -- Term fields
    initial_term_length integer, -- Initial term length in months
    subsequent_term_length integer, -- Renewal term length in months
    notice_period integer, -- Cancellation notice period in days
    autorenewal boolean DEFAULT false, -- Whether contract auto-renews
    -- Assignment fields (references ClickUp users)
    account_manager text REFERENCES pulse_clickup_users(id),
    team_manager text REFERENCES pulse_clickup_users(id),
    -- Integration fields
    clickup_folder_id text,
    quickbooks_customer_id text,
    quickbooks_business_unit_id text,
    deal_id text, -- HubSpot deal reference
    slack_channel_internal text, -- Internal team Slack channel ID
    slack_channel_external text, -- External/client Slack channel ID
    -- Display settings
    customer_display_type customer_display_type_enum,
    hosting boolean DEFAULT false, -- Hosting-only contracts (excluded from some views)
    priority priority_tier,
    -- Description
    contract_description text, -- Description of the contract
    -- Timestamps
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Contract Modules (feature toggles)
CREATE TABLE contract_modules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    module_type text NOT NULL, -- 'core' or 'app'
    module_name text NOT NULL, -- 'pulse', 'compass', 'content_hub', 'seo', 'podcast', etc.
    enabled boolean DEFAULT false,
    client_visible boolean DEFAULT false, -- Can clients see this module?
    client_collaborative boolean DEFAULT false, -- Can clients interact?
    enabled_at timestamptz,
    config jsonb, -- Module-specific settings
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, module_name)
);

-- ============================================================================
-- USER TABLES
-- ============================================================================

-- User profiles (for all users: admins, team members, clients)
CREATE TABLE users (
    user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id uuid UNIQUE, -- Links to Supabase auth.users
    email text NOT NULL UNIQUE,
    full_name text,
    role text NOT NULL, -- 'admin', 'team_member', 'client'
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'active', 'inactive'
    company_name text, -- For client users
    clickup_user_id text REFERENCES pulse_clickup_users(id), -- For MiD team members
    invited_at timestamptz,
    invited_by uuid, -- Will reference users(user_id), added after table exists
    activated_at timestamptz,
    last_login timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add self-referencing FK after table exists
ALTER TABLE users ADD CONSTRAINT fk_users_invited_by
    FOREIGN KEY (invited_by) REFERENCES users(user_id);

-- User contract access (for clients)
CREATE TABLE user_contract_access (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(user_id),
    contract_id uuid REFERENCES contracts(contract_id),
    access_level text DEFAULT 'view', -- 'view', 'edit', 'admin'
    granted_at timestamptz DEFAULT now(),
    granted_by uuid REFERENCES users(user_id),
    UNIQUE(user_id, contract_id)
);

-- User invitations
CREATE TABLE user_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    role text NOT NULL DEFAULT 'client',
    contract_id uuid REFERENCES contracts(contract_id), -- For client invitations
    invited_by uuid REFERENCES users(user_id),
    token text UNIQUE,
    expires_at timestamptz,
    status text DEFAULT 'pending', -- 'pending', 'accepted', 'expired'
    created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- PULSE MODULE TABLES
-- ============================================================================

-- Sync state tracking (for incremental syncs)
CREATE TABLE pulse_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL, -- 'clickup', 'quickbooks', 'hubspot'
    entity_type text NOT NULL, -- 'tasks', 'time_entries', 'invoices', 'users'
    sync_mode text NOT NULL DEFAULT 'incremental', -- 'full', 'incremental'
    status text DEFAULT 'idle', -- 'idle', 'running', 'failed'
    last_sync_at timestamptz,
    last_successful_sync_at timestamptz,
    last_full_sync_at timestamptz,
    last_modified_cursor timestamptz, -- For incremental: "changes since this time"
    next_full_sync_at timestamptz, -- Scheduled weekly full refresh
    records_processed integer,
    error_message text,
    retry_count integer DEFAULT 0,
    config jsonb, -- Sync-specific settings
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, entity_type)
);

-- Sync logs
CREATE TABLE pulse_sync_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,
    entity_type text NOT NULL,
    sync_mode text, -- 'full', 'incremental'
    status text NOT NULL, -- 'started', 'success', 'failed'
    records_processed integer,
    error_message text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- Sync tokens (OAuth for integrations)
CREATE TABLE pulse_sync_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL, -- 'clickup', 'quickbooks', 'hubspot'
    identifier text NOT NULL, -- realm_id, workspace_id, etc.
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamptz,
    is_active boolean DEFAULT true,
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, identifier)
);

-- Tasks (synced from ClickUp)
CREATE TABLE pulse_tasks (
    task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    clickup_task_id text UNIQUE NOT NULL,
    parent_task_id uuid REFERENCES pulse_tasks(task_id),
    name text NOT NULL,
    description text,
    status text, -- 'not_started', 'working', 'delivered', etc.
    points numeric,
    due_date timestamptz,
    start_date timestamptz,
    date_done timestamptz,
    -- Flags
    is_internal_only boolean DEFAULT false,
    is_growth_task boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    -- ClickUp metadata
    clickup_list_id text,
    clickup_folder_id text,
    clickup_space_id text,
    assignees jsonb,
    custom_fields jsonb,
    raw_data jsonb,
    -- Sync tracking
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Time entries (synced from ClickUp)
CREATE TABLE pulse_time_entries (
    entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES pulse_tasks(task_id),
    clickup_entry_id text UNIQUE NOT NULL,
    clickup_user_id text REFERENCES pulse_clickup_users(id),
    duration_ms integer NOT NULL,
    start_date timestamptz NOT NULL,
    end_date timestamptz,
    description text,
    billable boolean DEFAULT true,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- Invoices (synced from QuickBooks)
CREATE TABLE pulse_invoices (
    invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    doc_number text,
    amount numeric NOT NULL,
    balance numeric,
    status text,
    invoice_date date,
    due_date date,
    points numeric,
    hours numeric,
    invoice_link text,
    memo text,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Credit memos (synced from QuickBooks)
CREATE TABLE pulse_credit_memos (
    credit_memo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    doc_number text,
    amount numeric,
    remaining_credit numeric,
    credit_date date,
    points numeric,
    memo text,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Payments (synced from QuickBooks)
CREATE TABLE pulse_payments (
    payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    amount numeric NOT NULL,
    payment_date date,
    payment_method text,
    linked_invoices jsonb,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- ============================================================================
-- COMPASS MODULE TABLES
-- ============================================================================

-- Strategy and activity notes
-- Notes can be manual (team-written) or auto-generated from meeting transcripts
CREATE TABLE compass_notes (
    note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    note_type text NOT NULL, -- 'meeting', 'abm', 'paid', 'content', 'web', 'status', 'strategy'
    title text NOT NULL,
    content_raw text,
    content_structured jsonb, -- Normalized/parsed content
    note_date date NOT NULL,
    week_number integer,
    year integer,
    status text DEFAULT 'draft', -- 'draft', 'published', 'archived'
    -- Meeting integration (for auto-generated meeting notes)
    meeting_id uuid REFERENCES compass_meetings(meeting_id), -- Links to source transcript, NULL for manual notes
    action_items jsonb, -- Extracted action items: [{"item": "...", "assignee": "...", "due": "..."}, ...]
    is_auto_generated boolean DEFAULT false, -- TRUE if created by AI from transcript
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Deliverables
CREATE TABLE compass_deliverables (
    deliverable_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    title text NOT NULL,
    description text,
    deliverable_type text, -- 'plan', 'roadmap', 'research', 'presentation', 'other'
    status text DEFAULT 'in_progress', -- 'planned', 'in_progress', 'review', 'delivered', 'archived'
    version text DEFAULT '1.0',
    drive_url text, -- Link to Google Drive
    due_date date,
    delivered_date date,
    tags text[],
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Deliverable versions (history)
CREATE TABLE compass_deliverable_versions (
    version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deliverable_id uuid REFERENCES compass_deliverables(deliverable_id),
    version_number text NOT NULL,
    drive_url text,
    change_summary text,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now()
);

-- Assets (files, images, documents)
CREATE TABLE compass_assets (
    asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    asset_type text NOT NULL, -- 'image', 'document', 'video', 'audio', 'other'
    title text NOT NULL,
    description text,
    file_name text,
    file_path text, -- Supabase storage path
    file_size_bytes bigint,
    mime_type text,
    external_url text,
    thumbnail_url text,
    tags text[],
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Meetings / Transcript Archive (from Fireflies or other sources)
-- Raw transcript storage. Processed summary and action items live in compass_notes
-- with meeting_id linking back to this record.
CREATE TABLE compass_meetings (
    meeting_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    meeting_date timestamptz NOT NULL,
    source text DEFAULT 'fireflies', -- 'fireflies', 'manual', etc.
    external_id text, -- Fireflies meeting ID or other external reference
    title text,
    participants text[],
    duration_seconds integer,
    recording_url text,
    transcript jsonb, -- Full transcript content
    sentiment jsonb, -- AI-generated sentiment analysis: {label, confidence, bullets, highlights, topics, model, version, generated_at}
    raw_metadata jsonb, -- Additional metadata from source
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Knowledge chunks (for AI/RAG)
CREATE TABLE compass_knowledge (
    chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    source_type text NOT NULL, -- 'note', 'deliverable', 'meeting', 'document'
    source_id uuid, -- Reference to source record
    title text,
    content text NOT NULL,
    chunk_index integer DEFAULT 0,
    embedding vector(1536), -- OpenAI embeddings (requires pgvector extension)
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Status reports
CREATE TABLE compass_reports (
    report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    report_type text NOT NULL, -- 'weekly', 'monthly', 'leadership'
    period_start date,
    period_end date,
    subject text,
    content_html text,
    content_text text,
    payload jsonb, -- Structured report data
    recipients text[],
    send_status text DEFAULT 'draft', -- 'draft', 'queued', 'sent', 'failed'
    sent_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- CONTENT MODULE TABLES (Compass Content Module)
-- ============================================================================

-- Content types — What kind of content (blog, newsletter, video, etc.)
CREATE TABLE content_types (
    type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),  -- NULL = global default
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, slug)
);

-- Content categories — Organizational grouping (client-specific taxonomy)
CREATE TABLE content_categories (
    category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),  -- NULL = global default
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    color text,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, slug)
);

-- Content attribute definitions — Custom metadata fields per contract
CREATE TABLE content_attribute_definitions (
    attribute_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    name text NOT NULL,
    slug text NOT NULL,
    field_type text NOT NULL,  -- 'single_select' | 'multi_select' | 'boolean' | 'text'
    options jsonb,
    is_required boolean DEFAULT false,
    applies_to text DEFAULT 'both',  -- 'ideas' | 'assets' | 'both'
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, slug)
);

-- Content ideas — Lightweight ideation items
CREATE TABLE content_ideas (
    idea_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    title text NOT NULL,
    description text,
    content_type_id uuid REFERENCES content_types(type_id),
    category_id uuid REFERENCES content_categories(category_id),
    source text DEFAULT 'manual',    -- 'manual' | 'ai_generated'
    status text DEFAULT 'idea',      -- 'idea' | 'approved' | 'rejected'
    priority integer,                -- 1-5 or null
    target_date date,
    custom_attributes jsonb,
    tags text[],
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Content assets — Full content items in production/published
CREATE TABLE content_assets (
    asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(contract_id),
    idea_id uuid REFERENCES content_ideas(idea_id),
    title text NOT NULL,
    description text,
    content_type_id uuid REFERENCES content_types(type_id),
    category_id uuid REFERENCES content_categories(category_id),
    content_body text,
    content_structured jsonb,
    status text DEFAULT 'draft',     -- 'draft' | 'in_production' | 'review' | 'approved' | 'published'
    file_path text,
    file_name text,
    file_size_bytes bigint,
    mime_type text,
    external_url text,
    clickup_task_id text,
    tags text[],
    custom_attributes jsonb,
    published_date date,
    metadata jsonb,
    created_by uuid REFERENCES users(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- SEO MODULE TABLES (Future - SEO Agent App)
-- ============================================================================

-- Tracked keywords
CREATE TABLE seo_keywords (
    keyword_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    keyword text NOT NULL,
    search_volume integer,
    difficulty integer,
    intent text, -- 'informational', 'commercial', 'transactional', 'navigational'
    is_primary boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, keyword)
);

-- Ranking history
CREATE TABLE seo_rankings (
    ranking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id uuid REFERENCES seo_keywords(keyword_id),
    rank_position integer,
    url text,
    check_date date NOT NULL,
    search_engine text DEFAULT 'google',
    location text,
    created_at timestamptz DEFAULT now()
);

-- SEO competitors
CREATE TABLE seo_competitors (
    competitor_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    domain text NOT NULL,
    name text,
    blog_url text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    UNIQUE(contract_id, domain)
);

-- Competitor blog posts
CREATE TABLE seo_competitor_posts (
    post_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id uuid REFERENCES seo_competitors(competitor_id),
    url text NOT NULL UNIQUE,
    title text,
    published_date date,
    word_count integer,
    topics text[],
    summary text,
    crawled_at timestamptz DEFAULT now()
);

-- Competitor events
CREATE TABLE seo_competitor_events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor_id uuid REFERENCES seo_competitors(competitor_id),
    event_type text, -- 'webinar', 'conference', 'product_launch', etc.
    title text NOT NULL,
    event_date date,
    url text,
    description text,
    discovered_at timestamptz DEFAULT now()
);

-- AI recommendations
CREATE TABLE seo_recommendations (
    recommendation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    recommendation_type text, -- 'content_gap', 'keyword_opportunity', 'technical', 'competitor_insight'
    title text NOT NULL,
    description text,
    priority text DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    status text DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'completed'
    source_data jsonb,
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz
);

-- ============================================================================
-- AUDIT & SYSTEM TABLES
-- ============================================================================

-- Audit logs
CREATE TABLE audit_logs (
    log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    action text NOT NULL, -- 'insert', 'update', 'delete'
    old_values jsonb,
    new_values jsonb,
    changed_by uuid REFERENCES users(user_id),
    changed_at timestamptz DEFAULT now(),
    ip_address text,
    user_agent text
);

-- System configuration
CREATE TABLE system_config (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text,
    updated_at timestamptz DEFAULT now(),
    updated_by uuid REFERENCES users(user_id)
);

-- ============================================================================
-- MATERIALIZED VIEWS
-- ============================================================================

-- Contract points summary (refreshed after ClickUp/QuickBooks sync)
CREATE MATERIALIZED VIEW contract_points_summary AS
SELECT
    c.contract_id,
    c.contract_name,
    c.monthly_points_allotment,
    COALESCE(inv.points_purchased, 0) as points_purchased,
    COALESCE(cm.points_credited, 0) as points_credited,
    COALESCE(delivered.points_delivered, 0) as points_delivered,
    COALESCE(working.points_working, 0) as points_working,
    (COALESCE(inv.points_purchased, 0) + COALESCE(cm.points_credited, 0)
     - COALESCE(delivered.points_delivered, 0)) as points_balance,
    (COALESCE(inv.points_purchased, 0) + COALESCE(cm.points_credited, 0)
     - COALESCE(delivered.points_delivered, 0)
     - (1.5 * COALESCE(c.monthly_points_allotment, 0))) as points_burden
FROM contracts c
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_purchased
    FROM pulse_invoices GROUP BY contract_id
) inv ON c.contract_id = inv.contract_id
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_credited
    FROM pulse_credit_memos GROUP BY contract_id
) cm ON c.contract_id = cm.contract_id
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_delivered
    FROM pulse_tasks WHERE status = 'delivered' GROUP BY contract_id
) delivered ON c.contract_id = delivered.contract_id
LEFT JOIN (
    SELECT contract_id, SUM(points) as points_working
    FROM pulse_tasks WHERE status = 'working' GROUP BY contract_id
) working ON c.contract_id = working.contract_id
WHERE c.contract_status = 'active' AND c.hosting = false;

-- Create unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_contract_points_summary_contract_id
ON contract_points_summary(contract_id);

-- Contract performance view (used by dashboards)
CREATE MATERIALIZED VIEW contract_performance_view AS
SELECT
    c.contract_id,
    c.contract_name,
    c.external_id as contract_number,
    c.contract_type,
    c.engagement_type,
    c.priority,
    c.account_manager,
    c.team_manager,
    c.contract_status,
    c.amount as mrr,
    c.dollar_per_hour,
    c.monthly_points_allotment,
    c.payment_type,
    c.contract_start_date,
    c.contract_end_date,
    c.contract_renewal_date,
    c.next_invoice_date,
    c.initial_term_length,
    c.subsequent_term_length,
    c.notice_period,
    c.autorenewal,
    c.deal_id,
    c.slack_channel_internal,
    c.slack_channel_external,
    c.customer_display_type,
    c.contract_description,
    cps.points_purchased,
    cps.points_credited,
    cps.points_delivered,
    cps.points_working,
    cps.points_balance,
    cps.points_burden,
    CASE WHEN cps.points_burden <= 0 THEN 'on-track' ELSE 'off-track' END as delivery_status,
    am.username as account_manager_name,
    am.full_name as account_manager_full_name,
    tm.username as team_manager_name,
    tm.full_name as team_manager_full_name
FROM contracts c
LEFT JOIN contract_points_summary cps ON c.contract_id = cps.contract_id
LEFT JOIN pulse_clickup_users am ON c.account_manager = am.id
LEFT JOIN pulse_clickup_users tm ON c.team_manager = tm.id
WHERE c.contract_status = 'active' AND c.hosting = false;

-- Create unique index for CONCURRENTLY refresh
CREATE UNIQUE INDEX idx_contract_performance_view_contract_id
ON contract_performance_view(contract_id);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Core table indexes
CREATE INDEX idx_accounts_organization_id ON accounts(organization_id);
CREATE INDEX idx_contracts_account_id ON contracts(account_id);
CREATE INDEX idx_contracts_status ON contracts(contract_status);
CREATE INDEX idx_contracts_clickup_folder ON contracts(clickup_folder_id);
CREATE INDEX idx_contract_modules_contract_id ON contract_modules(contract_id);

-- User table indexes
CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_clickup_user_id ON users(clickup_user_id);
CREATE INDEX idx_user_contract_access_user_id ON user_contract_access(user_id);
CREATE INDEX idx_user_contract_access_contract_id ON user_contract_access(contract_id);

-- Pulse table indexes
CREATE INDEX idx_pulse_tasks_contract_id ON pulse_tasks(contract_id);
CREATE INDEX idx_pulse_tasks_clickup_folder ON pulse_tasks(clickup_folder_id);
CREATE INDEX idx_pulse_tasks_status ON pulse_tasks(status);
CREATE INDEX idx_pulse_tasks_date_done ON pulse_tasks(date_done);
CREATE INDEX idx_pulse_time_entries_task_id ON pulse_time_entries(task_id);
CREATE INDEX idx_pulse_invoices_contract_id ON pulse_invoices(contract_id);
CREATE INDEX idx_pulse_credit_memos_contract_id ON pulse_credit_memos(contract_id);
CREATE INDEX idx_pulse_payments_contract_id ON pulse_payments(contract_id);
CREATE INDEX idx_pulse_sync_logs_service ON pulse_sync_logs(service, entity_type);
CREATE INDEX idx_pulse_sync_logs_started_at ON pulse_sync_logs(started_at DESC);

-- Compass table indexes
CREATE INDEX idx_compass_notes_contract_id ON compass_notes(contract_id);
CREATE INDEX idx_compass_notes_date ON compass_notes(note_date DESC);
CREATE INDEX idx_compass_notes_meeting_id ON compass_notes(meeting_id);
CREATE INDEX idx_compass_deliverables_contract_id ON compass_deliverables(contract_id);
CREATE INDEX idx_compass_meetings_contract_id ON compass_meetings(contract_id);
CREATE INDEX idx_compass_meetings_date ON compass_meetings(meeting_date DESC);
CREATE INDEX idx_compass_knowledge_contract_id ON compass_knowledge(contract_id);
CREATE INDEX idx_compass_reports_contract_id ON compass_reports(contract_id);

-- Content module indexes
CREATE INDEX idx_content_types_contract ON content_types(contract_id);
CREATE INDEX idx_content_categories_contract ON content_categories(contract_id);
CREATE INDEX idx_content_attr_defs_contract ON content_attribute_definitions(contract_id);
CREATE INDEX idx_content_ideas_contract ON content_ideas(contract_id);
CREATE INDEX idx_content_ideas_status ON content_ideas(status);
CREATE INDEX idx_content_ideas_target_date ON content_ideas(target_date);
CREATE INDEX idx_content_assets_contract ON content_assets(contract_id);
CREATE INDEX idx_content_assets_status ON content_assets(status);
CREATE INDEX idx_content_assets_idea ON content_assets(idea_id);
CREATE INDEX idx_content_assets_published ON content_assets(published_date);

-- Audit indexes
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_changed_at ON audit_logs(changed_at DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pulse_tasks_updated_at BEFORE UPDATE ON pulse_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pulse_invoices_updated_at BEFORE UPDATE ON pulse_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compass_notes_updated_at BEFORE UPDATE ON compass_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compass_deliverables_updated_at BEFORE UPDATE ON compass_deliverables
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- REFRESH MATERIALIZED VIEWS (call after sync operations)
-- ============================================================================

-- Example: Refresh all views (run after sync completes)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY contract_points_summary;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY contract_performance_view;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
