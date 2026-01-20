# QuickBooks Sync Logic Documentation

This document describes how the Pulse v1 application synchronizes data from QuickBooks Online (invoices, credit memos, payments, and customers) to the local Supabase database.

## Table of Contents

1. [Overview](#overview)
2. [Company Discovery](#company-discovery)
3. [Token Management](#token-management)
4. [Invoice Sync](#invoice-sync)
5. [Credit Memo Sync](#credit-memo-sync)
6. [Payment Sync](#payment-sync)
7. [Customer Sync](#customer-sync)
8. [Contract Number & Points Parsing](#contract-number--points-parsing)
9. [Database Tables](#database-tables)
10. [Error Handling](#error-handling)
11. [Key Files](#key-files)

---

## Overview

The QuickBooks sync is a **pull-based** system that:
1. Queries the `quickbooks_tokens` table to find all connected QuickBooks companies
2. For each company, refreshes OAuth tokens if needed
3. Fetches invoices, credit memos, and payments from the QuickBooks API
4. Parses memo fields to extract contract numbers and points
5. Stores the data in local Supabase tables

### Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│    Sync Scripts     │     │  QuickBooks Service │     │  QuickBooks Online  │
│  (sync-quickbooks-  │────▶│  (quickbooksService │────▶│        API          │
│   invoices.js)      │     │   .js)              │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
          │                           │
          │                           │
          ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐
│   Token Service     │     │      Supabase       │
│  (token-service.js) │────▶│  (quickbooks_*)     │
└─────────────────────┘     │      tables         │
                            └─────────────────────┘
```

---

## Company Discovery

### How Companies Are Found

The sync process discovers QuickBooks companies by querying the `quickbooks_tokens` table:

```javascript
// From sync-quickbooks-invoices.js
const { data: companies, error } = await supabase
  .from('quickbooks_tokens')
  .select('*');
```

Each token record contains:
- `company_name` - Human-readable company name (e.g., "New North", "Marketers in Demand")
- `realm_id` - QuickBooks company ID (unique identifier)
- `access_token` - OAuth2 access token
- `refresh_token` - OAuth2 refresh token
- `expires_at` - Token expiration timestamp
- `is_active` - Whether the token is currently active

### Business Unit Mapping

The sync service can also discover companies via business units from contracts:

```javascript
// From syncService.js
async getBusinessUnitIds() {
  const { data, error } = await supabase
    .from('contracts')
    .select('quickbooks_business_unit_id')
    .not('quickbooks_business_unit_id', 'is', null);

  // Create unique set of business unit IDs
  const uniqueBusinessUnits = [...new Set(data.map(bu => bu.quickbooks_business_unit_id))];
  return uniqueBusinessUnits;
}
```

---

## Token Management

### Token Refresh Logic

Tokens are automatically refreshed if they're expiring within 30 minutes:

```javascript
// From sync-quickbooks-credit-memos.js
async function checkAndRefreshToken(token) {
  const now = new Date();
  const expiryDate = token.expires_at ? new Date(token.expires_at) : null;
  const needsRefresh = !expiryDate || (expiryDate - now) < 30 * 60 * 1000; // 30 minutes

  if (needsRefresh) {
    // Initialize OAuth client
    const oauthClient = new OAuthClient({
      clientId: process.env.QUICKBOOKS_CLIENT_ID,
      clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET,
      environment: process.env.QUICKBOOKS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
      redirectUri: process.env.QUICKBOOKS_REDIRECT_URI,
    });

    // Set and refresh the token
    oauthClient.setToken({
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expires_in: token.expires_in,
    });

    const authResponse = await oauthClient.refresh();

    // Update database with new token
    await supabase
      .from('quickbooks_tokens')
      .update({
        access_token: authResponse.token.access_token,
        refresh_token: authResponse.token.refresh_token,
        expires_in: authResponse.token.expires_in,
        expires_at: new Date(Date.now() + (authResponse.token.expires_in * 1000)).toISOString(),
        last_refreshed_at: new Date().toISOString(),
      })
      .eq('id', token.id);
  }

  return token;
}
```

### OAuth Libraries Used

- `intuit-oauth` - Official Intuit OAuth client for token management
- `node-quickbooks` - QuickBooks API wrapper for making API calls

---

## Invoice Sync

### Process Flow

1. **Get existing invoices** - Fetch all `quickbooks_id` values already stored to avoid duplicates
2. **Create QuickBooks client** - Using the token for the specific company/realm
3. **Fetch invoices with pagination** - 100 invoices per page
4. **Parse memo fields** - Extract contract number and points
5. **Store in database** - Insert new invoices into `quickbooks_invoices` table

### Pagination

```javascript
// From sync-quickbooks-invoices.js
let allInvoices = [];
let moreInvoices = true;
let startPosition = 1;
const maxResultsPerPage = 100;

while (moreInvoices) {
  const response = await new Promise((resolve, reject) => {
    client.findInvoices({
      limit: maxResultsPerPage,
      offset: startPosition - 1
    }, (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });

  if (response?.QueryResponse?.Invoice) {
    allInvoices = allInvoices.concat(response.QueryResponse.Invoice);

    if (response.QueryResponse.Invoice.length < maxResultsPerPage) {
      moreInvoices = false;
    } else {
      startPosition += maxResultsPerPage;
    }
  } else {
    moreInvoices = false;
  }
}
```

### Memo Field Priority

The sync checks memo fields in this order:
1. `PrivateNote` - Internal notes (checked first)
2. `CustomerMemo` - Customer-facing memo
3. `Memo` - Alternative memo field

```javascript
// Check PrivateNote first, then fall back to CustomerMemo or Memo
const privateNote = invoice.PrivateNote;
const customerMemo = invoice.CustomerMemo || invoice.Memo;

let parsedMemo = null;
// Try to parse from PrivateNote first
if (privateNote) {
  parsedMemo = parseCustomerMemo(privateNote);
}

// If no valid data from PrivateNote, try CustomerMemo
if (!parsedMemo || !parsedMemo.contractNumber) {
  parsedMemo = parseCustomerMemo(customerMemo);
}
```

### Invoice Data Stored

```javascript
const insertData = {
  quickbooks_id: invoice.Id,
  business_unit_id: companyName,
  customer_name: CustomerRef?.name,
  customer_id: CustomerRef?.value,
  doc_number: DocNumber,
  transaction_date: TxnDate,
  contract_number: parsedMemo.contractNumber,
  points: parsedMemo.points,
  memo_data: memo_data,  // Formatted as "ContractNumber:X;Points:Y"
  raw_data: invoice,     // Full invoice JSON for debugging
  total_amount: TotalAmt,
  balance: Balance
};
```

---

## Credit Memo Sync

### Process Flow

Similar to invoice sync:
1. Fetch existing credit memos to avoid duplicates
2. Query QuickBooks for credit memos
3. Parse `CustomerMemo` for contract info
4. Store in `quickbooks_credit_memos` table

### Key Difference from Invoices

Credit memos only check `CustomerMemo`, not `PrivateNote`:

```javascript
// From sync-quickbooks-credit-memos.js
const memoData = parseCustomerMemo(creditMemo.CustomerMemo);

if (!memoData || !memoData.contractNumber) {
  console.log(`Skipping credit memo with QB ID ${qbId} as it has no contract number`);
  results.skipped++;
  continue;
}
```

### Credit Memo Data Stored

```javascript
const creditMemoData = {
  qb_id: creditMemo.Id,
  doc_number: creditMemo.DocNumber,
  customer_id: creditMemo.CustomerRef?.value,
  customer_name: creditMemo.CustomerRef?.name,
  amount: creditMemo.TotalAmt,
  transaction_date: creditMemo.TxnDate,
  contract_number: memoData.contractNumber,
  points: memoData.points || 0,
  company_name: companyName,
  memo_data: memoData,
  raw_data: creditMemo
};
```

---

## Payment Sync

### Process Flow

Payments are synced via the `syncService.js` file:

```javascript
// From syncService.js
async syncPaymentsForBusinessUnit(businessUnitId) {
  // Set realm ID
  this.qbService.realmId = businessUnitId;

  // Get last sync time for incremental sync
  const lastSyncTime = await this.getLastSyncTime(businessUnitId, 'payments');

  // Build query for payments modified since last sync
  const query = `SELECT * FROM Payment WHERE MetaData.LastUpdatedTime >= '${lastSyncTime}' ORDERBY MetaData.LastUpdatedTime`;

  // Get payments from QuickBooks
  const response = await this.qbService.runQuery(query);
  const payments = response.QueryResponse.Payment || [];

  // Store each payment
  for (const payment of payments) {
    await this.storePayment(payment, businessUnitId);
  }
}
```

### Linked Invoice Extraction

Payments can be linked to invoices in multiple ways. The sync extracts these links:

```javascript
// From syncService.js - storePayment method
async storePayment(payment, businessUnitId) {
  const linkedInvoices = [];
  const processedIds = new Set();

  // 1. Check top-level LinkedTxn
  if (payment.LinkedTxn && Array.isArray(payment.LinkedTxn)) {
    for (const txn of payment.LinkedTxn) {
      if (txn.TxnType === 'Invoice' && txn.TxnId) {
        if (!processedIds.has(txn.TxnId)) {
          linkedInvoices.push({
            id: txn.TxnId,
            amount: txn.Amount || payment.TotalAmt
          });
          processedIds.add(txn.TxnId);
        }
      }
    }
  }

  // 2. Check Line items (most reliable source)
  if (payment.Line && Array.isArray(payment.Line)) {
    for (const line of payment.Line) {
      // Check LinkedTxn in line items
      if (line.LinkedTxn && Array.isArray(line.LinkedTxn)) {
        for (const txn of line.LinkedTxn) {
          if (txn.TxnType === 'Invoice' && txn.TxnId && !processedIds.has(txn.TxnId)) {
            linkedInvoices.push({
              id: txn.TxnId,
              amount: line.Amount || txn.Amount || 0
            });
            processedIds.add(txn.TxnId);
          }
        }
      }

      // Check LineEx.any array for txnId
      if (line.LineEx?.any && Array.isArray(line.LineEx.any)) {
        const txnIdObj = line.LineEx.any.find(item =>
          item.value?.Name === 'txnId' && item.value?.Value
        );

        if (txnIdObj && !processedIds.has(txnIdObj.value.Value)) {
          linkedInvoices.push({
            id: txnIdObj.value.Value,
            amount: line.Amount || 0
          });
          processedIds.add(txnIdObj.value.Value);
        }
      }
    }
  }

  // Store in database
  const data = {
    quickbooks_id: payment.Id,
    business_unit_id: businessUnitId,
    customer_id: payment.CustomerRef?.value,
    customer_name: payment.CustomerRef?.name,
    payment_date: payment.TxnDate,
    payment_method: payment.PaymentMethodRef?.name,
    total_amount: payment.TotalAmt,
    linked_invoices: linkedInvoices,
    raw_data: payment
  };
}
```

### Invoice-Payment Linking

When invoices are stored, the system also checks if any existing payments should be linked:

```javascript
// After storing an invoice, check for related payments
const { data: payments } = await supabase
  .from('quickbooks_payments')
  .select('*')
  .eq('business_unit_id', businessUnitId)
  .eq('customer_id', invoice.CustomerRef?.value);

// Check each payment's raw_data for references to this invoice
for (const payment of payments) {
  if (payment.raw_data?.LinkedTxn) {
    const shouldLink = payment.raw_data.LinkedTxn.some(txn =>
      txn.TxnType === 'Invoice' && txn.TxnId === invoice.Id
    );

    if (shouldLink) {
      // Update payment's linked_invoices array
    }
  }
}
```

---

## Customer Sync

### Process Flow

```javascript
// From syncService.js
async syncCustomersForBusinessUnit(businessUnitId) {
  const lastSyncTime = await this.getLastSyncTime(businessUnitId, 'customers');

  const query = `SELECT * FROM Customer WHERE MetaData.LastUpdatedTime >= '${lastSyncTime}' ORDERBY MetaData.LastUpdatedTime`;

  const response = await this.qbService.runQuery(query);
  const customers = response.QueryResponse.Customer || [];

  for (const customer of customers) {
    await this.storeCustomer(customer, businessUnitId);
  }
}
```

### Customer Data Stored

```javascript
const data = {
  quickbooks_id: customer.Id,
  business_unit_id: businessUnitId,
  display_name: customer.DisplayName,
  company_name: customer.CompanyName,
  email: customer.PrimaryEmailAddr?.Address,
  phone: customer.PrimaryPhone?.FreeFormNumber,
  billing_address: customer.BillAddr,
  shipping_address: customer.ShipAddr,
  active: customer.Active,
  raw_data: customer
};
```

---

## Contract Number & Points Parsing

### Memo Field Format

The expected format for memo fields is:
```
ContractNumber:MID20250001;Points:600;
```

### Parsing Logic

The `parseCustomerMemo` function uses multiple regex patterns to extract contract numbers and points:

```javascript
// From sync-quickbooks-invoices.js
function parseCustomerMemo(customerMemo) {
  let contractNumber = null;
  let points = null;
  let memoText = '';

  // Handle object format (standard)
  if (customerMemo && typeof customerMemo === 'object' && customerMemo.value) {
    memoText = customerMemo.value;
  }
  // Handle string format
  else if (customerMemo && typeof customerMemo === 'string') {
    memoText = customerMemo;
  }

  if (!memoText) return null;

  // CONTRACT NUMBER PATTERNS (in order of priority)

  // Pattern 0: Exact format "ContractNumber:MID20250001;Points:600;"
  const exactPattern = memoText.match(/ContractNumber:([^;]+);Points:(\d+);?/i);
  if (exactPattern) {
    contractNumber = exactPattern[1].trim();
    points = parseInt(exactPattern[2], 10);
    return { contractNumber, points };
  }

  // Pattern 0b: Contract only "ContractNumber:MID20250001;"
  const contractOnlyPattern = memoText.match(/ContractNumber:([^;]+);/i);
  if (contractOnlyPattern) {
    contractNumber = contractOnlyPattern[1].trim();
    // Look for points separately
    const pointsMatch = memoText.match(/Points:(\d+);?/i);
    if (pointsMatch) {
      points = parseInt(pointsMatch[1], 10);
    }
    return { contractNumber, points };
  }

  // Pattern 1: Standard format "Contract Number: ABC123"
  let contractMatch = memoText.match(/Contract\s*(?:Number|#)?:\s*([A-Za-z0-9-_]+)/i);

  // Pattern 2: Just the ID with MID prefix "MID12345"
  if (!contractMatch) {
    contractMatch = memoText.match(/\b(MID[A-Za-z0-9-_]+)\b/i);
  }

  // Pattern 3: Reference to contract "Contract: ABC123"
  if (!contractMatch) {
    contractMatch = memoText.match(/Contract(?:\s+|:\s*)([A-Za-z0-9-_]+)/i);
  }

  // Pattern 4: Client contract format "Client Contract: ABC123"
  if (!contractMatch) {
    contractMatch = memoText.match(/Client\s+Contract(?:\s+|:\s*)([A-Za-z0-9-_]+)/i);
  }

  if (contractMatch && contractMatch[1]) {
    contractNumber = contractMatch[1].trim();
    // Validate minimum length
    if (contractNumber.length < 3) {
      contractNumber = null;
    }
  }

  // POINTS PATTERNS
  const pointsPatterns = [
    /Points?:\s*(\d+)/i,                                    // "Points: 100"
    /(\d+)\s+Points?/i,                                     // "100 Points"
    /Contract\s+Value:\s*\$?[\d,]+\s*(?:\(|\/)?\s*(\d+)\s*Points?/i  // "Contract Value: $10,000 / 100 Points"
  ];

  for (const pattern of pointsPatterns) {
    const pointsMatch = memoText.match(pattern);
    if (pointsMatch && pointsMatch[1]) {
      points = parseInt(pointsMatch[1].replace(/,/g, ''), 10);
      break;
    }
  }

  return contractNumber ? { contractNumber, points } : null;
}
```

### Credit Memo Parsing Variations

Credit memos have additional patterns:

```javascript
// From sync-quickbooks-credit-memos.js
const contractPatterns = [
  /SOW\s*#?\s*(\w+)/i,           // "SOW #12345"
  /Contract(?:\s*Number)?:\s*(\w+)/i,  // "Contract Number: 12345"
  /Contract ID:\s*(\w+)/i,       // "Contract ID: 12345"
  /MID(\d+)/i,                   // "MID12345"
  /#\s*(\d{3,})/                 // "#12345"
];

const pointsPatterns = [
  /Points?:\s*(\d+)/i,           // "Points: 100"
  /(\d+)\s+Points?/i,            // "100 Points"
  /Points\s+Gifted.*?(\d+)/i,    // "Points Gifted: 100"
  /Contract\s+Value:\s*\$?[\d,]+\s*(?:\(|\/)?\s*(\d+)\s*Points?/i
];
```

---

## Database Tables

### quickbooks_tokens

Stores OAuth tokens for each connected QuickBooks company.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| company_name | text | Human-readable company name |
| realm_id | text | QuickBooks company ID |
| access_token | text | OAuth access token |
| refresh_token | text | OAuth refresh token |
| expires_at | timestamp | Token expiration time |
| is_active | boolean | Whether token is active |
| last_refreshed_at | timestamp | Last refresh time |

### quickbooks_invoices

Stores synchronized invoices.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| quickbooks_id | text | QuickBooks invoice ID |
| business_unit_id | text | Company name/realm |
| customer_id | text | QuickBooks customer ID |
| customer_name | text | Customer display name |
| doc_number | text | Invoice number |
| transaction_date | date | Invoice date |
| total_amount | decimal | Invoice total |
| balance | decimal | Remaining balance |
| contract_number | text | Parsed contract number |
| points | integer | Parsed points value |
| memo_data | text | Formatted memo data |
| raw_data | jsonb | Full invoice JSON |

### quickbooks_credit_memos

Stores synchronized credit memos.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| qb_id | text | QuickBooks credit memo ID |
| doc_number | text | Credit memo number |
| customer_id | text | QuickBooks customer ID |
| customer_name | text | Customer display name |
| amount | decimal | Credit memo amount |
| transaction_date | date | Credit memo date |
| contract_number | text | Parsed contract number |
| points | integer | Parsed points value |
| company_name | text | Company name |
| memo_data | jsonb | Parsed memo object |
| raw_data | jsonb | Full credit memo JSON |

### quickbooks_payments

Stores synchronized payments.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| quickbooks_id | text | QuickBooks payment ID |
| business_unit_id | text | Company name/realm |
| customer_id | text | QuickBooks customer ID |
| customer_name | text | Customer display name |
| payment_date | date | Payment date |
| payment_method | text | Payment method name |
| total_amount | decimal | Payment amount |
| linked_invoices | jsonb | Array of linked invoice IDs |
| raw_data | jsonb | Full payment JSON |

### sync_status

Tracks sync state for incremental syncing.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| service | text | Service name ('quickbooks') |
| business_unit_id | text | Company/realm ID |
| entity_type | text | Entity type (invoices, payments, etc.) |
| last_sync_time | timestamp | Last successful sync time |
| last_sync_status | text | Status (success, error) |
| last_sync_message | text | Status message |

---

## Error Handling

### Token Refresh Failures

When token refresh fails, the sync logs the error and provides a reauthorization URL:

```javascript
if (!isValid) {
  console.log(`Token for ${company.company_name} is invalid or expired and could not be refreshed`);
  console.log(`Please use the reauthorization URL: ${process.env.PUBLIC_URL}/api/quickbooks/refresh/reauthorize/${encodeURIComponent(company.company_name)}`);
  results[company.company_name] = { processed: 0, saved: 0, skipped: 0, errors: 1, message: 'Invalid token' };
  continue;
}
```

### API Errors

The QuickBooks API client includes interceptors for automatic retry on 401 errors:

```javascript
this.client.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 401 && !originalRequest._retry && this.refreshToken) {
      originalRequest._retry = true;
      const refreshedToken = await this.refreshAccessToken(this.refreshToken);
      if (refreshedToken) {
        originalRequest.headers['Authorization'] = `Bearer ${refreshedToken}`;
        return this.client(originalRequest);
      }
    }
    return Promise.reject(error);
  }
);
```

### Rate Limiting

The sync adds delays between pagination requests to avoid rate limits:

```javascript
// Add a small delay to avoid rate limits
if (pageNumber > 1) {
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/sync-quickbooks-invoices.js` | Standalone invoice sync script |
| `scripts/sync-quickbooks-credit-memos.js` | Standalone credit memo sync script |
| `server/services/quickbooks/quickbooksService.js` | QuickBooks API client wrapper |
| `server/services/quickbooks/syncService.js` | Sync orchestration for all entity types |
| `server/services/quickbooks/token-service.js` | Token storage and refresh |
| `server/routes/quickbooks.js` | API endpoints for manual sync triggers |

---

## Running Syncs

### Standalone Scripts

```bash
# Sync invoices
node scripts/sync-quickbooks-invoices.js

# Sync credit memos
node scripts/sync-quickbooks-credit-memos.js

# Sync all (invoices, credit memos, payments, customers)
node scripts/sync-all-quickbooks.js
```

### API Endpoints

The sync can also be triggered via API endpoints defined in `server/routes/quickbooks.js`.

---

## Important Notes for New Backend Implementation

1. **Memo Field Format**: Ensure invoices and credit memos are created with the format `ContractNumber:X;Points:Y;` in the CustomerMemo or PrivateNote field for reliable parsing.

2. **Multiple Companies**: The system supports multiple QuickBooks companies. Each company needs its own OAuth token stored in `quickbooks_tokens`.

3. **Incremental Sync**: The sync service uses `sync_status` table to track last sync times for incremental syncing. This avoids re-fetching all data on each sync.

4. **Deduplication**: Invoices and credit memos are deduplicated by their QuickBooks ID (`quickbooks_id` or `qb_id`). Existing records are skipped, not updated.

5. **Raw Data Storage**: The `raw_data` column stores the complete JSON response from QuickBooks, which can be useful for debugging or extracting additional fields later.

6. **Points Calculation**: Points from invoices represent `points_purchased`, while points from credit memos represent `points_credited`. The net points balance is calculated as:
   ```
   points_balance = points_purchased + points_credited - points_delivered
   ```
