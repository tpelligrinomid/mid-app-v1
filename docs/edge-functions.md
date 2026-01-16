# MiD Platform - Supabase Edge Functions

Edge Functions handle privileged database operations that require service role access. The Render backend calls these functions via HTTP.

## Why Edge Functions?

Lovable manages the Supabase project and doesn't expose the service role key. Edge Functions run inside Supabase and have internal access to the service role, allowing them to bypass RLS for admin operations.

## Function List

| Function | Purpose | Endpoint |
|----------|---------|----------|
| `store-oauth-tokens` | Store OAuth tokens for integrations | POST |
| `get-oauth-tokens` | Retrieve OAuth tokens | POST |
| `sync-write` | Write sync data (tasks, invoices, etc.) | POST |

---

## 1. store-oauth-tokens

Stores OAuth tokens for QuickBooks, HubSpot, or other integrations.

### Edge Function Code

Create this in Supabase Dashboard → Edge Functions → New Function

```typescript
// supabase/functions/store-oauth-tokens/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { service, agencyId, tokens } = await req.json()

    if (!service || !agencyId || !tokens) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: service, agencyId, tokens' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create service role client (has full access)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const tokenKey = `${service}:agency_${agencyId}`

    // Upsert tokens
    const { error: tokenError } = await supabase
      .from('pulse_sync_tokens')
      .upsert(
        {
          service: tokenKey,
          tokens: tokens,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'service' }
      )

    if (tokenError) {
      console.error('Failed to store tokens:', tokenError)
      return new Response(
        JSON.stringify({ error: 'Failed to store tokens' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // If QuickBooks, also update agency with realm_id
    if (service === 'quickbooks' && tokens.realm_id) {
      await supabase
        .from('agencies')
        .update({ quickbooks_realm_id: tokens.realm_id })
        .eq('id', agencyId)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

### Backend Usage

```typescript
await fetch(`${SUPABASE_URL}/functions/v1/store-oauth-tokens`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    service: 'quickbooks',
    agencyId: 'agency-uuid',
    tokens: {
      access_token: '...',
      refresh_token: '...',
      realm_id: '123456',
      expires_in: 3600,
      created_at: new Date().toISOString(),
    },
  }),
});
```

---

## 2. get-oauth-tokens

Retrieves OAuth tokens for a specific service and agency.

### Edge Function Code

```typescript
// supabase/functions/get-oauth-tokens/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { service, agencyId } = await req.json()

    if (!service || !agencyId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: service, agencyId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const tokenKey = `${service}:agency_${agencyId}`

    const { data, error } = await supabase
      .from('pulse_sync_tokens')
      .select('tokens, updated_at')
      .eq('service', tokenKey)
      .single()

    if (error || !data) {
      return new Response(
        JSON.stringify({ error: 'Tokens not found', tokens: null }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ tokens: data.tokens, updated_at: data.updated_at }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

### Backend Usage

```typescript
const response = await fetch(`${SUPABASE_URL}/functions/v1/get-oauth-tokens`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    service: 'quickbooks',
    agencyId: 'agency-uuid',
  }),
});

const { tokens } = await response.json();
```

---

## 3. sync-write

Generic function to write sync data (tasks, invoices, time entries, etc.)

### Edge Function Code

```typescript
// supabase/functions/sync-write/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { table, data, onConflict } = await req.json()

    if (!table || !data) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: table, data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Allowlist of tables that can be written to
    const allowedTables = [
      'pulse_tasks',
      'pulse_time_entries',
      'pulse_invoices',
      'pulse_payments',
      'pulse_sync_logs',
    ]

    if (!allowedTables.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Table '${table}' is not allowed` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Handle array of records or single record
    const records = Array.isArray(data) ? data : [data]

    let query = supabase.from(table)

    if (onConflict) {
      const { error } = await query.upsert(records, { onConflict })
      if (error) throw error
    } else {
      const { error } = await query.insert(records)
      if (error) throw error
    }

    return new Response(
      JSON.stringify({ success: true, count: records.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

### Backend Usage

```typescript
// Write ClickUp tasks
await fetch(`${SUPABASE_URL}/functions/v1/sync-write`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    table: 'pulse_tasks',
    data: [
      { id: 'task-1', name: 'Task 1', contract_id: '...', ... },
      { id: 'task-2', name: 'Task 2', contract_id: '...', ... },
    ],
    onConflict: 'id', // Upsert based on ID
  }),
});
```

---

## Deploying Edge Functions

### Via Supabase Dashboard

1. Go to Supabase Dashboard → Edge Functions
2. Click "New Function"
3. Name it (e.g., `store-oauth-tokens`)
4. Paste the code
5. Deploy

### Via Supabase CLI (if available)

```bash
supabase functions deploy store-oauth-tokens
supabase functions deploy get-oauth-tokens
supabase functions deploy sync-write
```

---

## Security Notes

1. **Edge Functions use the anon key for authorization** - This verifies the request comes from an authorized source
2. **Service role is only used internally** - The Edge Function creates its own service role client
3. **Table allowlist** - The `sync-write` function only allows writing to specific tables
4. **No user context needed** - These are system operations, not user-scoped

---

## Backend Utility

Add this utility to the backend for calling Edge Functions:

```typescript
// src/utils/edge-functions.ts
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

export async function callEdgeFunction<T>(
  functionName: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Edge function ${functionName} failed`);
  }

  return response.json();
}

// Typed helpers
export async function storeOAuthTokens(
  service: string,
  agencyId: string,
  tokens: Record<string, unknown>
): Promise<{ success: boolean }> {
  return callEdgeFunction('store-oauth-tokens', { service, agencyId, tokens });
}

export async function getOAuthTokens(
  service: string,
  agencyId: string
): Promise<{ tokens: Record<string, unknown> | null }> {
  return callEdgeFunction('get-oauth-tokens', { service, agencyId });
}

export async function syncWrite(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  onConflict?: string
): Promise<{ success: boolean; count: number }> {
  return callEdgeFunction('sync-write', { table, data, onConflict });
}
```
