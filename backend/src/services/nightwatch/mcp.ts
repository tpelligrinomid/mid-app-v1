/**
 * Nightwatch MCP client (https://mcp.nightwatch.io/mcp, streamable HTTP).
 *
 * The REST API only reads rankings; site setup, keyword and competitor
 * management, SERP detail and idea generation are MCP-only. It takes the same
 * agency key as the REST API (NIGHTWATCH_API_KEY), sent as
 * "x-auth-token: Bearer <key>" — not the Authorization header, which it
 * ignores ("API token is required"). Server-side only; callers always pass a
 * url_id resolved from the contract, never one chosen by the model.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const NIGHTWATCH_MCP_URL = 'https://mcp.nightwatch.io/mcp';

export function nightwatchMcpConfigured(): boolean {
  return !!process.env.NIGHTWATCH_API_KEY;
}

/** Calls one Nightwatch MCP tool and returns its parsed JSON (or text) result. */
export async function callNightwatchMcp<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const key = process.env.NIGHTWATCH_API_KEY;
  if (!key) throw new Error('NIGHTWATCH_API_KEY is not configured');

  const client = new Client({ name: 'mid-platform', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(NIGHTWATCH_MCP_URL), {
    requestInit: { headers: { 'x-auth-token': `Bearer ${key}`, 'User-Agent': 'MiD-Platform/1.0' } },
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    const text = ((result.content as Array<{ type: string; text?: string }>) ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
    if (result.isError) throw new Error(`Nightwatch ${name}: ${text.slice(0, 300)}`);
    if (result.structuredContent) return result.structuredContent as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  } catch (err) {
    // Never let the key reach logs or the model.
    const message = (err instanceof Error ? err.message : String(err)).split(key).join('***');
    throw new Error(message.startsWith('Nightwatch') ? message : `Nightwatch MCP ${name} failed: ${message.slice(0, 300)}`);
  } finally {
    await client.close().catch(() => {});
  }
}
