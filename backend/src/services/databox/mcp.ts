/**
 * Databox MCP client
 *
 * Databox only exposes metric values (GA4, Google Ads, LinkedIn Ads, ...)
 * through its MCP server, and that server takes OAuth, not API keys. A
 * refresh token from scripts/connect-databox.mts lives in pulse_sync_tokens
 * (service "databox_mcp", identifier "compass"); this module keeps the access token fresh,
 * persisting each rotated refresh token, and calls MCP tools over the
 * streamable HTTP transport.
 */

import { select, upsert } from '../../utils/edge-functions.js';

export const DATABOX_MCP_URL = 'https://mcp.databox.com/mcp';
export const DATABOX_AUTH_SERVER = 'https://auth-api.databox.com';
export const DATABOX_SCOPES = 'api:read offline_access';

const TOKEN_SERVICE = 'databox_mcp';
// One Databox login serves every contract; accounts are chosen per call.
const TOKEN_IDENTIFIER = 'compass';
const PROTOCOL_VERSION = '2025-06-18';

export interface DataboxTokens {
  client_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

export async function saveDataboxTokens(tokens: DataboxTokens): Promise<void> {
  await upsert(
    'pulse_sync_tokens',
    {
      service: TOKEN_SERVICE,
      identifier: TOKEN_IDENTIFIER,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: 'oauth',
      expires_at: new Date(tokens.expires_at).toISOString(),
      is_active: true,
      metadata: { client_id: tokens.client_id },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'service,identifier' }
  );
}

interface TokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  metadata: { client_id?: string } | null;
}

async function loadDataboxTokens(): Promise<DataboxTokens | null> {
  try {
    const row = await select<TokenRow>('pulse_sync_tokens', {
      select: 'access_token, refresh_token, expires_at, metadata',
      filters: { service: TOKEN_SERVICE, identifier: TOKEN_IDENTIFIER },
      single: true,
    });
    if (!row?.refresh_token || !row.metadata?.client_id) return null;
    return {
      client_id: row.metadata.client_id,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: row.expires_at ? Date.parse(row.expires_at) : 0,
    };
  } catch {
    return null;
  }
}

let cachedTokens: DataboxTokens | null = null;
let refreshing: Promise<DataboxTokens> | null = null;

async function refreshTokens(current: DataboxTokens): Promise<DataboxTokens> {
  const response = await fetch(`${DATABOX_AUTH_SERVER}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
      client_id: current.client_id,
      resource: DATABOX_MCP_URL,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Databox token refresh failed (${response.status}). Reconnect with scripts/connect-databox.mts. ${(await response.text()).slice(0, 200)}`
    );
  }
  const body = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  const next: DataboxTokens = {
    client_id: current.client_id,
    access_token: body.access_token,
    // Refresh tokens may rotate; keep the old one only if no new one came back.
    refresh_token: body.refresh_token ?? current.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
  };
  await saveDataboxTokens(next);
  return next;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!cachedTokens) cachedTokens = await loadDataboxTokens();
  if (!cachedTokens) throw new Error('Databox is not connected. Run scripts/connect-databox.mts.');

  if (forceRefresh || cachedTokens.expires_at - Date.now() < 60_000) {
    // One refresh at a time: a rotated refresh token is single-use.
    refreshing ??= refreshTokens(cachedTokens).finally(() => {
      refreshing = null;
    });
    cachedTokens = await refreshing;
  }
  return cachedTokens.access_token;
}

/** Read a JSON-RPC response that may come back as JSON or as an SSE stream. */
async function readRpcResponse(response: Response, id: number): Promise<{ result?: unknown; error?: { message: string } }> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!contentType.includes('text/event-stream')) return JSON.parse(text);

  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const message = JSON.parse(line.slice(5).trim());
    if (message.id === id) return message;
  }
  throw new Error('Databox MCP returned no response for the request');
}

let sessionId: string | null = null;
let nextRpcId = 1;

async function rpc(method: string, params: unknown, token: string): Promise<Response> {
  return fetch(DATABOX_MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
      ...(sessionId && { 'mcp-session-id': sessionId }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextRpcId++, method, params }),
  });
}

async function openSession(token: string): Promise<void> {
  sessionId = null;
  const id = nextRpcId;
  const response = await rpc(
    'initialize',
    { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'mid-compass', version: '1.0.0' } },
    token
  );
  if (!response.ok) throw new Error(`Databox MCP initialize failed (${response.status})`);
  await readRpcResponse(response, id);
  sessionId = response.headers.get('mcp-session-id');

  await fetch(DATABOX_MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-protocol-version': PROTOCOL_VERSION,
      ...(sessionId && { 'mcp-session-id': sessionId }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
}

/**
 * Call a Databox MCP tool and return its parsed JSON result. Retries once
 * with a fresh token and session on 401/404 (expired token or session).
 */
export async function callDataboxTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken(attempt > 0);
    if (!sessionId || attempt > 0) await openSession(token);

    const id = nextRpcId;
    const response = await rpc('tools/call', { name, arguments: args }, token);
    if ((response.status === 401 || response.status === 404) && attempt === 0) continue;
    if (!response.ok) throw new Error(`Databox MCP ${name} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);

    const message = await readRpcResponse(response, id);
    if (message.error) throw new Error(`Databox MCP ${name} error: ${message.error.message}`);

    const result = message.result as {
      isError?: boolean;
      structuredContent?: T;
      content?: Array<{ type: string; text?: string }>;
    };
    const text = result.content?.find((c) => c.type === 'text')?.text;
    if (result.isError) throw new Error(`Databox ${name}: ${text ?? 'tool error'}`);
    if (result.structuredContent) return result.structuredContent;
    if (text === undefined) throw new Error(`Databox ${name} returned no content`);
    return JSON.parse(text) as T;
  }
  throw new Error(`Databox MCP ${name} failed after reconnecting`);
}
