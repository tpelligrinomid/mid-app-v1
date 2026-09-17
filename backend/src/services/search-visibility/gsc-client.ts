/**
 * Google Search Console API client
 *
 * Access is via the SINGLE shared MiD/NewNorth Google account that clients add
 * as a user on their own property. That account already holds verified access
 * to the client portfolio, so this deliberately reuses Master Marketer's
 * existing credential — same env var names, same refresh token, same identity —
 * rather than introducing a service account that every client would have to
 * grant from scratch.
 *
 * Nothing here reads a token from the database: there is no per-contract OAuth,
 * only this one long-lived refresh token.
 *
 * Follows the HubSpot / Master Marketer pattern: native fetch, module-level
 * config, exported functions.
 *
 * Environment variables (shared with Master Marketer):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_GSC_REFRESH_TOKEN
 *   GSC_ACCOUNT_EMAIL  — display only; the address clients grant access to
 *
 * Spec: docs/spec-search-visibility-tracking.md §4.4
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/webmasters/v3';

/** Google caps a single searchAnalytics page at 25,000 rows. */
const MAX_ROW_LIMIT = 25000;

// ============================================================================
// Config
// ============================================================================

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function getCredentials(): OAuthCredentials {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_GSC_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Search Console credentials are not configured. Set GOOGLE_CLIENT_ID, ' +
        'GOOGLE_CLIENT_SECRET and GOOGLE_GSC_REFRESH_TOKEN (the same values Master Marketer uses).'
    );
  }

  return { clientId, clientSecret, refreshToken };
}

/** Whether credentials are present, for health checks and config UI. */
export function isConfigured(): boolean {
  try {
    getCredentials();
    return true;
  } catch {
    return false;
  }
}

/**
 * The address clients add to their property, for display in the settings panel.
 * A refresh token doesn't carry the account address, so this is configured
 * separately and is cosmetic — it never affects which account actually calls.
 */
export function getGscAccountEmail(): string {
  return process.env.GSC_ACCOUNT_EMAIL || 'the MiD Google account';
}

// ============================================================================
// Auth
// ============================================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Exchange the long-lived refresh token for an access token.
 * Cached until 60s before expiry — one token serves every contract, since the
 * same account is the principal on every property.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { clientId, clientSecret, refreshToken } = getCredentials();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    // A revoked or expired refresh token fails here for every contract at once,
    // so name it plainly rather than letting it read as a per-property problem.
    throw new Error(
      `Google token refresh failed: ${response.status} — ${detail.substring(0, 300)}. ` +
        'If this persists, the shared refresh token may have been revoked and needs re-issuing.'
    );
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedToken.token;
}

// ============================================================================
// Request helper
// ============================================================================

export class GscAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly siteUrl?: string
  ) {
    super(message);
    this.name = 'GscAccessError';
  }
}

async function gscFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = await response.text();

    // 403 here almost always means our account was never added to this property
    // yet, which is an onboarding state rather than a bug. Typed so callers can
    // surface "not yet granted" instead of a stack trace.
    if (response.status === 403 || response.status === 404) {
      throw new GscAccessError(
        `Search Console denied access (${response.status}). The MiD account may not have access to this property.`,
        response.status
      );
    }

    throw new Error(`Search Console API error: ${response.status} — ${detail.substring(0, 300)}`);
  }

  return (await response.json()) as T;
}

// ============================================================================
// sites.list
// ============================================================================

export interface GscSite {
  siteUrl: string;
  permissionLevel: 'siteOwner' | 'siteFullUser' | 'siteRestrictedUser' | 'siteUnverifiedUser';
}

/**
 * Every property the shared MiD account can see.
 *
 * This is both the property picker and the access check — a contract's property
 * is chosen from this list, never hand-typed, because a wrong or mistyped
 * property returns a thin dataset that reads as poor SEO performance rather
 * than as a misconfiguration.
 */
export async function listSites(): Promise<GscSite[]> {
  const data = await gscFetch<{ siteEntry?: GscSite[] }>('/sites');
  return data.siteEntry ?? [];
}

/**
 * Whether a permission level can read Search Analytics.
 *
 * Restricted is enough — it grants "view Performance reports", which is the
 * whole of what this module reads.
 *
 * `siteUnverifiedUser` is the one that cannot, and it means something specific:
 * the property is one we hold directly rather than one a client delegated to
 * us, and its *ownership verification* has lapsed — typically because a site
 * rebuild removed the verification HTML file. The fix is re-verifying
 * ownership on our side, not asking the client for a user grant. Those two
 * remediations are completely different, so callers must not collapse this
 * into a generic "no access" state.
 */
export function canReadAnalytics(permissionLevel: string): boolean {
  return permissionLevel !== 'siteUnverifiedUser';
}

// ============================================================================
// searchanalytics.query
// ============================================================================

export interface GscQueryRow {
  query: string;
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topUrl?: string;
}

interface RawAnalyticsResponse {
  rows?: Array<{
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
}

/**
 * Pull per-query, per-day Search Analytics rows for a date range.
 *
 * Paginates to exhaustion: Google returns at most 25,000 rows per request and
 * signals the end by returning fewer than asked for.
 *
 * Note that Google withholds anonymized low-volume queries, so these rows will
 * never sum to the property totals shown in the GSC UI. That is expected and is
 * surfaced as a footnote in the report rather than reconciled.
 */
export async function fetchSearchAnalytics(
  siteUrl: string,
  startDate: string,
  endDate: string,
  options: { rowLimit?: number; maxRows?: number } = {}
): Promise<GscQueryRow[]> {
  const rowLimit = Math.min(options.rowLimit ?? MAX_ROW_LIMIT, MAX_ROW_LIMIT);
  const maxRows = options.maxRows ?? Infinity;
  const encoded = encodeURIComponent(siteUrl);

  const collected: GscQueryRow[] = [];
  let startRow = 0;

  for (;;) {
    let data: RawAnalyticsResponse;

    try {
      data = await gscFetch<RawAnalyticsResponse>(`/sites/${encoded}/searchAnalytics/query`, {
        method: 'POST',
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['query', 'date'],
          type: 'web',
          rowLimit,
          startRow,
          dataState: 'final',
        }),
      });
    } catch (error) {
      if (error instanceof GscAccessError) {
        throw new GscAccessError(error.message, error.status, siteUrl);
      }
      throw error;
    }

    const rows = data.rows ?? [];

    for (const row of rows) {
      const [query, date] = row.keys;
      collected.push({
        query,
        date,
        clicks: row.clicks ?? 0,
        impressions: row.impressions ?? 0,
        ctr: row.ctr ?? 0,
        position: row.position ?? 0,
      });
    }

    if (rows.length < rowLimit || collected.length >= maxRows) break;
    startRow += rows.length;
  }

  return collected;
}

/**
 * One cheap row, used by the bind/verify flow to prove access actually works.
 * A property can appear in sites.list and still fail here, so listing alone is
 * not sufficient proof.
 */
export async function verifyAccess(
  siteUrl: string
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);

  try {
    await fetchSearchAnalytics(siteUrl, isoDate(start), isoDate(end), { rowLimit: 1, maxRows: 1 });
    return { ok: true };
  } catch (error) {
    if (error instanceof GscAccessError) {
      return { ok: false, status: error.status, message: error.message };
    }
    return { ok: false, status: 500, message: error instanceof Error ? error.message : String(error) };
  }
}

/** YYYY-MM-DD in UTC, the only date format the Search Console API accepts. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
