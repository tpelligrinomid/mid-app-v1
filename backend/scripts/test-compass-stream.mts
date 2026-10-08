// Streams a Compass answer through the real relayClaudeStream (the code the
// chat route uses) and prints the SSE chunks the frontend would receive,
// then the text the user would see. Uses the live WEB_TOOLS, WEB_GUIDANCE,
// model and effort from src/services/rag/chat.ts, with stand-in client data.
// Calls the real API (costs a few cents per run).
//
// Run from backend/:  npx tsx scripts/test-compass-stream.mts "<question>"
// Needs ANTHROPIC_API_KEY in the environment or backend/.env.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const { relayClaudeStream } = await import(pathToFileURL(`${repo}/src/services/rag/chat.ts`).href);
const apiKey =
  process.env.ANTHROPIC_API_KEY ??
  readFileSync(`${repo}/.env`, 'utf8').match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
if (!apiKey) throw new Error('No ANTHROPIC_API_KEY');

const src = readFileSync(`${repo}/src/services/rag/chat.ts`, 'utf8');
const webTools = eval(src.match(/const WEB_TOOLS = (\[[\s\S]*?\n\]);/)![1]);
const webGuidance = eval(src.match(/const WEB_GUIDANCE = (`[\s\S]*?`);/)![1]);
const model = src.match(/const ANSWER_MODEL = '([^']+)'/)![1];
const effort = src.match(/const ANSWER_EFFORT = '([^']+)'/)![1];

const system = `You are a knowledgeable content analyst for a marketing agency. You have access to the following content from the client's content library.

## Retrieved Content

[1] Title: "New North - Marketing Research Report"
Source: deliverable
---
Competitors analyzed: Refine Labs (refinelabs.com), Ironpaper (ironpaper.com), NoGood (nogood.io), Elevation B2B (elevationb2b.com).

${webGuidance}`;

const question = process.argv[2] ?? 'Can you check out our biggest competitors and let me know what their H1 on their website looks like? Provide the response in a markdown table.';

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({
    model, max_tokens: 16000, output_config: { effort }, system,
    messages: [{ role: 'user', content: question }], tools: webTools, stream: true,
  }),
});
if (!response.ok) { console.error(response.status, await response.text()); process.exit(1); }

let text = '';
await relayClaudeStream(response, (chunk: any) => {
  if (chunk.type === 'delta') text += chunk.text;
  else console.log('EVENT', JSON.stringify(chunk));
});
console.log('\n===== TEXT THE USER SEES =====\n' + text);
