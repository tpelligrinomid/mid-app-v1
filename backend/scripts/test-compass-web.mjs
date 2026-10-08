// Replays a Compass chat answer call against the real API with the same web
// tools and web guidance as backend/src/services/rag/chat.ts, and prints each
// tool call, tool error and the final text, including the notes the stream
// relay would drop. Calls the real API (costs a few cents per run).
//
// Run from backend/:  node scripts/test-compass-web.mjs "<question>"
// Reads ANTHROPIC_API_KEY from the environment or backend/.env.
import { readFileSync } from 'node:fs';

const repo = process.cwd();
let apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  const env = readFileSync(`${repo}/.env`, 'utf8');
  apiKey = env.match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
}
if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

// Pull the live constants out of chat.ts so the test can't drift from the code.
const src = readFileSync(`${repo}/src/services/rag/chat.ts`, 'utf8');
const webTools = eval(src.match(/const WEB_TOOLS[^=]*= (\[[\s\S]*?\n\]);/)[1]);
const webGuidance = eval(src.match(/const WEB_GUIDANCE = (`[\s\S]*?`);/)[1]);
const model = src.match(/const ANSWER_MODEL = '([^']+)'/)[1];
const effort = src.match(/const ANSWER_EFFORT = '([^']+)'/)[1];

// Stand-in client data, shaped like the RAG context Compass sends.
const system = `You are a knowledgeable content analyst for a marketing agency. You have access to the following content from the client's content library.

## Retrieved Content

[1] Title: "New North - Marketing Research Report"
Source: deliverable
---
Competitors analyzed: Refine Labs (refinelabs.com), Ironpaper (ironpaper.com), NoGood (nogood.io), Elevation B2B (elevationb2b.com).

${webGuidance}`;

const question = process.argv[2] ?? 'Can you check out our biggest competitors and let me know what their H1 on their website looks like? Provide the response in a markdown table.';

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model, max_tokens: 16000, output_config: { effort }, system,
    messages: [{ role: 'user', content: question }], tools: webTools,
  }),
});
const msg = await res.json();
if (!res.ok) { console.error(res.status, JSON.stringify(msg)); process.exit(1); }

for (const b of msg.content) {
  if (b.type === 'server_tool_use') console.log(`TOOL ${b.name}`, JSON.stringify(b.input));
  else if (b.type.endsWith('_tool_result') && b.content?.error_code) console.log(`  ERROR ${b.type}: ${b.content.error_code}`);
  else if (b.type === 'web_fetch_tool_result') console.log(`  fetched ${b.content?.url}`);
  else if (b.type === 'web_search_tool_result') console.log(`  ${Array.isArray(b.content) ? b.content.length : 0} results`);
  else if (b.type === 'text') process.stdout.write(b.text);
}
console.log(`\n\nstop_reason=${msg.stop_reason} usage=${JSON.stringify(msg.usage)}`);
