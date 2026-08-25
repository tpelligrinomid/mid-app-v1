# Lovable Prompt: Net Churn Report in Pulse

## Context

Build a **Net Churn Report** page inside the Pulse module. It displays monthly MRR movement as a horizontally-scrolling grid (similar to the existing Cash Flow Projections view), with one column per month. Each non-derived cell is clickable to reveal the underlying contract/amendment records that produced the number. The page is gated to a subset of users.

The report replaces a manual Google Sheet ("Monthly Data Tracking - Leadership - 2025") that finance currently maintains by hand. In the new model, users curate the monthly buckets by picking from system-suggested candidates (new contracts, signed amendments, canceled contracts) or adding manual entries. Beginning-of-month MRR auto-ties to prior month's Ending MRR.

## Core concepts

- **Beginning MRR** — seeded once (Jan 2025 = $235,118); every subsequent month's Beginning = prior month's Ending. Enforced by a SQL view, never user-editable.
- **Net New MRR** — sum of new recurring contracts activated that month.
- **Expansion MRR** — sum of signed positive amendments that month.
- **Lost MRR** — sum of (signed negative amendments + canceled contracts) that month, expressed as a positive number.
- **Net Churn** = Lost − Expansion. (Note: excludes Net New, matching the legacy formula.)
- **Net Churn Rate** = Net Churn / Beginning MRR.
- **Ending MRR** = Beginning + Net New + Expansion − Lost + Manual Adjustment.
- **Manual Adjustment** — escape hatch for reclassifications / mid-month corrections the automated sources don't cover (signed amount).

Every row in a monthly bucket is either:
- A **pick** from `contracts` (new contract or cancellation) or `amendments` (signed, non-zero amount), OR
- A **manual** entry with a required note.

Picks can be toggled `excluded = true` to handle double-counting (e.g. a churn recorded both as a canceled contract *and* a negative amendment — user picks one as authoritative).

---

## 1. Schema (Supabase SQL)

Run the following in the Supabase SQL editor. Replace `REPLACE_ME_CLIENT_NAME_COL` with the actual client/company name column on the `contracts` table if it differs from `client_name`.

```sql
-- Enum types
CREATE TYPE mrr_impact_type AS ENUM ('new', 'expansion', 'contraction', 'churn', 'manual');
CREATE TYPE mrr_source_type AS ENUM ('contract', 'amendment', 'manual');

-- Singleton config table: holds the seed Beginning MRR that anchors the chain.
CREATE TABLE mrr_config (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seed_month      date NOT NULL,
  seed_beginning_mrr numeric(12,2) NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO mrr_config (id, seed_month, seed_beginning_mrr)
VALUES (1, '2025-01-01', 235118.00);

-- Curated monthly picks. Each row ties a source document (contract or amendment)
-- or a manual adjustment to a specific month and impact type.
CREATE TABLE mrr_churn_entries (
  entry_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month         date NOT NULL,
  source_type   mrr_source_type NOT NULL,
  source_id     uuid,                    -- contract_id or amendment_id; NULL for manual
  impact_type   mrr_impact_type NOT NULL,
  amount        numeric(12,2) NOT NULL,  -- signed from the book's perspective:
                                         --   new/expansion => positive
                                         --   contraction/churn => negative
                                         --   manual => either
  note          text,
  excluded      boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES users(user_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT month_is_first_of_month
    CHECK (month = date_trunc('month', month)::date),
  CONSTRAINT source_id_presence
    CHECK (
      (source_type = 'manual' AND source_id IS NULL)
      OR (source_type IN ('contract','amendment') AND source_id IS NOT NULL)
    ),
  CONSTRAINT manual_requires_note
    CHECK (source_type <> 'manual' OR (note IS NOT NULL AND length(trim(note)) > 0))
);

CREATE INDEX idx_mrr_churn_entries_month ON mrr_churn_entries(month);
CREATE INDEX idx_mrr_churn_entries_source ON mrr_churn_entries(source_type, source_id);

-- Gate: users with this flag true can view and edit the report.
ALTER TABLE users ADD COLUMN can_access_net_churn boolean NOT NULL DEFAULT false;
```

### Access-gate alternative

If you'd rather gate via role than a flag, replace the `ALTER TABLE users` line with a new role value in the existing role enum (e.g. add `'finance_viewer'`) and adjust the RLS policies below accordingly.

---

## 2. Candidate view (what the picker offers)

