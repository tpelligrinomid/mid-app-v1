// Ad-hoc check: ask Compass chat a question for one contract and print the answer.
// Usage: DOTENV_CONFIG_PATH=.env.rehearsal npx tsx --import dotenv/config scripts/rag-dates-check.ts <contract_id> <question...>
import { streamChatResponse } from '../src/services/rag/chat.js';

async function main() {
  const [contractId, ...q] = process.argv.slice(2);
  let answer = '';
  await streamChatResponse({ message: q.join(' '), contract_id: contractId }, (c) => {
    if (c.type === 'delta') answer += c.text;
    if (c.type === 'error') console.error('ERROR', c.message);
  });
  console.log(answer);
}

void main();
