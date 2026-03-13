/**
 * Seed a WSB roadmap fixture into compass_deliverables.
 *
 * Usage: node docs/seed-roadmap.mjs
 *
 * Requires EDGE_FUNCTION_SECRET and SUPABASE_URL in .env (or set them inline).
 */

const CONTRACT_ID = 'fabe8d32-ab02-4c3b-a8f6-ff63b75dcba7';
const FIXTURE_URL = 'https://raw.githubusercontent.com/tpelligrinomid/master-marketer/main/docs/fixtures/wsb-roadmap.json';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://cpjfuttlywafjxefczqc.supabase.co';
const EDGE_FUNCTION_SECRET = process.env.EDGE_FUNCTION_SECRET;

if (!SUPABASE_URL || !EDGE_FUNCTION_SECRET) {
  console.error('Missing SUPABASE_URL or EDGE_FUNCTION_SECRET. Set them in .env or environment.');
  process.exit(1);
}

async function main() {
  // 1. Fetch the fixture
  console.log('Fetching WSB roadmap fixture...');
  const res = await fetch(FIXTURE_URL);
  if (!res.ok) throw new Error(`Failed to fetch fixture: ${res.status}`);
  const roadmapJson = await res.json();
  console.log(`Fetched: type=${roadmapJson.type}, title="${roadmapJson.title}"`);

  // 2. Insert into compass_deliverables via edge function proxy
  const proxyUrl = `${SUPABASE_URL}/functions/v1/backend-proxy`;

  const insertPayload = {
    operation: 'insert',
    table: 'compass_deliverables',
    data: {
      contract_id: CONTRACT_ID,
      title: roadmapJson.title || 'WSB Marketing Roadmap',
      deliverable_type: 'roadmap',
      status: 'planned',
      content_raw: '',
      content_structured: roadmapJson,
      metadata: {
        generation: {
          status: 'completed',
          completed_at: new Date().toISOString(),
        },
      },
    },
    select: 'deliverable_id,title',
  };

  console.log('Inserting deliverable...');
  const insertRes = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-backend-key': EDGE_FUNCTION_SECRET,
    },
    body: JSON.stringify(insertPayload),
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    throw new Error(`Insert failed: ${insertRes.status} — ${err}`);
  }

  const result = await insertRes.json();
  console.log('Seeded successfully:', result.data);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