```sql
CREATE OR REPLACE VIEW mrr_churn_candidates AS
-- New recurring contracts
SELECT
  'contract'::mrr_source_type AS source_type,
  c.contract_id                AS source_id,
  date_trunc('month', c.contract_start_date)::date AS suggested_month,
  'new'::mrr_impact_type       AS suggested_impact,
  c.amount                     AS suggested_amount,
  c.REPLACE_ME_CLIENT_NAME_COL || ' — new contract' AS description,
  NULL::text                   AS document_url
FROM contracts c
WHERE c.contract_type = 'recurring'
  AND c.amount IS NOT NULL
  AND c.amount <> 0
  AND c.contract_start_date IS NOT NULL

UNION ALL

-- Signed amendments (expansion if positive, contraction if negative)
SELECT
  'amendment'::mrr_source_type,
  a.amendment_id,
  date_trunc('month', COALESCE(a.effective_date, a.created_at::date))::date,
  CASE WHEN a.amount > 0
       THEN 'expansion'::mrr_impact_type
       ELSE 'contraction'::mrr_impact_type END,
  a.amount,
  a.amendment_description,
  a.document_url
FROM amendments a
WHERE a.amendment_status = 'signed'
  AND a.amount IS NOT NULL
  AND a.amount <> 0
  AND a.amendment_type = 'recurring'

UNION ALL

-- Canceled recurring contracts (churn). amount is negated so it's signed MRR-down.
SELECT
  'contract'::mrr_source_type,
  c.contract_id,
  date_trunc('month', COALESCE(c.contract_end_date, c.updated_at::date))::date,
  'churn'::mrr_impact_type,
  -COALESCE(c.amount, 0),
  c.REPLACE_ME_CLIENT_NAME_COL || ' — cancelled',
  NULL
FROM contracts c
WHERE c.contract_status = 'canceled'
  AND c.contract_type = 'recurring';
```

### RPC for picker UI

```sql
CREATE OR REPLACE FUNCTION get_net_churn_candidates(target_month date)
RETURNS TABLE (
  source_type        mrr_source_type,
  source_id          uuid,
  suggested_impact   mrr_impact_type,
  suggested_amount   numeric,
  description        text,
  document_url       text,
  already_assigned   boolean
)
LANGUAGE sql STABLE AS $$
  SELECT
    c.source_type,
    c.source_id,
    c.suggested_impact,
    c.suggested_amount,
    c.description,
    c.document_url,
    EXISTS (
      SELECT 1 FROM mrr_churn_entries e
      WHERE e.source_type = c.source_type
        AND e.source_id   = c.source_id
        AND e.excluded    = false
    ) AS already_assigned
  FROM mrr_churn_candidates c
  WHERE c.suggested_month = date_trunc('month', target_month)::date
  ORDER BY c.suggested_impact, c.description;
$$;
```

---

## 3. Monthly rollup view (the grid)

```sql
CREATE OR REPLACE VIEW mrr_monthly_rollup AS
WITH RECURSIVE
  cfg AS (SELECT seed_month, seed_beginning_mrr FROM mrr_config WHERE id = 1),
  months AS (
    SELECT generate_series(
      (SELECT seed_month FROM cfg),
      GREATEST(
        date_trunc('month', CURRENT_DATE)::date,
        COALESCE((SELECT MAX(month) FROM mrr_churn_entries), (SELECT seed_month FROM cfg))
      ),
      interval '1 month'
    )::date AS month
  ),
  totals AS (
    SELECT
      m.month,
      COALESCE(SUM(CASE WHEN e.impact_type = 'new'
                         THEN e.amount ELSE 0 END), 0) AS net_new_mrr,
      COALESCE(SUM(CASE WHEN e.impact_type = 'expansion'
                         THEN e.amount ELSE 0 END), 0) AS expansion_mrr,
      COALESCE(SUM(CASE WHEN e.impact_type IN ('contraction','churn')
                         THEN ABS(e.amount) ELSE 0 END), 0) AS lost_mrr,
      COALESCE(SUM(CASE WHEN e.impact_type = 'manual'
                         THEN e.amount ELSE 0 END), 0) AS manual_adjustment
    FROM months m
    LEFT JOIN mrr_churn_entries e
      ON e.month = m.month AND e.excluded = false
    GROUP BY m.month
  ),
  chain AS (
    SELECT
      t.month,
      (SELECT seed_beginning_mrr FROM cfg) AS beginning_mrr,
      t.net_new_mrr, t.expansion_mrr, t.lost_mrr, t.manual_adjustment,
      (SELECT seed_beginning_mrr FROM cfg)
        + t.net_new_mrr + t.expansion_mrr - t.lost_mrr + t.manual_adjustment
        AS ending_mrr
    FROM totals t
    WHERE t.month = (SELECT seed_month FROM cfg)

    UNION ALL

    SELECT
      t.month,
      c.ending_mrr,
      t.net_new_mrr, t.expansion_mrr, t.lost_mrr, t.manual_adjustment,
      c.ending_mrr + t.net_new_mrr + t.expansion_mrr - t.lost_mrr + t.manual_adjustment
    FROM totals t
    JOIN chain c ON t.month = (c.month + interval '1 month')::date
  )
SELECT
  month,
  beginning_mrr,
  net_new_mrr,
  expansion_mrr,
  lost_mrr,
  manual_adjustment,
  (lost_mrr - expansion_mrr) AS net_churn,
  CASE WHEN beginning_mrr > 0
       THEN (lost_mrr - expansion_mrr) / beginning_mrr
       ELSE 0 END           AS net_churn_rate,
  ending_mrr
FROM chain
ORDER BY month;
```

