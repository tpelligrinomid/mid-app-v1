/**
 * Lists the tools exposed by Nightwatch's own MCP server (read-only discovery).
 * Usage: NIGHTWATCH_API_KEY=... npx tsx scripts/nightwatch-mcp-tools.mts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const token = process.env.NIGHTWATCH_API_KEY;
if (!token) throw new Error('Set NIGHTWATCH_API_KEY');
const mask = (s: string) => s.split(token).join('***');
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'MiD-Platform/1.0' };

async function tryConnect(label: string, make: () => SSEClientTransport | StreamableHTTPClientTransport) {
  const client = new Client({ name: 'mid-nightwatch-discovery', version: '1.0.0' });
  try {
    await client.connect(make());
    const { tools } = await client.listTools();
    console.log(`${label}: connected, ${tools.length} tools`);
    for (const t of tools) {
      const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
      const ro = t.annotations?.readOnlyHint === true ? 'read' : t.annotations?.readOnlyHint === false ? 'WRITE' : '?';
      console.log(`- [${ro}] ${t.name}(${props.join(', ')}): ${(t.description ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    await client.close();
    return true;
  } catch (err) {
    console.log(`${label}: failed: ${mask(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
    return false;
  }
}

const ok =
  (await tryConnect('streamable HTTP /mcp', () =>
    new StreamableHTTPClientTransport(new URL('https://mcp.nightwatch.io/mcp'), { requestInit: { headers } }))) ||
  (await tryConnect('SSE /sse', () =>
    new SSEClientTransport(new URL('https://mcp.nightwatch.io/sse'), {
      requestInit: { headers },
      eventSourceInit: { fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) },
    })));
if (!ok) process.exitCode = 1;
