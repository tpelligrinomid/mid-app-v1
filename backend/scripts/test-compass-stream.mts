// Runs a question through Compass's real answer loop (runAnswer: web search,
// web fetch and, with --databox, the client's Databox marketing tools) and
// prints the SSE chunks the frontend would receive, then the text the user
// would see. Uses the live prompt pieces from src/services/rag/chat.ts with
// stand-in client data. Calls the real API (costs a few cents per run).
//
// Run from backend/:
//   npx tsx scripts/test-compass-stream.mts "<question>"
//   npx tsx scripts/test-compass-stream.mts --databox 768359 "<question>"
//   npx tsx scripts/test-compass-stream.mts --seo "<question>"
// Needs ANTHROPIC_API_KEY (environment or backend/.env); --databox also needs
// the Supabase settings in .env and a Databox connection (connect-databox.mts);
// --seo needs MASTER_MARKETER_URL and MASTER_MARKETER_API_KEY.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const load = async (path: string) => {
  const mod = await import(pathToFileURL(`${repo}/${path}`).href);
  return ('default' in mod ? mod.default : mod) as any;
};
const { runAnswer, withExplicitLinks, WEB_GUIDANCE, marketingGuidance } = await load('src/services/rag/chat.ts');
const { DataboxToolRunner } = await load('src/services/databox/tools.ts');
const { SeoToolRunner, seoGuidance } = await load('src/services/seo/tools.ts');
const apiKey =
  process.env.ANTHROPIC_API_KEY ??
  readFileSync(`${repo}/.env`, 'utf8').match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

const system = `You are a knowledgeable content analyst for a marketing agency. You have access to the following content from the client's content library.

## Retrieved Content

[1] Title: "New North - Marketing Research Report"
Source: deliverable
---
Client: New North (newnorth.com), a B2B marketing agency for tech companies.
Competitors analyzed: Refine Labs (refinelabs.com), Ironpaper (ironpaper.com), NoGood (nogood.io), Elevation B2B (elevationb2b.com).

${WEB_GUIDANCE}`;


const args = process.argv.slice(2);
const databoxIdx = args.indexOf('--databox');
const databoxAccount = databoxIdx >= 0 ? args.splice(databoxIdx, 2)[1] : null;
const seoIdx = args.indexOf('--seo');
const useSeo = seoIdx >= 0 && args.splice(seoIdx, 1).length > 0;
const question = args[0] ?? 'Can you check out our biggest competitors and let me know what their H1 on their website looks like? Provide the response in a markdown table.';

let text = '';
await runAnswer(
  {
    apiKey,
    system: [system, databoxAccount && marketingGuidance(), useSeo && seoGuidance()].filter(Boolean).join('\n\n'),
    messages: [{ role: 'user', content: withExplicitLinks(question) }],
    databox: databoxAccount ? new DataboxToolRunner(databoxAccount) : null,
    seo: useSeo ? new SeoToolRunner() : null,
  },
  (chunk: any) => {
    if (chunk.type === 'delta') text += chunk.text;
    else console.log('EVENT', JSON.stringify(chunk));
  }
);
console.log('\n===== TEXT THE USER SEES =====\n' + text);
