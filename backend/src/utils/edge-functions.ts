/**
 * Utility for calling Supabase Edge Functions via the backend-proxy
 *
 * The backend-proxy is a generic Edge Function that handles all database
 * operations using the service role. It validates requests using a shared
 * secret (EDGE_FUNCTION_SECRET) sent via the x-backend-key header.
 *
 * Operations supported: select, insert, update, upsert, delete, rpc
 */

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const EDGE_FUNCTION_SECRET = process.env.EDGE_FUNCTION_SECRET!;

const PROXY_ENDPOINT = `${SUPABASE_URL}/functions/v1/backend-proxy`;

// ============================================================================
// Types
// ============================================================================

interface FilterValue {
  eq?: unknown;
  neq?: unknown;
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  like?: string;
  ilike?: string;
  in?: unknown[];
  is?: null | boolean;
}

type Filters = Record<string, unknown | FilterValue>;

interface QueryOptions {
  count?: 'exact' | 'planned' | 'estimated';
  onConflict?: string;
  returning?: 'minimal' | 'representation';
  single?: boolean;
  limit?: number;
  offset?: number;
  order?: Array<{ column: string; ascending?: boolean }>;
}

interface ProxyRequest {
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  table?: string;
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Filters;
  select?: string;
  rpc_name?: string;
  rpc_params?: Record<string, unknown>;
  options?: QueryOptions;
}

interface ProxyResponse<T = unknown> {
  data: T;
  count?: number | null;
  error?: { message: string; code?: string };
}

// ============================================================================
// Core Proxy Function
// ============================================================================

/**
 * Call the backend-proxy Edge Function
 */
async function callProxy<T>(request: ProxyRequest): Promise<ProxyResponse<T>> {
  const response = await fetch(PROXY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-backend-key': EDGE_FUNCTION_SECRET,
    },
    body: JSON.stringify(request),
  });

  const result = await response.json() as ProxyResponse<T>;

  if (!response.ok || result.error) {
    throw new Error(result.error?.message || String(result.error) || 'Proxy request failed');
  }

  return result;
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * SELECT query
 */
export async function select<T = unknown>(
  table: string,
  options?: {
    select?: string;
    filters?: Filters;
    order?: Array<{ column: string; ascending?: boolean }>;
    limit?: number;
    offset?: number;
    single?: boolean;
  }
): Promise<T> {
  const { data } = await callProxy<T>({
    operation: 'select',
    table,
    select: options?.select,
    filters: options?.filters,
    options: {
      order: options?.order,
      limit: options?.limit,
      offset: options?.offset,
      single: options?.single,
    },
  });
  return data;
}

/**
 * INSERT query
 */
export async function insert<T = unknown>(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  options?: { select?: string }
): Promise<T> {
  const result = await callProxy<T>({
    operation: 'insert',
    table,
    data,
    select: options?.select,
  });
  return result.data;
}

/**
 * UPDATE query
 */
export async function update<T = unknown>(
  table: string,
  data: Record<string, unknown>,
  filters: Filters,
  options?: { select?: string }
): Promise<T> {
  const result = await callProxy<T>({
    operation: 'update',
    table,
    data,
    filters,
    select: options?.select,
  });
  return result.data;
}

/**
 * UPSERT query (insert or update on conflict)
 */
export async function upsert<T = unknown>(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  options?: { onConflict?: string; select?: string }
): Promise<T> {
  const result = await callProxy<T>({
    operation: 'upsert',
    table,
    data,
    select: options?.select,
    options: { onConflict: options?.onConflict },
  });
  return result.data;
}

/**
 * DELETE query
 */
export async function del<T = unknown>(
  table: string,
  filters: Filters,
  options?: { select?: string }
): Promise<T> {
  const result = await callProxy<T>({
    operation: 'delete',
    table,
    filters,
    select: options?.select,
  });
  return result.data;
}

/**
 * RPC (stored procedure) call
 */
export async function rpc<T = unknown>(
  functionName: string,
  params?: Record<string, unknown>
): Promise<T> {
  const result = await callProxy<T>({
    operation: 'rpc',
    rpc_name: functionName,
    rpc_params: params,
  });
  return result.data;
}

// ============================================================================
// OAuth Token Helpers
// ============================================================================

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  realm_id?: string;
  created_at: string;
}

/**
 * Store OAuth tokens for an integration (QuickBooks, HubSpot, etc.)
 */
export async function storeOAuthTokens(
  service: string,
  agencyId: string,
  tokens: OAuthTokens
): Promise<void> {
  const tokenKey = `${service}:agency_${agencyId}`;

  await upsert(
    'pulse_sync_tokens',
    {
      service: tokenKey,
      tokens: tokens,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'service' }
  );

  // If QuickBooks, also update agency with realm_id
  if (service === 'quickbooks' && tokens.realm_id) {
    await update(
      'agencies',
      { quickbooks_realm_id: tokens.realm_id },
      { id: agencyId }
    );
  }
}

/**
 * Retrieve OAuth tokens for an integration
 */
export async function getOAuthTokens(
  service: string,
  agencyId: string
): Promise<OAuthTokens | null> {
  const tokenKey = `${service}:agency_${agencyId}`;

  try {
    const result = await select<{ tokens: OAuthTokens }>(
      'pulse_sync_tokens',
      {
        select: 'tokens',
        filters: { service: tokenKey },
        single: true,
      }
    );
    return result?.tokens || null;
  } catch {
    return null;
  }
}

// ============================================================================
// Sync Helpers
// ============================================================================

/**
 * Sync ClickUp tasks (upsert by clickup_task_id)
 */
export async function syncClickUpTasks(
  tasks: Record<string, unknown>[]
): Promise<{ count: number }> {
  await upsert('pulse_tasks', tasks, { onConflict: 'clickup_task_id' });
  return { count: tasks.length };
}

/**
 * Sync ClickUp time entries
 */
export async function syncClickUpTimeEntries(
  entries: Record<string, unknown>[]
): Promise<{ count: number }> {
  await upsert('pulse_time_entries', entries, { onConflict: 'clickup_id' });
  return { count: entries.length };
}

/**
 * Sync QuickBooks invoices
 */
export async function syncQuickBooksInvoices(
  invoices: Record<string, unknown>[]
): Promise<{ count: number }> {
  await upsert('pulse_invoices', invoices, { onConflict: 'quickbooks_id' });
  return { count: invoices.length };
}

/**
 * Sync QuickBooks payments
 */
export async function syncQuickBooksPayments(
  payments: Record<string, unknown>[]
): Promise<{ count: number }> {
  await upsert('pulse_payments', payments, { onConflict: 'quickbooks_id' });
  return { count: payments.length };
}

/**
 * Log a sync operation
 */
export async function logSync(
  service: string,
  agencyId: string,
  status: 'success' | 'error',
  details: Record<string, unknown>
): Promise<void> {
  await insert('pulse_sync_logs', {
    service,
    agency_id: agencyId,
    status,
    details,
    synced_at: new Date().toISOString(),
  });
}
