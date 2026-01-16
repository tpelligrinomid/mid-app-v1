/**
 * Utility for calling Supabase Edge Functions
 *
 * Edge Functions handle privileged operations that require service role access.
 * The Render backend calls these functions via HTTP - they run inside Supabase
 * and have internal access to the service role key.
 */

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

export interface EdgeFunctionError {
  error: string;
}

/**
 * Call a Supabase Edge Function
 */
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Edge function ${functionName} failed`);
  }

  return data as T;
}

// ============================================================================
// OAuth Token Functions
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
): Promise<{ success: boolean }> {
  return callEdgeFunction('store-oauth-tokens', { service, agencyId, tokens });
}

/**
 * Retrieve OAuth tokens for an integration
 */
export async function getOAuthTokens(
  service: string,
  agencyId: string
): Promise<{ tokens: OAuthTokens | null; updated_at?: string }> {
  try {
    return await callEdgeFunction('get-oauth-tokens', { service, agencyId });
  } catch (error) {
    // Token not found is not an error, just return null
    return { tokens: null };
  }
}

// ============================================================================
// Sync Write Functions
// ============================================================================

/**
 * Write sync data to the database (tasks, invoices, time entries, etc.)
 * Uses service role internally to bypass RLS.
 */
export async function syncWrite(
  table: string,
  data: Record<string, unknown> | Record<string, unknown>[],
  onConflict?: string
): Promise<{ success: boolean; count: number }> {
  return callEdgeFunction('sync-write', { table, data, onConflict });
}

/**
 * Write ClickUp tasks
 */
export async function syncClickUpTasks(
  tasks: Record<string, unknown>[]
): Promise<{ success: boolean; count: number }> {
  return syncWrite('pulse_tasks', tasks, 'clickup_id');
}

/**
 * Write ClickUp time entries
 */
export async function syncClickUpTimeEntries(
  entries: Record<string, unknown>[]
): Promise<{ success: boolean; count: number }> {
  return syncWrite('pulse_time_entries', entries, 'clickup_id');
}

/**
 * Write QuickBooks invoices
 */
export async function syncQuickBooksInvoices(
  invoices: Record<string, unknown>[]
): Promise<{ success: boolean; count: number }> {
  return syncWrite('pulse_invoices', invoices, 'quickbooks_id');
}

/**
 * Write QuickBooks payments
 */
export async function syncQuickBooksPayments(
  payments: Record<string, unknown>[]
): Promise<{ success: boolean; count: number }> {
  return syncWrite('pulse_payments', payments, 'quickbooks_id');
}

/**
 * Log a sync operation
 */
export async function logSync(
  service: string,
  agencyId: string,
  status: 'success' | 'error',
  details: Record<string, unknown>
): Promise<{ success: boolean; count: number }> {
  return syncWrite('pulse_sync_logs', {
    service,
    agency_id: agencyId,
    status,
    details,
    synced_at: new Date().toISOString(),
  });
}
