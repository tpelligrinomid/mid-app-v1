/**
 * MCP v2 smoke test: connects like a real client and exercises a few tools.
 *
 * Usage (token = a Supabase access token for an internal user):
 *   MCP_URL=http://localhost:3001/mcp MCP_TOKEN=eyJ... npx tsx scripts/mcp-smoke.mts [contract_id]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.MCP_URL ?? 'http://localhost:3001/mcp';
const token = process.env.MCP_TOKEN;
if (!token) throw new Error('Set MCP_TOKEN');

function preview(result: unknown, max = 600): string {
  const r = result as { content?: { type: string; text?: string }[]; isError?: boolean };
  const text = r.content?.map((c) => c.text ?? '').join('\n') ?? '';
  return `${r.isError ? 'ERROR ' : ''}${text.slice(0, max)}${text.length > max ? ' â€¦' : ''}`;
}

const client = new Client({ name: 'mid-mcp-smoke', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
);

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

const contracts = await client.callTool({ name: 'list_contracts', arguments: { status: 'active', limit: 3 } });
console.log('\nlist_contracts:', preview(contracts, 400));

const portfolio = await client.callTool({ name: 'list_portfolio_tasks', arguments: { overdue_only: true, limit: 5 } });
console.log('\nlist_portfolio_tasks (overdue):', preview(portfolio, 300));

const contractId =
  process.argv[2] ??
  ((contracts as { structuredContent?: { contracts?: { contract_id: string }[] } }).structuredContent?.contracts?.[0]
    ?.contract_id);
if (contractId) {
  const started = Date.now();
  const ask = await client.callTool(
    { name: 'compass_ask', arguments: { contract_id: contractId, question: 'What did we discuss in the two most recent meetings?' } },
    undefined,
    { timeout: 300_000 }
  );
  console.log(`\ncompass_ask (${Math.round((Date.now() - started) / 1000)}s):`, preview(ask, 900));
}

await client.close();
