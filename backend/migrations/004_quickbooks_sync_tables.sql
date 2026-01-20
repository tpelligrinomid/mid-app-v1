-- QuickBooks Sync Tables Migration
-- Run this in Supabase SQL Editor

-- ============================================
-- PULSE INVOICES
-- Stores synchronized invoices from QuickBooks
-- ============================================
CREATE TABLE IF NOT EXISTS pulse_invoices (
    invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- QuickBooks identifiers
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    quickbooks_customer_id text,

    -- Contract link (matched via external_id from memo parsing)
    contract_id uuid REFERENCES contracts(contract_id),

    -- Invoice details
    doc_number text,
    customer_name text,
    transaction_date date,
    due_date date,
    total_amount decimal(12,2),
    balance decimal(12,2),

    -- Parsed from memo fields
    contract_external_id text,  -- e.g., "MID20250001" parsed from memo
    points integer,              -- Points value parsed from memo
    memo_raw text,               -- Original memo text

    -- Status
    status text DEFAULT 'open', -- open, paid, void
    is_deleted boolean DEFAULT false,

    -- Metadata
    raw_data jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_synced_at timestamptz DEFAULT now(),

    -- Unique constraint on QB ID + realm
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Indexes for pulse_invoices
CREATE INDEX IF NOT EXISTS idx_pulse_invoices_contract_id ON pulse_invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_pulse_invoices_realm_id ON pulse_invoices(quickbooks_realm_id);
CREATE INDEX IF NOT EXISTS idx_pulse_invoices_customer_id ON pulse_invoices(quickbooks_customer_id);
CREATE INDEX IF NOT EXISTS idx_pulse_invoices_transaction_date ON pulse_invoices(transaction_date);
CREATE INDEX IF NOT EXISTS idx_pulse_invoices_contract_external_id ON pulse_invoices(contract_external_id);

-- ============================================
-- PULSE CREDIT MEMOS
-- Stores synchronized credit memos from QuickBooks
-- ============================================
CREATE TABLE IF NOT EXISTS pulse_credit_memos (
    credit_memo_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- QuickBooks identifiers
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    quickbooks_customer_id text,

    -- Contract link (matched via external_id from memo parsing)
    contract_id uuid REFERENCES contracts(contract_id),

    -- Credit memo details
    doc_number text,
    customer_name text,
    transaction_date date,
    total_amount decimal(12,2),
    balance decimal(12,2),

    -- Parsed from memo fields
    contract_external_id text,  -- e.g., "MID20250001" parsed from memo
    points integer,              -- Points value parsed from memo
    memo_raw text,               -- Original memo text

    -- Status
    is_deleted boolean DEFAULT false,

    -- Metadata
    raw_data jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_synced_at timestamptz DEFAULT now(),

    -- Unique constraint on QB ID + realm
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Indexes for pulse_credit_memos
CREATE INDEX IF NOT EXISTS idx_pulse_credit_memos_contract_id ON pulse_credit_memos(contract_id);
CREATE INDEX IF NOT EXISTS idx_pulse_credit_memos_realm_id ON pulse_credit_memos(quickbooks_realm_id);
CREATE INDEX IF NOT EXISTS idx_pulse_credit_memos_customer_id ON pulse_credit_memos(quickbooks_customer_id);
CREATE INDEX IF NOT EXISTS idx_pulse_credit_memos_transaction_date ON pulse_credit_memos(transaction_date);

-- ============================================
-- PULSE PAYMENTS
-- Stores synchronized payments from QuickBooks
-- ============================================
CREATE TABLE IF NOT EXISTS pulse_payments (
    payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- QuickBooks identifiers
    quickbooks_id text NOT NULL,
    quickbooks_realm_id text NOT NULL,
    quickbooks_customer_id text,

    -- Contract link (if determinable from linked invoices)
    contract_id uuid REFERENCES contracts(contract_id),

    -- Payment details
    customer_name text,
    payment_date date,
    payment_method text,
    total_amount decimal(12,2),
    reference_number text,

    -- Linked invoices (array of QB invoice IDs with amounts)
    linked_invoices jsonb DEFAULT '[]',

    -- Status
    is_deleted boolean DEFAULT false,

    -- Metadata
    raw_data jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_synced_at timestamptz DEFAULT now(),

    -- Unique constraint on QB ID + realm
    UNIQUE(quickbooks_id, quickbooks_realm_id)
);

-- Indexes for pulse_payments
CREATE INDEX IF NOT EXISTS idx_pulse_payments_contract_id ON pulse_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_pulse_payments_realm_id ON pulse_payments(quickbooks_realm_id);
CREATE INDEX IF NOT EXISTS idx_pulse_payments_customer_id ON pulse_payments(quickbooks_customer_id);
CREATE INDEX IF NOT EXISTS idx_pulse_payments_payment_date ON pulse_payments(payment_date);

-- ============================================
-- Enable RLS (Row Level Security)
-- ============================================
ALTER TABLE pulse_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_credit_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Allow authenticated users to read
CREATE POLICY "Allow authenticated read on pulse_invoices"
    ON pulse_invoices FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read on pulse_credit_memos"
    ON pulse_credit_memos FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read on pulse_payments"
    ON pulse_payments FOR SELECT
    TO authenticated
    USING (true);

-- ============================================
-- Update triggers for updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_pulse_invoices_updated_at
    BEFORE UPDATE ON pulse_invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pulse_credit_memos_updated_at
    BEFORE UPDATE ON pulse_credit_memos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pulse_payments_updated_at
    BEFORE UPDATE ON pulse_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Comments
-- ============================================
COMMENT ON TABLE pulse_invoices IS 'QuickBooks invoices synced from active contracts';
COMMENT ON TABLE pulse_credit_memos IS 'QuickBooks credit memos synced from active contracts';
COMMENT ON TABLE pulse_payments IS 'QuickBooks payments synced from active contracts';

COMMENT ON COLUMN pulse_invoices.contract_external_id IS 'Contract number parsed from memo (e.g., MID20250001)';
COMMENT ON COLUMN pulse_invoices.points IS 'Points value parsed from memo field';
COMMENT ON COLUMN pulse_credit_memos.points IS 'Points credited, parsed from memo field';
