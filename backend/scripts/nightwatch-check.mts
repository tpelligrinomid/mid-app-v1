/**
 * End-to-end check of the Nightwatch integration against a running backend.
 * Usage: MCP_TOKEN=<supabase access token> API=http://localhost:3001 npx tsx scripts/nightwatch-check.mts <contract_id> [site_id]
 * Connects the site (if given), then calls the four SEO tools through the MCP.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const api = process.env.API ?? 'http://localhost:3001';
const token = process.env.MCP_TOKEN;
const [contractId, siteId] = process.argv.slice(2);
if (!token || !contractId) throw new Error('Set MCP_TOKEN and pass a contract id');
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const sites = await (await fetch(`${api}/api/compass/nightwatch/sites`, { headers: auth })).json();
console.log('sites:', JSON.stringify(sites));

if (siteId) {
  const put = await fetch(`${api}/api/compass/nightwatch/contracts/${contractId}`, {
    method: 'PUT',
    headers: auth,
    body: JSON.stringify({ site_id: siteId }),
  });
  console.log('connect:', put.status, await put.text());
}
console.log('mapping:', await (await fetch(`${api}/api/compass/nightwatch/contracts/${contractId}`, { headers: auth })).text());

const client = new Client({ name: 'nightwatch-check', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const text = (r: unknown) => ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? '').join('\n');

for (const [name, args] of [
  ['get_seo_rankings', { contract_id: contractId, limit: 5 }],
  ['get_seo_movers', { contract_id: contractId, days: 7 }],
  ['get_seo_ranking_history', { contract_id: contractId, keywords: ['b2b marketing agencies'], from: '2026-10-01' }],
  ['get_seo_competitors', { contract_id: contractId }],
] as const) {
  const res = await client.callTool({ name, arguments: args });
  console.log(`\n${name}:`, text(res).slice(0, 900));
}
await client.close();
