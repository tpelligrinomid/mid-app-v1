import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

/**
 * Create a Supabase client with a user's JWT token.
 * This client will respect RLS policies for the authenticated user.
 *
 * NOTE: We do not have access to the service role key (Lovable manages Supabase).
 * All database operations must go through the authenticated user's client.
 * RLS policies must be configured to support all required operations.
 */
export function createUserClient(token: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

/**
 * Validate environment variables are set
 */
export function validateSupabaseConfig(): void {
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is required');
  }
  if (!supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY is required');
  }
}
