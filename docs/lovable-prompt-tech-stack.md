# Lovable Prompt: Tech Stack in Pulse

## Context

Build a **Tech Stack** module inside Pulse that tracks (a) third-party tools MiD pays for on behalf of clients and (b) MiD's own platform modules that clients pay to use. The primary problem: when a contract churns, attached technologies stay active because nobody tracks them — MiD keeps paying vendors (cost leak) and fails to cut off client access to paid modules (revenue leak).

The solution is a typed catalog + per-contract attachments with explicit activation/deactivation dates, a "Tech Stack" tab on each contract, a bulk-edit view, and a reports surface. The current ClickUp tracking task is being abandoned; this is a fresh start.

## Core concepts

- **Technology** — a catalog entry. Two kinds, distinguished by `line_type`:
  - **`third_party_cost`** — MiD pays a vendor (HubSpot, Databox, Dealfront, Supabase, etc.). Each contract using it gets a cost line.
  - **`mid_module`** — a module MiD built (e.g. Content Ops). Clients pay MiD for it; each contract using it gets a revenue line.
- **Shared technology** — a `third_party_cost` with an agency-tier price that MiD pays as a single fixed amount regardless of client count (e.g. HubSpot agency tier). Stored with two prices: `default_client_attribution` (what we attribute per opted-in client for P&L) and `agency_fixed_cost` (what we actually pay the vendor).
- **Attachment** — a row in `contract_technologies` linking a contract to a technology, with an activation date, optional deactivation date, and optional cost/revenue overrides.
- **Active attachment** — `deactivated_date IS NULL`.
- **Churn waste** — active attachments on contracts with `contract_status = 'canceled'`. Split by `line_type`:
  - Third-party cost waste = we're still paying a vendor for a client we don't have.
  - MiD module revenue waste = the client still has access but we may not be billing (or still billing for a client who doesn't have the retainer anymore — depends on your billing flow).

## Access gating

All team members (`admin`, `team_member`) can view and edit. Clients cannot see any of this.

---

## 1. Schema (Supabase SQL)

Run in the Supabase SQL editor. Replace `REPLACE_ME_CLIENT_NAME_COL` with the real column name on the `contracts` table if it differs from `client_name`.

```sql
-- Enums
CREATE TYPE tech_line_type       AS ENUM ('third_party_cost', 'mid_module');
CREATE TYPE tech_billing_cadence AS ENUM ('monthly', 'annual', 'one_time');

-- Catalog of technologies (third-party tools + MiD modules)
CREATE TABLE technologies (
  technology_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                          text NOT NULL,
  vendor                        text,
  line_type                     tech_line_type NOT NULL,
  is_shared                     boolean NOT NULL DEFAULT false,  -- only meaningful for third_party_cost
  default_client_attribution    numeric(12,2),                   -- per contract/month; required for third_party_cost
  agency_fixed_cost             numeric(12,2),                   -- what MiD actually pays the vendor per period; used for shared tools
  default_revenue_per_contract  numeric(12,2),                   -- per contract/month; required for mid_module
  billing_cadence               tech_billing_cadence NOT NULL DEFAULT 'monthly',
  active                        boolean NOT NULL DEFAULT true,   -- catalog-level archive flag
  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT price_required CHECK (
    (line_type = 'third_party_cost' AND default_client_attribution IS NOT NULL)
    OR (line_type = 'mid_module' AND default_revenue_per_contract IS NOT NULL)
  ),
  CONSTRAINT shared_only_for_third_party CHECK (
    NOT is_shared OR line_type = 'third_party_cost'
  )
);

CREATE INDEX idx_technologies_line_type ON technologies(line_type);
CREATE INDEX idx_technologies_active    ON technologies(active) WHERE active = true;

-- Attachments: which technologies are attached to which contracts
CREATE TABLE contract_technologies (
  attachment_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id               uuid NOT NULL REFERENCES contracts(contract_id),
  technology_id             uuid NOT NULL REFERENCES technologies(technology_id),
  monthly_cost_override     numeric(12,2),   -- overrides technology.default_client_attribution for this attachment
  monthly_revenue_override  numeric(12,2),   -- overrides technology.default_revenue_per_contract for this attachment
  seat_count                int,             -- optional; when set, per-seat pricing applies: default * seat_count
  activated_date            date NOT NULL,
  deactivated_date          date,            -- NULL = still active
  notes                     text,
  created_by                uuid REFERENCES users(user_id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deactivated_after_activated CHECK (
    deactivated_date IS NULL OR deactivated_date >= activated_date
  )
);

CREATE INDEX idx_contract_tech_contract   ON contract_technologies(contract_id);
CREATE INDEX idx_contract_tech_technology ON contract_technologies(technology_id);
CREATE INDEX idx_contract_tech_active     ON contract_technologies(deactivated_date)
  WHERE deactivated_date IS NULL;

-- Prevent two active attachments of the same technology to the same contract
CREATE UNIQUE INDEX idx_contract_tech_unique_active
  ON contract_technologies(contract_id, technology_id)
  WHERE deactivated_date IS NULL;
```

---

## 2. Views (for the reports + the roll-up)

```sql
-- Per-attachment monthly financial impact, normalized to monthly
CREATE OR REPLACE VIEW contract_tech_monthly AS
SELECT
  ct.attachment_id,
  ct.contract_id,
  ct.technology_id,
  t.name,
  t.vendor,
  t.line_type,
  t.is_shared,
  t.billing_cadence,
  ct.seat_count,
  ct.activated_date,
  ct.deactivated_date,
  (ct.deactivated_date IS NULL) AS is_active,

  -- cost (third_party_cost only), normalized to monthly
  CASE
    WHEN t.line_type = 'third_party_cost' THEN
      COALESCE(
        ct.monthly_cost_override,
        t.default_client_attribution * COALESCE(ct.seat_count, 1)
      )
      / CASE t.billing_cadence
          WHEN 'monthly'  THEN 1
          WHEN 'annual'   THEN 12.0
          WHEN 'one_time' THEN 1   -- treated as current-month hit; adjust if you want one-time excluded from monthly rollups
        END
    ELSE 0
  END AS monthly_cost,

  -- revenue (mid_module only), normalized to monthly
  CASE
    WHEN t.line_type = 'mid_module' THEN
      COALESCE(
        ct.monthly_revenue_override,
        t.default_revenue_per_contract * COALESCE(ct.seat_count, 1)
      )
      / CASE t.billing_cadence
          WHEN 'monthly'  THEN 1
          WHEN 'annual'   THEN 12.0
          WHEN 'one_time' THEN 1
        END
    ELSE 0
  END AS monthly_revenue,

  ct.notes
FROM contract_technologies ct
JOIN technologies t USING (technology_id);

-- Per-contract roll-up (what the Tech Stack tab on a contract displays at top)
CREATE OR REPLACE VIEW contract_tech_rollup AS
SELECT
  contract_id,
  COUNT(*) FILTER (WHERE is_active)                                         AS active_attachments,
  SUM(monthly_cost)    FILTER (WHERE is_active)                             AS active_monthly_cost,
  SUM(monthly_revenue) FILTER (WHERE is_active)                             AS active_monthly_revenue,
  COUNT(*) FILTER (WHERE NOT is_active)                                     AS deactivated_attachments
FROM contract_tech_monthly
GROUP BY contract_id;

-- Churn waste: active attachments on canceled contracts
CREATE OR REPLACE VIEW churn_waste AS
SELECT
  ct.contract_id,
  c.REPLACE_ME_CLIENT_NAME_COL AS client_name,
  c.contract_status,
  c.contract_end_date,
  (CURRENT_DATE - c.contract_end_date)::int AS days_since_end,   -- NULL if end_date missing
  ct.attachment_id,
  ct.technology_id,
  ct.name,
  ct.vendor,
  ct.line_type,
  ct.monthly_cost,
  ct.monthly_revenue,
  ct.activated_date,
  ct.notes
FROM contract_tech_monthly ct
JOIN contracts c USING (contract_id)
WHERE ct.is_active = true
  AND c.contract_status = 'canceled';

-- Shared-tools margin: is our agency bulk deal paying off?
CREATE OR REPLACE VIEW shared_tech_spend AS
SELECT
  t.technology_id,
  t.name,
  t.vendor,
  t.agency_fixed_cost,
  COUNT(ct.attachment_id) FILTER (WHERE ct.deactivated_date IS NULL) AS active_contracts,
  COALESCE(SUM(
    CASE WHEN ct.deactivated_date IS NULL
         THEN COALESCE(
           ct.monthly_cost_override,
           t.default_client_attribution * COALESCE(ct.seat_count, 1)
         )
         ELSE 0 END
  ), 0) AS total_attributed_monthly,
  (
    COALESCE(SUM(
      CASE WHEN ct.deactivated_date IS NULL
           THEN COALESCE(
             ct.monthly_cost_override,
             t.default_client_attribution * COALESCE(ct.seat_count, 1)
           )
           ELSE 0 END
    ), 0) - COALESCE(t.agency_fixed_cost, 0)
  ) AS margin_delta   -- positive = bulk deal saves us money; negative = we're subsidizing
FROM technologies t
LEFT JOIN contract_technologies ct ON ct.technology_id = t.technology_id
WHERE t.is_shared = true
GROUP BY t.technology_id;

-- Catalog utilization: which technologies nobody's using
CREATE OR REPLACE VIEW tech_catalog_utilization AS
SELECT
  t.technology_id,
  t.name,
  t.vendor,
  t.line_type,
  t.active,
  COUNT(ct.attachment_id) FILTER (WHERE ct.deactivated_date IS NULL) AS active_contracts,
  COUNT(ct.attachment_id)                                            AS total_attachments_ever
FROM technologies t
LEFT JOIN contract_technologies ct ON ct.technology_id = t.technology_id
GROUP BY t.technology_id;

-- Aggregate spend / revenue by technology
CREATE OR REPLACE VIEW tech_aggregate AS
SELECT
  technology_id,
  name,
  vendor,
  line_type,
  SUM(monthly_cost)    FILTER (WHERE is_active) AS active_monthly_cost,
  SUM(monthly_revenue) FILTER (WHERE is_active) AS active_monthly_revenue,
  COUNT(*)             FILTER (WHERE is_active) AS active_contracts
FROM contract_tech_monthly
GROUP BY technology_id, name, vendor, line_type;
```

---

## 3. RLS policies

```sql
ALTER TABLE technologies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_technologies  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION current_user_is_team()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'team_member')
  );
$$;

CREATE POLICY "tech_read"  ON technologies
  FOR SELECT USING (current_user_is_team());
CREATE POLICY "tech_write" ON technologies
  FOR ALL    USING (current_user_is_team()) WITH CHECK (current_user_is_team());

CREATE POLICY "ct_read"  ON contract_technologies
  FOR SELECT USING (current_user_is_team());
CREATE POLICY "ct_write" ON contract_technologies
  FOR ALL    USING (current_user_is_team()) WITH CHECK (current_user_is_team());

-- Grant views to authenticated (RLS on base tables still applies)
GRANT SELECT ON contract_tech_monthly     TO authenticated;
GRANT SELECT ON contract_tech_rollup      TO authenticated;
GRANT SELECT ON churn_waste               TO authenticated;
GRANT SELECT ON shared_tech_spend         TO authenticated;
GRANT SELECT ON tech_catalog_utilization  TO authenticated;
GRANT SELECT ON tech_aggregate            TO authenticated;
```

---

## 4. Navigation

Add a new top-level item under the Pulse sidebar:

```
Pulse
├── (existing items)
├── Net Churn                 (gated)
└── Tech Stack
    ├── Catalog
    ├── Assignments
    └── Reports
```

Plus: a new **"Tech Stack" tab** on the existing Contract detail screen.

All four surfaces (Catalog, Assignments, Reports, contract tab) are visible to `admin` + `team_member` only. Clients do not see the sidebar item or the contract tab.

---

## 5. UI specification

### 5a. Catalog page (`/pulse/tech-stack/catalog`)

Purpose: manage the library of technologies + MiD modules.

Layout:
- Header with title "Tech Stack Catalog" and a **+ Add Technology** button.
- Tabs: **Third-Party Tools** | **MiD Modules** (filters `line_type`).
- Filter row: `is_shared` toggle (third-party tab only), `active` toggle, search box (matches name + vendor).
- Table columns:
  - Name
  - Vendor (third-party only)
  - Type (badge: Third-Party / MiD Module)
  - Shared (badge: Shared / Per-Contract — third-party only)
  - Default price (shows `default_client_attribution` for third-party, `default_revenue_per_contract` for module)
  - Agency fixed cost (shared tools only — otherwise "—")
  - Billing cadence
  - Active contracts (pulled from `tech_catalog_utilization.active_contracts`)
  - Active (toggle to archive)
  - Actions (Edit, Archive/Unarchive)

Add/Edit modal fields:
- Name (required)
- Vendor (optional, third-party only)
- Line type (required, dropdown)
- Is shared (checkbox, third-party only)
- Default client attribution (required for third-party) — label: "What we attribute per contract/month"
- Agency fixed cost (shared third-party only) — label: "What MiD actually pays vendor per period"
- Default revenue per contract (required for module)
- Billing cadence (dropdown)
- Notes (textarea)

On archive: set `active = false`. Existing attachments remain; the technology just can't be picked for new ones.

### 5b. Assignments page (`/pulse/tech-stack/assignments`)

Purpose: bulk view and edit of every contract-technology attachment. For the "I need to update 20 contracts at once" workflow.

Layout:
- Header with title "Tech Stack Assignments" and a **+ New Attachment** button.
- Filter bar: contract (searchable dropdown), technology (searchable dropdown), line type, status (Active / Deactivated / All), contract status (active / canceled / all).
- Table columns:
  - Contract (client name — link to contract detail)
  - Technology (link to catalog)
  - Line type (badge)
  - Monthly cost (for third-party; blank for module)
  - Monthly revenue (for module; blank for third-party)
  - Seats (if set)
  - Activated
  - Deactivated (blank for active; cell has a warning icon if contract is canceled but attachment active)
  - Notes
  - Actions (Edit, Deactivate / Reactivate, Delete)
- Sticky action bar at bottom when rows selected: "Deactivate selected" / "Delete selected".

Add/Edit drawer:
- Contract (required, searchable)
- Technology (required, searchable; shows default price inline)
- Seat count (optional)
- Monthly cost override (optional; helper text: "Leave blank to use default × seats")
- Monthly revenue override (same)
- Activated date (required, defaults to today)
- Deactivated date (optional)
- Notes (textarea)

### 5c. Contract detail — Tech Stack tab

Purpose: the per-contract roster. This is where strategists live day-to-day.

Layout:
- Summary row at top:
  - Active attachments count
  - Total monthly cost (third-party sum)
  - Total monthly revenue (MiD modules sum)
  - Net to MiD (revenue − cost)
- Toggle: "Show deactivated" (default off).
- Table of attachments — same columns as Assignments minus the Contract column, plus inline Edit / Deactivate actions.
- **+ Add Technology** button → drawer with the technology picker (same as Assignments Add form, contract prefilled).

### 5d. Cancellation prompt

When a user changes a contract's status to `canceled` (or sets `contract_end_date` on an active contract), show a modal:

> **Review attached technologies**
> This contract has N active attachments. Would you like to deactivate any of them?
>
> (Checklist of all active attachments with columns: Name, Monthly cost/revenue, Deactivate checkbox pre-checked)
>
> [Deactivation date: __today__]  [Skip]  [Deactivate Selected]

Chosen attachments get `deactivated_date` set to the user-selected date. Skipping is allowed — they'll still show up in the Churn Waste report until deactivated.

### 5e. Reports page (`/pulse/tech-stack/reports`)

Tabs:

**1. Churn Waste (default)**
- Subtitle: "Active attachments on canceled contracts — cost leak and revenue leak."
- Summary cards: total monthly cost leak, total monthly revenue leak, count of affected contracts.
- Table (driven by `churn_waste` view):
  - Client name
  - Technology
  - Vendor
  - Line type (badge)
  - Monthly cost / revenue
  - Activated date
  - Days since contract end (sort desc by default; blank if `contract_end_date` is null with a warning icon)
  - Action: **Deactivate now** (sets `deactivated_date = today`)

**2. MiD Module Revenue**
- Filter: only `line_type = 'mid_module'` attachments.
- Summary cards: total active MRR from modules, count of contracts per module.
- Table: module name, count of active contracts, monthly revenue, list of canceled contracts still attached (the revenue-leak cases).

**3. Agency Margin on Shared Tools** (from `shared_tech_spend`)
- Subtitle: "Are our bulk deals paying off?"
- Table per shared tool: name, agency fixed cost, active contracts, total attributed monthly, margin delta (green if positive, red if negative).

**4. Aggregate Spend / Revenue by Technology** (from `tech_aggregate`)
- Table: technology, type, vendor, active contracts, monthly cost, monthly revenue.
- Sort by monthly cost desc.

**5. Catalog Utilization** (from `tech_catalog_utilization`)
- Subtitle: "Technologies nobody's using — candidates to drop from the catalog."
- Table: technology, type, active flag, active contracts, total attachments ever. Filter for `active_contracts = 0`.

All tables: export to CSV.

---

## 6. Acceptance checklist

- [ ] All tables, enums, views, and policies created.
- [ ] Adding a technology with missing required price for its type is rejected (CHECK constraint).
- [ ] `is_shared = true` on a `mid_module` is rejected (CHECK constraint).
- [ ] Attaching the same technology to the same contract twice (both active) is rejected.
- [ ] Deactivating an attachment preserves the row (audit trail) and excludes it from active rollups.
- [ ] Contract Tech Stack tab summary updates in real time after add/edit/deactivate.
- [ ] Cancellation prompt fires when `contract_status` flips to `canceled`.
- [ ] Churn Waste report lists only active attachments on canceled contracts; Deactivate-now action works.
- [ ] Shared-tool margin is positive for a shared tool with agency_fixed_cost = $1500 and 40 active contracts at $50 attribution each ($2000 − $1500 = $500).
- [ ] Annual-cadence technologies report as (amount / 12) in monthly views.
- [ ] Clients do not see the sidebar item, can't hit the routes, and can't read `technologies` or `contract_technologies`.
- [ ] CSV export works on all report tables.

---

## 7. Notes & flagged assumptions

- **Client name column on `contracts`** — the churn_waste view uses `REPLACE_ME_CLIENT_NAME_COL`; swap for the real column.
- **Canceled-contract detection** — uses `contract_status = 'canceled'`. If you also treat `contract_end_date < today` as "effectively canceled," adjust the `churn_waste` view.
- **One-time billing cadence** — treated as a current-month hit in the monthly views. If you'd rather exclude one-time items from monthly rollups, change the CASE expression to return NULL or 0 for `one_time`.
- **Seat count** — optional. When NULL, treated as 1. When set, multiplies the default price. Overrides bypass seat math entirely.
- **Backfill** — per the scope, start fresh; no import of the legacy ClickUp task state.
- **Historical cost reporting** — the current views are point-in-time (what's active *now*). If you later want "what did we spend in March 2026" historically, you'd query attachments where `activated_date <= month_end` AND (`deactivated_date IS NULL OR deactivated_date > month_start`). That's a future enhancement, not in V1.
