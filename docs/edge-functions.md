# MiD Platform - Supabase Edge Functions

## Overview

Lovable deployed a `backend-proxy` Edge Function that handles all privileged database operations. This single function supports select, insert, update, upsert, delete, and RPC operations using the service role.

## Security: Shared Secret

The Edge Function validates requests using `EDGE_FUNCTION_SECRET` sent via the `x-backend-key` header.

| Location | Variable | Header |
|----------|----------|--------|
| **Render** | `EDGE_FUNCTION_SECRET` | Sent as `x-backend-key` |
| **Supabase** | `EDGE_FUNCTION_SECRET` | Validated in Edge Function |

## Endpoint

```
POST https://<your-project>.supabase.co/functions/v1/backend-proxy
```

## Request Format

```typescript
interface ProxyRequest {
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  table?: string;           // Required for all except rpc
  data?: Record | Record[]; // Required for insert, update, upsert
  filters?: Record;         // Required for update, delete (safety)
  select?: string;          // Column selection (default: "*")
  rpc_name?: string;        // Required for rpc operation
  rpc_params?: Record;      // Parameters for rpc
  options?: {
    count?: 'exact' | 'planned' | 'estimated';
    onConflict?: string;    // For upsert
    single?: boolean;       // Return single row
    limit?: number;
    offset?: number;
    order?: Array<{ column: string; ascending?: boolean }>;
  };
}
```

## Examples

### SELECT with filters and ordering

```typescript
await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-backend-key': EDGE_FUNCTION_SECRET,
  },
  body: JSON.stringify({
    operation: 'select',
    table: 'contracts',
    select: '*, accounts(*)',
    filters: { contract_status: 'active' },
    options: {
      order: [{ column: 'created_at', ascending: false }],
      limit: 50,
    },
  }),
});
```

### INSERT

```typescript
await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-backend-key': EDGE_FUNCTION_SECRET,
  },
  body: JSON.stringify({
    operation: 'insert',
    table: 'pulse_tasks',
    data: {
      clickup_task_id: 'abc123',
      name: 'Task name',
      contract_id: 'uuid',
    },
  }),
});
```

### UPSERT (great for syncs)

```typescript
await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-backend-key': EDGE_FUNCTION_SECRET,
  },
  body: JSON.stringify({
    operation: 'upsert',
    table: 'pulse_invoices',
    data: invoicesArray,
    options: { onConflict: 'quickbooks_id' },
  }),
});
```

### UPDATE with filters

```typescript
await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-backend-key': EDGE_FUNCTION_SECRET,
  },
  body: JSON.stringify({
    operation: 'update',
    table: 'agencies',
    data: { quickbooks_realm_id: '123456' },
    filters: { id: 'agency-uuid' },
  }),
});
```

### Advanced filters

```typescript
// Filters support operators
filters: {
  status: 'active',                    // eq (default)
  amount: { gt: 1000 },                // greater than
  name: { ilike: '%acme%' },           // case-insensitive like
  type: { in: ['invoice', 'credit'] }, // in array
  deleted_at: { is: null },            // is null
}
```

---

## Backend Utility

The backend has a typed utility at `src/utils/edge-functions.ts` that wraps these calls:

```typescript
import { select, insert, update, upsert, del, rpc } from './utils/edge-functions.js';

// SELECT
const contracts = await select('contracts', {
  select: '*, accounts(*)',
  filters: { contract_status: 'active' },
  order: [{ column: 'created_at', ascending: false }],
  limit: 50,
});

// INSERT
await insert('pulse_tasks', { name: 'Task', contract_id: 'uuid' });

// UPDATE
await update('agencies', { quickbooks_realm_id: '123' }, { id: 'agency-id' });

// UPSERT
await upsert('pulse_invoices', invoices, { onConflict: 'quickbooks_id' });

// DELETE
await del('pulse_tasks', { id: 'task-id' });

// RPC (stored procedure)
const result = await rpc('my_function', { param1: 'value' });
```

### OAuth Token Helpers

```typescript
import { storeOAuthTokens, getOAuthTokens } from './utils/edge-functions.js';

// Store tokens
await storeOAuthTokens('quickbooks', agencyId, {
  access_token: '...',
  refresh_token: '...',
  realm_id: '123456',
  expires_in: 3600,
  created_at: new Date().toISOString(),
});

// Retrieve tokens
const tokens = await getOAuthTokens('quickbooks', agencyId);
```

### Sync Helpers

