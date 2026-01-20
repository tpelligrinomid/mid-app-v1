/**
 * Database Proxy Client
 *
 * Uses Lovable's backend-proxy Edge Function to perform database operations.
 * The Edge Function has access to SUPABASE_SERVICE_ROLE_KEY internally,
 * so it can bypass RLS. Authentication is via x-backend-key header.
 *
 * This is used for cron jobs and other background operations that don't
 * have a user context.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const BACKEND_API_KEY = process.env.BACKEND_API_KEY;

interface ProxyPayload {
  operation: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  table: string;
  data?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Record<string, unknown>;
  select?: string;
  onConflict?: string;
  single?: boolean;
  count?: 'exact' | 'planned' | 'estimated';
}

interface ProxyResponse<T = unknown> {
  data: T | null;
  error: { message: string; code?: string } | null;
  count?: number;
}

/**
 * Call the backend-proxy Edge Function
 */
async function callProxy<T = unknown>(payload: ProxyPayload): Promise<ProxyResponse<T>> {
  if (!SUPABASE_URL) {
    throw new Error('SUPABASE_URL is required');
  }
  if (!BACKEND_API_KEY) {
    throw new Error('BACKEND_API_KEY is required for database proxy operations');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/backend-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-backend-key': BACKEND_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      data: null,
      error: { message: `Proxy error: ${response.status} - ${errorText}` }
    };
  }

  return response.json() as Promise<ProxyResponse<T>>;
}

/**
 * Database Proxy Client
 * Provides a Supabase-like interface that uses the Edge Function
 */
export class DbProxyClient {
  /**
   * Select rows from a table
   */
  async select<T = unknown>(
    table: string,
    options: {
      columns?: string;
      filters?: Record<string, unknown>;
      single?: boolean;
    } = {}
  ): Promise<ProxyResponse<T>> {
    return callProxy<T>({
      operation: 'select',
      table,
      select: options.columns || '*',
      filters: options.filters,
      single: options.single
    });
  }

  /**
   * Insert rows into a table
   */
  async insert<T = unknown>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    options: { select?: string } = {}
  ): Promise<ProxyResponse<T>> {
    return callProxy<T>({
      operation: 'insert',
      table,
      data,
      select: options.select
    });
  }

  /**
   * Update rows in a table
   */
  async update<T = unknown>(
    table: string,
    data: Record<string, unknown>,
    filters: Record<string, unknown>,
    options: { select?: string } = {}
  ): Promise<ProxyResponse<T>> {
    return callProxy<T>({
      operation: 'update',
      table,
      data,
      filters,
      select: options.select
    });
  }

  /**
   * Upsert rows in a table (insert or update on conflict)
   */
  async upsert<T = unknown>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    options: { onConflict?: string; select?: string } = {}
  ): Promise<ProxyResponse<T>> {
    return callProxy<T>({
      operation: 'upsert',
      table,
      data,
      onConflict: options.onConflict,
      select: options.select
    });
  }

  /**
   * Delete rows from a table
   */
  async delete<T = unknown>(
    table: string,
    filters: Record<string, unknown>
  ): Promise<ProxyResponse<T>> {
    return callProxy<T>({
      operation: 'delete',
      table,
      filters
    });
  }
}

// Singleton instance
export const dbProxy = new DbProxyClient();

export default dbProxy;
