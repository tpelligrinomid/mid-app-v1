#!/usr/bin/env node
/**
 * Quick check: find deliverables in Supabase.
 * Requires: SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FUNCTION_SECRET
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EDGE_FUNCTION_SECRET = process.env.EDGE_FUNCTION_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !EDGE_FUNCTION_SECRET) {
  console.error('Missing required env vars');
  process.exit(1);
}

const PROXY_URL = `${SUPABASE_URL}/functions/v1/backend-proxy`;

// List all deliverables (no filter, no single)
const response = await fetch(PROXY_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'x-backend-key': EDGE_FUNCTION_SECRET,
  },
  body: JSON.stringify({
    operation: 'select',
    table: 'compass_deliverables',
    select: '*',
    options: { limit: 20, order: [{ column: 'created_at', ascending: false }] },
  }),
});

const result = await response.json();

if (result.error) {
  console.error('Error:', result.error);
  process.exit(1);
}

const rows = result.data;
console.log(`Found ${rows.length} deliverables:\n`);

for (const d of rows) {
  // Print all column names for the first row
  if (d === rows[0]) {
    console.log('Column names:', Object.keys(d).join(', '));
    console.log('');
  }
  const id = d.deliverable_id || d.id;
  console.log(`  ${id} | status=${d.status} | type=${d.deliverable_type} | title="${d.title}" | content_raw=${d.content_raw?.length || 0} chars`);
}
