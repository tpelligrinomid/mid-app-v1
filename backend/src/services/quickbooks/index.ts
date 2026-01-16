import OAuthClient from 'intuit-oauth';
import {
  storeOAuthTokens,
  getOAuthTokens,
  OAuthTokens,
} from '../../utils/edge-functions.js';

// QuickBooks OAuth configuration (one app for all agencies)
const oauthClient = new OAuthClient({
  clientId: process.env.QUICKBOOKS_CLIENT_ID!,
  clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET!,
  environment: (process.env.QUICKBOOKS_ENVIRONMENT as 'sandbox' | 'production') || 'production',
  redirectUri: process.env.QUICKBOOKS_REDIRECT_URI!,
});

export interface QuickBooksTokens extends OAuthTokens {
  realm_id: string;
}

/**
 * Generate the QuickBooks OAuth authorization URL
 * @param agencyId - The agency initiating the OAuth flow (passed in state)
 */
export function getAuthorizationUrl(agencyId: string): string {
  // Encode agency ID in state for callback
  const state = Buffer.from(JSON.stringify({ agencyId })).toString('base64');

  return oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state,
  });
}

/**
 * Parse state parameter from OAuth callback
 * Returns agency ID
 */
export function parseState(state: string): { agencyId: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
    if (decoded.agencyId) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Exchange authorization code for tokens and store them via Edge Function
 * @param url - The callback URL with authorization code
 * @param agencyId - The agency to store tokens for
 */
export async function handleCallback(
  url: string,
  agencyId: string
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

  // Store tokens via Edge Function (uses service role internally)
  await storeOAuthTokens('quickbooks', agencyId, tokenData);

  return tokenData;
}

/**
 * Get stored tokens from database via Edge Function
 * @param agencyId - The agency to get tokens for
 */
export async function getStoredTokens(
  agencyId: string
): Promise<QuickBooksTokens | null> {
  const { tokens } = await getOAuthTokens('quickbooks', agencyId);
  return tokens as QuickBooksTokens | null;
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
 * Refresh the access token if expired
 * @param agencyId - The agency to refresh tokens for
 */
export async function refreshTokenIfNeeded(
  agencyId: string
): Promise<QuickBooksTokens | null> {
  const tokens = await getStoredTokens(agencyId);

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
      token_type: tokens.token_type || 'Bearer',
      expires_in: tokens.expires_in,
      x_refresh_token_expires_in: tokens.x_refresh_token_expires_in || 0,
      realmId: tokens.realm_id,
    });

    const refreshResponse = await oauthClient.refresh();
    const newTokens = refreshResponse.getJson();

    const tokenData: QuickBooksTokens = {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      token_type: newTokens.token_type,
      expires_in: newTokens.expires_in,
      x_refresh_token_expires_in: newTokens.x_refresh_token_expires_in,
      realm_id: tokens.realm_id, // Keep the same realm ID
      created_at: new Date().toISOString(),
    };

    // Store refreshed tokens via Edge Function
    await storeOAuthTokens('quickbooks', agencyId, tokenData);

    console.log(`QuickBooks token refreshed successfully for agency ${agencyId}`);
    return tokenData;
  } catch (error) {
    console.error(`Failed to refresh QuickBooks token for agency ${agencyId}:`, error);
    return null;
  }
}

/**
 * Get a valid OAuth client ready for API calls
 * @param agencyId - The agency to get authenticated client for
 * @returns Object with client and realmId, or null if not connected
 */
export async function getAuthenticatedClient(
  agencyId: string
): Promise<{ client: OAuthClient; realmId: string } | null> {
  const tokens = await refreshTokenIfNeeded(agencyId);

  if (!tokens) {
    return null;
  }

  oauthClient.setToken({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type || 'Bearer',
    expires_in: tokens.expires_in,
    x_refresh_token_expires_in: tokens.x_refresh_token_expires_in || 0,
    realmId: tokens.realm_id,
  });

  return { client: oauthClient, realmId: tokens.realm_id };
}

/**
 * Get the company (realm) ID for a specific agency
 * @param agencyId - The agency to get realm ID for
 */
export async function getRealmId(agencyId: string): Promise<string | null> {
  const tokens = await getStoredTokens(agencyId);
  return tokens?.realm_id || null;
}

/**
 * Check if QuickBooks is connected for an agency
 * @param agencyId - The agency to check
 */
export async function isConnected(agencyId: string): Promise<boolean> {
  const tokens = await getStoredTokens(agencyId);
  return tokens !== null;
}
