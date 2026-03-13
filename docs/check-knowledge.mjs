/**
 * Quick diagnostic: check compass_knowledge rows for a contract
 * Usage: node docs/check-knowledge.mjs
 *
 * Requires: SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FUNCTION_SECRET env vars
 * (load from backend/.env)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load env from backend/.env
const envPath = resolve('backend', '.env');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim();
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EDGE_FUNCTION_SECRET = process.env.EDGE_FUNCTION_SECRET;
const PROXY_ENDPOINT = `${SUPABASE_URL}/functions/v1/backend-proxy`;

async function query(operation, table, options = {}) {
  const res = await fetch(PROXY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-backend-key': EDGE_FUNCTION_SECRET,
    },
    body: JSON.stringify({ operation, table, ...options }),
  });
  const json = await res.json();
  return json.data;
}

// 1. Find the New North contract
console.log('=== Finding New North contract ===');
const contracts = await query('select', 'contracts', {
  select: 'contract_id, external_id, contract_name',
  filters: { contract_name: { ilike: '%New North%' } },
});
console.log('Contracts matching "New North":', JSON.stringify(contracts, null, 2));

if (!contracts || contracts.length === 0) {
  // Try by external_id
  const contracts2 = await query('select', 'contracts', {
    select: 'contract_id, external_id, contract_name',
    filters: { external_id: { ilike: '%MIDNEW%' } },
  });
  console.log('Contracts matching "MIDNEW":', JSON.stringify(contracts2, null, 2));
}

const contractId = contracts?.[0]?.contract_id;
if (!contractId) {
  console.log('No contract found, exiting');
  process.exit(1);
}

// 2. Count knowledge rows by source_type
console.log('\n=== compass_knowledge rows for', contractId, '===');
const rows = await query('select', 'compass_knowledge', {
  select: 'source_type, title, source_id, chunk_index',
  filters: { contract_id: contractId },
  options: { limit: 200 },
});

if (!rows || rows.length === 0) {
  console.log('NO ROWS FOUND in compass_knowledge for this contract!');
  process.exit(1);
}

// Group by source_type
const byType = {};
for (const r of rows) {
  byType[r.source_type] = byType[r.source_type] || [];
  byType[r.source_type].push(r);
}

for (const [type, items] of Object.entries(byType)) {
  const uniqueSources = [...new Set(items.map(i => i.source_id))];
  console.log(`\n  ${type}: ${items.length} chunks from ${uniqueSources.length} sources`);
  // Show first 5 unique titles
  const uniqueTitles = [...new Set(items.map(i => i.title))];
  for (const title of uniqueTitles.slice(0, 5)) {
    console.log(`    - "${title}"`);
  }
  if (uniqueTitles.length > 5) {
    console.log(`    ... and ${uniqueTitles.length - 5} more`);
  }
}

console.log(`\nTotal: ${rows.length} chunks`);
