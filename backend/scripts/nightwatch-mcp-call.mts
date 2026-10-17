// Calls one Nightwatch MCP tool and prints the raw result. Usage: npx tsx scripts/nightwatch-mcp-call.mts <tool> '<json args>'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const token = process.env.NIGHTWATCH_API_KEY!;
const c = new Client({ name: 'mid-nw-call', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL('https://mcp.nightwatch.io/mcp'), { requestInit: { headers: { 'x-auth-token': `Bearer ${token}`, 'User-Agent': 'MiD-Platform/1.0' } } }));
const r = await c.callTool({ name: process.argv[2], arguments: JSON.parse(process.argv[3] ?? '{}') });
console.log(JSON.stringify(r).split(token).join('***').slice(0, Number(process.env.MAX ?? 1500)));
await c.close();
