// Prints the input schemas of selected Nightwatch MCP tools. Usage: NIGHTWATCH_API_KEY=... npx tsx scripts/nightwatch-mcp-schema.mts tool1 tool2
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const token = process.env.NIGHTWATCH_API_KEY!;
const c = new Client({ name: 'mid-nw-schema', version: '1' });
await c.connect(new StreamableHTTPClientTransport(new URL('https://mcp.nightwatch.io/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'MiD-Platform/1.0' } } }));
const { tools } = await c.listTools();
console.log('tool count:', tools.length);
for (const t of tools.filter((t) => process.argv.slice(2).includes(t.name))) console.log(`\n## ${t.name}\n${t.description}\n${JSON.stringify(t.inputSchema, null, 1)}`);
await c.close();