```typescript
import {
  syncClickUpTasks,
  syncClickUpTimeEntries,
  syncQuickBooksInvoices,
  syncQuickBooksPayments,
  logSync,
} from './utils/edge-functions.js';

// Sync tasks
await syncClickUpTasks(tasksArray);

// Sync invoices
await syncQuickBooksInvoices(invoicesArray);

// Log sync result
await logSync('clickup', agencyId, 'success', { tasksProcessed: 50 });
```

---

## Environment Variables

### Render Backend

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `EDGE_FUNCTION_SECRET` | Shared secret (sent as `x-backend-key`) |

### Supabase Edge Functions

| Secret | Description |
|--------|-------------|
| `EDGE_FUNCTION_SECRET` | Same shared secret as Render |

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to Edge Functions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Render Backend                                  │
│                                                                      │
│  edge-functions.ts utility                                          │
│  - select(), insert(), update(), upsert(), del(), rpc()            │
│  - storeOAuthTokens(), getOAuthTokens()                            │
│  - syncClickUpTasks(), syncQuickBooksInvoices(), etc.              │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ POST /functions/v1/backend-proxy
                                │ x-backend-key: <secret>
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Supabase Edge Function: backend-proxy                │
│                                                                      │
│  1. Validates x-backend-key header                                  │
│  2. Parses operation (select/insert/update/upsert/delete/rpc)      │
│  3. Executes via service role client (bypasses RLS)                │
│  4. Returns data                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Supabase Database                            │
│                         (RLS bypassed)                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Edge Function: send-email

A separate edge function handles email requests by forwarding them to n8n for processing.

### Endpoint

```
POST https://<your-project>.supabase.co/functions/v1/send-email
```

### Authentication

The function supports two authentication methods:

| Method | Use Case | Header |
|--------|----------|--------|
| **User JWT** | Frontend calls during user actions | `Authorization: Bearer <token>` |
| **Backend Key** | Backend-to-backend (automated reports, etc.) | `x-backend-key: <BACKEND_API_KEY>` |

### Request Format

```typescript
interface EmailRequest {
  email_type: 'user_invitation' | 'password_reset' | 'welcome' | 'contract_notification' | 'weekly_report' | 'custom';
  to: string | string[];
  subject?: string;
  data?: Record<string, any>;
}
```

### Example Payload

```json
{
  "email_type": "user_invitation",
  "to": ["user@example.com"],
  "data": {
    "full_name": "John Doe",
    "role": "team_member",
    "company_name": "ACME Corp",
    "login_url": "https://app.marketersindemand.com/login"
  }
}
```

### n8n Payload Format

The edge function transforms the request and sends this to n8n:

```json
{
  "email_type": "user_invitation",
  "to": ["user@example.com"],
  "subject": "Optional subject",
  "data": {
    "full_name": "John Doe",
    "role": "team_member",
    "company_name": "ACME Corp",
    "login_url": "https://app.marketersindemand.com/login"
  },
  "timestamp": "2026-01-25T12:00:00.000Z",
  "source": "frontend"
}
```

### Environment Variables

| Location | Variable | Description |
|----------|----------|-------------|
| **Supabase** | `N8N_EMAIL_WEBHOOK_URL` | n8n webhook endpoint for email processing |
| **Supabase** | `BACKEND_API_KEY` | Shared secret for backend-to-backend auth |
| **Render** | `N8N_EMAIL_WEBHOOK_URL` | Same URL (for potential direct backend calls) |

### Email Types

| Type | Trigger | Typical Data |
|------|---------|--------------|
| `user_invitation` | New user invited | `full_name`, `role`, `company_name`, `login_url` |
| `welcome` | User first login | `full_name`, `login_url` |
| `password_reset` | Password reset request | `reset_url` |
| `contract_notification` | Contract status change | `contract_name`, `status`, `action_url` |
| `weekly_report` | Scheduled report | Report summary data |
| `custom` | Ad-hoc emails | Varies |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Frontend (Lovable)                              │
│                                                                      │
│  User action triggers email (invitation, etc.)                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ POST /functions/v1/send-email
                                │ Authorization: Bearer <user-jwt>
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Supabase Edge Function: send-email                   │
│                                                                      │
│  1. Validates auth (JWT or backend key)                             │
│  2. Validates payload (email_type, to)                              │
│  3. Transforms and forwards to n8n webhook                          │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                │ POST N8N_EMAIL_WEBHOOK_URL
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         n8n Workflow                                 │
│                                                                      │
│  - Receives email request                                           │
│  - Selects template based on email_type                             │
│  - Sends email via configured provider                              │
└─────────────────────────────────────────────────────────────────────┘
```