---

## 4. RLS policies

```sql
ALTER TABLE mrr_churn_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrr_config        ENABLE ROW LEVEL SECURITY;

-- Helper: current user has net-churn access
CREATE OR REPLACE FUNCTION current_user_has_net_churn_access()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT can_access_net_churn FROM users WHERE user_id = auth.uid()),
    false
  )
  OR COALESCE(
    (SELECT role IN ('admin') FROM users WHERE user_id = auth.uid()),
    false
  );
$$;

-- Entries: read + write for net-churn users
CREATE POLICY "net_churn_read" ON mrr_churn_entries
  FOR SELECT USING (current_user_has_net_churn_access());
CREATE POLICY "net_churn_write" ON mrr_churn_entries
  FOR ALL USING (current_user_has_net_churn_access())
         WITH CHECK (current_user_has_net_churn_access());

-- Config: read for net-churn users, write for admin only
CREATE POLICY "net_churn_config_read" ON mrr_config
  FOR SELECT USING (current_user_has_net_churn_access());
CREATE POLICY "net_churn_config_write" ON mrr_config
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users WHERE user_id = auth.uid() AND role = 'admin')
  );

-- Grant the view + RPC to authenticated (RLS on underlying tables still applies)
GRANT SELECT ON mrr_monthly_rollup    TO authenticated;
GRANT SELECT ON mrr_churn_candidates  TO authenticated;
GRANT EXECUTE ON FUNCTION get_net_churn_candidates(date) TO authenticated;
```

---

## 5. UI specification

### Route & navigation
- New page under Pulse at `/pulse/net-churn`.
- Sidebar link labeled **"Net Churn"** under the Pulse section, visible only when `users.can_access_net_churn = true` or role = `admin`.
- If a user without access lands on the route, redirect to `/pulse` with a toast.

### Layout

Header:
- Title: **"Net Churn"**
- Subtitle: "Monthly MRR movement — click any cell to see what's in it."
- Right-aligned: year range selector (default: current year) and an "Edit seed" affordance (admin only) for updating `mrr_config`.

Grid (horizontally scrollable, sticky first column):

| Row label (sticky) | Jan 2025 | Feb 2025 | ... | Apr 2026 |
|---|---|---|---|---|
| **Beginning MRR** | $235,118 | $244,668 | ... | ... |
| Net New MRR | $21,500 | $0 | ... | ... |
| Expansion MRR | $0 | $0 | ... | ... |
| Lost MRR | $11,950 | $13,650 | ... | ... |
| Manual Adjustment | $0 | $0 | ... | ... |
| **Net Churn** | $11,950 | $13,650 | ... | ... |
| **Net Churn Rate** | 5.08% | 5.58% | ... | ... |
| **Ending MRR** | $244,668 | $231,018 | ... | ... |

Formatting:
- Currency in whole dollars with commas.
- Rate as percent with 2 decimals.
- Negative/loss values in red.
- Bold the Beginning, Net Churn, Net Churn Rate, and Ending rows.
- **Beginning MRR** and **Ending MRR** cells are visually flagged as derived (subtle background tint, cursor on hover explains "Computed from prior month").

### Cell interaction

Clicking any cell in **Net New MRR**, **Expansion MRR**, **Lost MRR**, or **Manual Adjustment** opens a right-side drawer showing:

