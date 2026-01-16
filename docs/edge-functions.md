# MiD Platform - Supabase Edge Functions

Edge Functions handle privileged database operations that require service role access. The Render backend calls these functions via HTTP.

## Why Edge Functions?

Lovable manages the Supabase project and doesn't expose the service role key. Edge Functions run inside Supabase and have internal access to the service role, allowing them to bypass RLS for admin operations.

## Security: Shared Secret

Edge Functions validate requests using a shared secret (`EDGE_FUNCTION_SECRET`) to ensure only our Render backend can call them.

### Setup

1. **Generate a secret:**
   ```bash
   openssl rand -base64 32
   ```
   Example output: `K7gNj2xF4mP9qR3sT6vW8yB1cD5eH0jL`

2. **Store in Render** (Environment Variables):
   | Variable | Value |
   |----------|-------|
   | `EDGE_FUNCTION_SECRET` | `K7gNj2xF4mP9qR3sT6vW8yB1cD5eH0jL` |

3. **Store in Supabase** (Edge Function Secrets):
   - Go to Supabase Dashboard → Edge Functions → Secrets
   - Add: `EDGE_FUNCTION_SECRET` = `K7gNj2xF4mP9qR3sT6vW8yB1cD5eH0jL`

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-edge-secret',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate shared secret
    const secret = req.headers.get('x-edge-secret')
    if (secret !== Deno.env.get('EDGE_FUNCTION_SECRET')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-edge-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate shared secret
    const secret = req.headers.get('x-edge-secret')
    if (secret !== Deno.env.get('EDGE_FUNCTION_SECRET')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-edge-secret',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate shared secret
    const secret = req.headers.get('x-edge-secret')
    if (secret !== Deno.env.get('EDGE_FUNCTION_SECRET')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

---

## Deploying Edge Functions

### Via Supabase Dashboard

1. Go to Supabase Dashboard → Edge Functions
2. Click "New Function"
3. Name it (e.g., `store-oauth-tokens`)
4. Paste the code
5. Deploy
6. **Add the secret:** Go to Edge Functions → Secrets → Add `EDGE_FUNCTION_SECRET`

### Via Supabase CLI (if available)

```bash
supabase functions deploy store-oauth-tokens
supabase functions deploy get-oauth-tokens
supabase functions deploy sync-write
```

---

## Security Summary

| Layer | Protection |
|-------|------------|
| **Shared Secret** | `x-edge-secret` header validates request is from Render backend |
| **Table Allowlist** | `sync-write` only allows specific tables |
| **Service Role** | Only used internally by Edge Functions, never exposed |
| **CORS** | Configured for cross-origin requests |

---

## Environment Variables Summary

### Render Backend

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `EDGE_FUNCTION_SECRET` | Shared secret for Edge Function auth |

### Supabase Edge Functions (Secrets)

| Secret | Description |
|--------|-------------|
| `EDGE_FUNCTION_SECRET` | Same shared secret as Render |

Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to Edge Functions.
