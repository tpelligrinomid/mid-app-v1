/**
 * Google Search Console API client
 *
 * Access is via a SINGLE shared MiD service account that clients add as a user
 * on their own property (Settings -> Users and permissions -> Add user, at
 * Restricted). There is no OAuth flow, no consent screen, no per-contract
 * refresh token — which is why nothing here reads a token from the database.
 *
 * Follows the HubSpot / Master Marketer pattern: native fetch, module-level
 * config, exported functions. The service-account JWT is signed with node
 * crypto rather than pulling in googleapis, which would be a very large
 * dependency for two endpoints.
 *
 * Environment variables (either form works):
 *   GSC_SERVICE_ACCOUNT_JSON         — the full service account key JSON
 *   GSC_SERVICE_ACCOUNT_EMAIL        — or the client_email ...
 *   GSC_SERVICE_ACCOUNT_PRIVATE_KEY  — ... plus the private key
 *
 * Spec: docs/spec-search-visibility-tracking.md §4.4
 */

import { createSign } from 'node:crypto';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/webmasters/v3';

/** Read-only: this module never writes to Search Console. */
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Google caps a single searchAnalytics page at 25,000 rows. */
const MAX_ROW_LIMIT = 25000;

// ============================================================================
// Config
// ============================================================================

interface ServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
}

let cachedCredentials: ServiceAccountCredentials | null = null;

function getCredentials(): ServiceAccountCredentials {
  if (cachedCredentials) return cachedCredentials;

  const json = process.env.GSC_SERVICE_ACCOUNT_JSON;

  if (json) {
    let parsed: { client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('GSC_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('GSC_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
    }
    cachedCredentials = {
      clientEmail: parsed.client_email,
      privateKey: normalizePrivateKey(parsed.private_key),
    };
    return cachedCredentials;
  }

  const clientEmail = process.env.GSC_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GSC_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Google Search Console credentials are not configured. Set GSC_SERVICE_ACCOUNT_JSON, ' +
        'or GSC_SERVICE_ACCOUNT_EMAIL and GSC_SERVICE_ACCOUNT_PRIVATE_KEY.'
    );
  }

  cachedCredentials = { clientEmail, privateKey: normalizePrivateKey(privateKey) };
  return cachedCredentials;
}

/**
 * Env vars flatten the PEM's newlines. Restore them, or the sign() call fails
 * with an opaque error that looks nothing like "your key has literal \n in it".
 */
function normalizePrivateKey(key: string): string {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
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

/** The address clients must add to their property. Shown in the settings UI. */
export function getServiceAccountEmail(): string {
  return getCredentials().clientEmail;
}

// ============================================================================
// Auth
// ============================================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Mint a Google access token via the service-account JWT grant.
 * Cached until 60s before expiry — one token serves every contract, since the
 * service account is the same principal on every property.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const { clientEmail, privateKey } = getCredentials();
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    })
  );

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(privateKey));
  const assertion = `${header}.${claims}.${signature}`;

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} — ${detail.substring(0, 300)}`);
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

    // 403 here almost always means the client hasn't added the service account
    // yet, which is an onboarding state rather than a bug. Typed so callers can
    // surface "not yet granted" instead of a stack trace.
    if (response.status === 403 || response.status === 404) {
      throw new GscAccessError(
        `Search Console denied access (${response.status}). The service account may not be added to this property.`,
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
 * Every property the service account has been granted.
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
 * siteUnverifiedUser means the grant exists but isn't usable. Everything else
 * can read Search Analytics — Restricted included, which is all we ask for.
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
