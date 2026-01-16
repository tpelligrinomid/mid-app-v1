import OAuthClient from 'intuit-oauth';
import { SupabaseClient } from '@supabase/supabase-js';

// QuickBooks OAuth configuration (one app for all agencies)
const oauthClient = new OAuthClient({
  clientId: process.env.QUICKBOOKS_CLIENT_ID!,
  clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
  environment: (process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production') || 'production',
  redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
});

export interface QuickBooksTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  realm_id: string;
  created_at: string;
}

/**
 * Generate token storage key for an agency
 * Each agency gets its own token entry: "quickbooks:agency_<id>"
 */
function getTokenKey(agencyId: string): string {
  return `quickbooks:agency_${agencyId}`;
}

/**
 * Generate the QuickBooks OAuth authorization URL
 * @param agencyId - The agency initiating the OAuth flow (passed in state)
 * @param userToken - The user's JWT token (included in state for callback auth)
 */
export function getAuthorizationUrl(agencyId: string, userToken: string): string {
  // Encode both agency ID and user token in state so callback can authenticate
  const state = Buffer.from(JSON.stringify({ agencyId, userToken })).toString('base64');

  return oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state,
  });
}

/**
 * Parse state parameter from OAuth callback
 * Returns agency ID and user token for re-authentication
 */
export function parseState(state: string): { agencyId: string; userToken: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    if (decoded.agencyId && decoded.userToken) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Exchange authorization code for tokens and store them for a specific agency
 * @param url - The callback URL with authorization code
 * @param agencyId - The agency to store tokens for
 * @param supabase - Authenticated Supabase client (must have write access to pulse_sync_tokens)
 */
export async function handleCallback(
  url: string,
  agencyId: string,
  supabase: SupabaseClient
): Promise<QuickBooksTokens> {
  const authResponse = await oauthClient.createToken(url);
  const tokens = authResponse.getJson();

  const tokenData: QuickBooksTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    x_refresh_token_expires_in: tokens.x_refresh_token_expires_in,
    realm_id: tokens.realmId,
    created_at: new Date().toISOString(),
  };

  const tokenKey = getTokenKey(agencyId);

  // Upsert tokens in pulse_sync_tokens table (keyed by agency)
  // RLS must allow admin/team_member to write to this table
  const { error } = await supabase
    .from('pulse_sync_tokens')
    .upsert(
      {
        service: tokenKey,
        tokens: tokenData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'service' }
    );

  if (error) {
    console.error('Failed to store QuickBooks tokens:', error);
    throw new Error('Failed to store tokens');
  }

  // Also update the agency record with the realm_id for reference
  const { error: agencyError } = await supabase
    .from('agencies')
    .update({ quickbooks_realm_id: tokens.realmId })
    .eq('id', agencyId);

  if (agencyError) {
    console.error('Failed to update agency with realm_id:', agencyError);
    // Non-fatal - tokens are stored, just the agency reference failed
  }

  return tokenData;
}

/**
 * Get stored tokens from database for a specific agency
 * @param agencyId - The agency to get tokens for
 * @param supabase - Authenticated Supabase client
 */
export async function getStoredTokens(
  agencyId: string,
  supabase: SupabaseClient
): Promise<QuickBooksTokens | null> {
  const tokenKey = getTokenKey(agencyId);

  const { data, error } = await supabase
    .from('pulse_sync_tokens')
    .select('tokens')
    .eq('service', tokenKey)
    .single();

  if (error || !data) {
    return null;
  }

  return data.tokens as QuickBooksTokens;
}

/**
 * Get all agencies with QuickBooks connections
 * @param supabase - Authenticated Supabase client
 */
export async function getAllConnectedAgencies(
  supabase: SupabaseClient
): Promise<Array<{ id: string; name: string; realm_id: string }>> {
  const { data, error } = await supabase
    .from('agencies')
    .select('id, name, quickbooks_realm_id')
    .not('quickbooks_realm_id', 'is', null);

  if (error || !data) {
    return [];
  }

  return data.map(a => ({
    id: a.id,
    name: a.name,
    realm_id: a.quickbooks_realm_id,
  }));
}

/**
 * Check if the access token is expired (with 5-minute buffer)
 */
function isTokenExpired(tokens: QuickBooksTokens): boolean {
  const createdAt = new Date(tokens.created_at).getTime();
  const expiresAt = createdAt + (tokens.expires_in * 1000) - (5 * 60 * 1000); // 5 min buffer
  return Date.now() > expiresAt;
}

/**
 * Refresh the access token if expired for a specific agency
 * @param agencyId - The agency to refresh tokens for
 * @param supabase - Authenticated Supabase client
 */
export async function refreshTokenIfNeeded(
  agencyId: string,
  supabase: SupabaseClient
): Promise<QuickBooksTokens | null> {
  const tokens = await getStoredTokens(agencyId, supabase);

  if (!tokens) {
    console.error(`No QuickBooks tokens found for agency ${agencyId}`);
    return null;
  }

  if (!isTokenExpired(tokens)) {
    return tokens;
  }

  console.log(`QuickBooks token expired for agency ${agencyId}, refreshing...`);

  try {
    // Set the token on the client
    oauthClient.setToken({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type,
      expires_in: tokens.expires_in,
      x_refresh_token_expires_in: tokens.x_refresh_token_expires_in,
      realmId: tokens.realm_id,
    });

    const refreshResponse = await oauthClient.refresh();
    const newTokens = refreshResponse.getJson();

    const tokenKey = getTokenKey(agencyId);
    const tokenData: QuickBooksTokens = {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      token_type: newTokens.token_type,
      expires_in: newTokens.expires_in,
      x_refresh_token_expires_in: newTokens.x_refresh_token_expires_in,
      realm_id: tokens.realm_id, // Keep the same realm ID
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('pulse_sync_tokens')
      .upsert(
        {
          service: tokenKey,
          tokens: tokenData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'service' }
      );

    if (error) {
      console.error('Failed to store refreshed tokens:', error);
      throw new Error('Failed to store refreshed tokens');
    }

    console.log(`QuickBooks token refreshed successfully for agency ${agencyId}`);
    return tokenData;
  } catch (error) {
    console.error(`Failed to refresh QuickBooks token for agency ${agencyId}:`, error);
    return null;
  }
}

/**
 * Get a valid OAuth client ready for API calls for a specific agency
 * @param agencyId - The agency to get authenticated client for
 * @param supabase - Authenticated Supabase client
 * @returns Object with client and realmId, or null if not connected
 */
export async function getAuthenticatedClient(
  agencyId: string,
  supabase: SupabaseClient
): Promise<{ client: OAuthClient; realmId: string } | null> {
  const tokens = await refreshTokenIfNeeded(agencyId, supabase);

  if (!tokens) {
    return null;
  }

  oauthClient.setToken({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    x_refresh_token_expires_in: tokens.x_refresh_token_expires_in,
    realmId: tokens.realm_id,
  });

  return { client: oauthClient, realmId: tokens.realm_id };
}

/**
 * Get the company (realm) ID for a specific agency
 * @param agencyId - The agency to get realm ID for
 * @param supabase - Authenticated Supabase client
 */
export async function getRealmId(
  agencyId: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const tokens = await getStoredTokens(agencyId, supabase);
  return tokens?.realm_id || null;
}
