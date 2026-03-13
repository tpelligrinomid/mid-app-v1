#!/usr/bin/env node
/**
 * One-off script to push the completed MM research report into a deliverable.
 *
 * Usage:
 *   node docs/push-research-output.mjs
 *
 * Required env vars (set them before running):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   EDGE_FUNCTION_SECRET
 *
 * Or pass inline:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=xxx EDGE_FUNCTION_SECRET=xxx node docs/push-research-output.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const DELIVERABLE_ID = 'c41a92c2-acef-4c77-9b24-8bbf74b8a8c7';
const JOB_ID = 'bd007433-237d-4074-acfd-1d0567c82cf9';
const OUTPUT_FILE = resolve(__dirname, 'outputs/run-output-clean.json.json');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EDGE_FUNCTION_SECRET = process.env.EDGE_FUNCTION_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !EDGE_FUNCTION_SECRET) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_ANON_KEY, EDGE_FUNCTION_SECRET');
  process.exit(1);
}

// --- Read MM output ---
console.log(`Reading output from ${OUTPUT_FILE}...`);
const output = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));

console.log(`Title: ${output.title}`);
console.log(`Sections: ${output.sections?.length}`);
console.log(`Markdown length: ${output.full_document_markdown?.length} chars`);

// --- Build the update payload ---
const content_raw = output.full_document_markdown || null;
const content_structured = {
  type: output.type,
  title: output.title,
  summary: output.summary,
  sections: output.sections,
  competitive_scores: output.competitive_scores,
  metadata: output.metadata,
};

const updatePayload = {
  operation: 'update',
  table: 'compass_deliverables',
  data: {
    status: 'planned',
    content_raw,
    content_structured,
    metadata: {
      generation: {
        status: 'completed',
        job_id: JOB_ID,
        submitted_at: '2026-02-10T19:30:00.000Z',
        completed_at: output.metadata?.generated_at || new Date().toISOString(),
        context_summary: {
          meetings_count: 0,
          notes_count: 0,
          processes_count: 0,
        },
      },
    },
  },
  filters: {
    deliverable_id: DELIVERABLE_ID,
  },
};

// --- Call the edge function proxy ---
const PROXY_URL = `${SUPABASE_URL}/functions/v1/backend-proxy`;

console.log(`\nUpdating deliverable ${DELIVERABLE_ID} via ${PROXY_URL}...`);
console.log(`Payload size: ${JSON.stringify(updatePayload).length} bytes`);

const response = await fetch(PROXY_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'x-backend-key': EDGE_FUNCTION_SECRET,
  },
  body: JSON.stringify(updatePayload),
});

const responseText = await response.text();

if (!response.ok) {
  console.error(`\nFailed! Status: ${response.status}`);
  console.error(responseText.substring(0, 500));
  process.exit(1);
}

console.log(`\nSuccess! Status: ${response.status}`);
try {
  const result = JSON.parse(responseText);
  console.log('Response:', JSON.stringify(result, null, 2).substring(0, 500));
} catch {
  console.log('Response:', responseText.substring(0, 500));
}

console.log(`\nDeliverable ${DELIVERABLE_ID} updated with research report.`);