- Month label as header.
- Row-total at top.
- List of contributing entries. Each entry row displays:
  - Description (contract client name or amendment description).
  - Amount (signed, color-coded).
  - Source badge (New Contract / Amendment / Manual).
  - Note (if present, italicized).
  - Link-out icon → `document_url` (amendments only), opens in new tab.
  - Hamburger menu with: **Edit note**, **Exclude** (toggle), **Move to different month**, **Delete** (manual entries only).
- At the bottom: **+ Add entry** button.

Clicking **Beginning MRR**, **Net Churn**, **Net Churn Rate**, or **Ending MRR** cells shows a read-only tooltip explaining how they're derived — no drill-down.

### Add-entry modal

Two tabs:

**Tab 1 — Pick from list (default)**
- Auto-runs `get_net_churn_candidates(<month>)`.
- Table of candidates with columns: Description, Suggested Impact, Amount, Source, Already assigned (checkmark).
- Sort: unassigned first, then by impact type.
- Row action: **Add to month** button per row. Once added, the row greys out.
- Search box filters by description.

**Tab 2 — Manual entry**
- Form fields:
  - Impact type (dropdown: Expansion, Contraction, Churn, Manual — Net New and New excluded since those should flow from contract creation).
  - Amount (signed; helper text reminds expansion = positive, lost = negative).
  - Note (required, textarea).
- Submit creates a row with `source_type = 'manual'`, `source_id = NULL`.

On save: close modal, refresh grid and drawer.

### Empty / loading / error states
- Empty month cell (no entries, zero total): show `—` instead of `$0`.
- Loading: skeleton shimmer on the grid rows.
- Save error: toast with the error message; keep drawer open with form state preserved.

---

## 6. Historical data seeding (2025 backfill)

The legacy spreadsheet recorded 2025 totals that may not match what's derivable from `contracts` + `amendments` alone (e.g. the Feb → Mar 2025 Beginning MRR jump of ~$91k). For a faithful historical grid, seed the first few months' entries manually using the numbers from `Monthly Data Tracking - Leadership - 2025.csv`:

1. Confirm `mrr_config.seed_beginning_mrr = 235118.00` for `seed_month = 2025-01-01`.
2. For each month Jan–Nov 2025, for any delta not attributable to an actual contract/amendment record, create a `mrr_churn_entries` row with `source_type = 'manual'`, `impact_type = 'manual'`, `amount = <signed delta>`, and a note describing the source (e.g. "2025 legacy sheet reconciliation — Feb/Mar beginning MRR reset").
3. Once the rollup view's numbers match the legacy sheet for 2025, consider the backfill done.

---

## 7. Acceptance checklist

- [ ] Tables, enums, views, RPC, and RLS policies all created and queryable.
- [ ] Jan 2025 row in `mrr_monthly_rollup` shows `beginning_mrr = 235118`.
- [ ] Adding an expansion entry for a signed amendment shifts the month's Expansion MRR, Ending MRR, and the next month's Beginning MRR consistently.
- [ ] Excluding an entry restores the prior totals without deleting it.
- [ ] Seed value edit (admin only) ripples through every downstream month.
- [ ] Non-authorized user cannot see the sidebar link, navigate to the route, or read any `mrr_*` table/view.
- [ ] Cell drill-down lists contributing entries and links to amendment documents.
- [ ] Adding a manual entry without a note is rejected (CHECK constraint).
- [ ] Picker shows "already assigned" for entries already in the month.
- [ ] Grid scrolls horizontally with sticky first column and sticky month header row.

---

## 8. Notes & flagged assumptions

- **Verify column name for contracts' client/company display.** The candidate view uses `REPLACE_ME_CLIENT_NAME_COL`; swap for the real column (likely `client_name` or `company_name`).
- **`contract_start_date` = MRR activation date.** If your accounting treats "MRR starts" differently (e.g. first invoice date), adjust the candidate view accordingly.
- **Amendment `effective_date` may be NULL on older records.** The candidate view falls back to `created_at`, which may bucket into the wrong month. The picker's "Move to different month" action is the cleanup path.
- **Project-type amendments are excluded** from MRR movement, matching the legacy definition (MRR = recurring only).
- **Contract amount updates without an amendment record won't show up.** If someone edits `contracts.amount` directly (bypassing the amendments flow), that MRR change is invisible to this report. Out of scope to fix; flag in docs.
