/**
 * Checks the Nightwatch management tools through the MCP: previews (no change),
 * read tools, and one reversible confirmed change (add then remove a dummy
 * competitor). Usage: MCP_TOKEN=... npx tsx scripts/nightwatch-manage-check.mts <contract_id>
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [contractId] = process.argv.slice(2);
const client = new Client({ name: 'nw-manage-check', version: '1' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? 'http://localhost:3001/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` } },
  })
);
const text = (r: unknown) => ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? '').join('\n');
const call = async (name: string, args: Record<string, unknown>, max = 500) =>
  console.log(`\n${name} ${JSON.stringify(args)}:\n${text(await client.callTool({ name, arguments: { contract_id: contractId, ...args } })).slice(0, max)}`);

await call('add_seo_keywords', { keywords: ['b2b saas marketing agency', 'b2b marketing agencies', 'msp marketing agency'], tags: ['services'] });
await call('tag_seo_keywords', { keywords: ['b2b marketing agencies'], tags: ['core'] });
await call('get_seo_serp', { keyword: 'b2b marketing agencies' }, 700);
await call('suggest_seo_keywords', { limit: 3 });
await call('manage_seo_competitor', { action: 'add', domain: 'example.com' });
await call('manage_seo_competitor', { action: 'add', domain: 'example.com', confirm: true });
await call('get_seo_competitors', {}, 400);
await call('manage_seo_competitor', { action: 'remove', domain: 'example.com', confirm: true });
await call('get_seo_competitors', {}, 400);
await client.close();
