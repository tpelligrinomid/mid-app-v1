/**
 * Direct database migration: contract_meetings → compass_meetings + compass_notes
 *
 * Connects to the new Supabase database via pg and inserts records directly.
 * Maps old contract UUIDs → new contract UUIDs via external_id (MID number).
 *
 * Usage: DATABASE_URL="postgresql://..." node run-migration.mjs
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Multi-line CSV Parser
// ============================================================================

function parseCSV(text, delimiter = ',') {
  const rows = [];
  const headerEnd = findRowEnd(text, 0);
  const headers = splitRow(text.substring(0, headerEnd).replace(/\r$/, ''), delimiter);
  let i = headerEnd + 1;

  while (i < text.length) {
    if (text[i] === '\n' || text[i] === '\r') { i++; continue; }
    const end = findRowEnd(text, i);
    if (end <= i) break;
    const rowText = text.substring(i, end).replace(/\r$/, '');
    const fields = splitRow(rowText, delimiter);
    if (fields.length >= headers.length) {
      const obj = {};
      headers.forEach((h, idx) => obj[h.trim()] = fields[idx] || '');
      rows.push(obj);
    }
    i = end + 1;
  }
  return rows;
}

function findRowEnd(text, start) {
  let i = start;
  let inQuote = false;
  while (i < text.length) {
    if (text[i] === '"') {
      if (inQuote && text[i + 1] === '"') { i += 2; continue; }
      inQuote = !inQuote;
    }
    if (!inQuote && text[i] === '\n') return i;
    i++;
  }
  return i;
}

function splitRow(line, delimiter) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(''); break; }
    if (line[i] === '"') {
      i++;
      let val = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += line[i]; i++; }
      }
      fields.push(val);
      if (line[i] === delimiter) i++;
      else if (line[i] === '\r') i++;
    } else {
      const next = line.indexOf(delimiter, i);
      if (next === -1) { fields.push(line.substring(i).replace(/\r$/, '')); i = line.length + 1; }
      else { fields.push(line.substring(i, next)); i = next + 1; }
    }
  }
  return fields;
}

// ============================================================================
// Contract ID Mapping
// ============================================================================

function buildContractMapping(oldContracts, newContracts) {
  const oldToExternal = {};
  for (const r of oldContracts) {
    if (r.contract_id && r.external_id) oldToExternal[r.contract_id] = r.external_id;
  }

  const externalToNew = {};
  for (const r of newContracts) {
    if (r.external_id && r.contract_id) externalToNew[r.external_id] = r.contract_id;
  }

  const mapping = {};
  let matched = 0, unmatched = 0;
  for (const [oldId, extId] of Object.entries(oldToExternal)) {
    const newId = externalToNew[extId];
    if (newId) { mapping[oldId] = newId; matched++; }
    else { unmatched++; }
  }

  return { mapping, matched, unmatched, oldToExternal };
}

// ============================================================================
// Transform
// ============================================================================

function transformMeeting(row, contractMapping) {
  const newContractId = contractMapping[row.contract_id];
  if (!newContractId) return null;

  let transcript = null;
  let participants = null;
  let sentiment = null;

  try { transcript = JSON.parse(row.transcript); } catch { /* empty */ }
  try { participants = JSON.parse(row.participants); } catch { /* empty */ }
  try { sentiment = JSON.parse(row.sentiment); } catch { /* empty */ }

  const externalId = transcript?.id || null;
  const title = transcript?.title || null;

  let mappedSentiment = null;
  if (sentiment && sentiment.label) {
    mappedSentiment = {
      label: sentiment.label,
      confidence: sentiment.confidence || 0,
      bullets: sentiment.bullets || [],
      highlights: sentiment.highlights || [],
      topics: sentiment.topics || [],
      model: sentiment.model || 'openai/gpt-4-1106-preview',
      version: sentiment.version || 1,
      generated_at: sentiment.generated_at || row.sentiment_generated_at || new Date().toISOString(),
    };
  }

  const rawMetadata = {
    fireflies_summary: transcript?.summary || null,
    migrated_from: 'contract_meetings',
    original_id: row.id,
    master_marketer: { status: 'migrated' },
  };

  return {
    meeting: {
      contract_id: newContractId,
      meeting_date: row.meeting_ts,
      source: row.source || 'fireflies',
      external_id: externalId,
      title,
      participants,
      duration_seconds: row.duration_seconds ? parseInt(row.duration_seconds) : null,
      recording_url: row.recording_url || null,
      transcript,
      sentiment: mappedSentiment,
      raw_metadata: rawMetadata,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    note: transcript?.summary?.notes ? {
      contract_id: newContractId,
      note_type: 'meeting',
      title: `Meeting Notes: ${title || 'Untitled Meeting'}`,
      content_raw: transcript.summary.notes,
      note_date: row.meeting_ts,
      status: 'published',
      action_items: parseActionItems(transcript.summary.action_items),
      is_auto_generated: true,
    } : null,
  };
}

function parseActionItems(actionItemsText) {
  if (!actionItemsText || typeof actionItemsText !== 'string') return null;
  const items = [];
  const lines = actionItemsText.split('\n').filter(l => l.trim());
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) continue;
    if (trimmed.length > 0) items.push({ text: trimmed, completed: false });
  }
  return items.length > 0 ? items : null;
}

// ============================================================================
// Database Operations
// ============================================================================

async function insertMeeting(client, meeting) {
  const result = await client.query(
    `INSERT INTO compass_meetings
      (contract_id, meeting_date, source, external_id, title, participants,
       duration_seconds, recording_url, transcript, sentiment, raw_metadata,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING meeting_id`,
    [
      meeting.contract_id,
      meeting.meeting_date,
      meeting.source,
      meeting.external_id,
      meeting.title,
      meeting.participants ? JSON.stringify(meeting.participants) : null,
      meeting.duration_seconds,
      meeting.recording_url,
      meeting.transcript ? JSON.stringify(meeting.transcript) : null,
      meeting.sentiment ? JSON.stringify(meeting.sentiment) : null,
      meeting.raw_metadata ? JSON.stringify(meeting.raw_metadata) : null,
      meeting.created_at,
      meeting.updated_at,
    ]
  );
  return result.rows[0].meeting_id;
}

async function insertNote(client, note, meetingId) {
  await client.query(
    `INSERT INTO compass_notes
      (contract_id, meeting_id, note_type, title, content_raw, note_date,
       status, action_items, is_auto_generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      note.contract_id,
      meetingId,
      note.note_type,
      note.title,
      note.content_raw,
      note.note_date,
      note.status,
      note.action_items ? JSON.stringify(note.action_items) : null,
      note.is_auto_generated,
    ]
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required.');
    console.error('Usage: DATABASE_URL="postgresql://..." node run-migration.mjs');
    process.exit(1);
  }

  // Parse CSV files
  console.log('Reading CSV files...');
  const meetingRows = parseCSV(readFileSync(join(__dirname, 'contract_meetings_rows.csv'), 'utf8'));
  console.log(`  ${meetingRows.length} meetings`);

  const oldContracts = parseCSV(readFileSync(join(__dirname, 'contracts_rows_2.7.26-old.csv'), 'utf8'));
  console.log(`  ${oldContracts.length} old contracts`);

  const newContracts = parseCSV(readFileSync(join(__dirname, 'contracts-export-2026-02-07_12-04-28-new.csv'), 'utf8'), ';');
  console.log(`  ${newContracts.length} new contracts`);

  // Build mapping
  console.log('Building contract ID mapping...');
  const { mapping, matched, unmatched, oldToExternal } = buildContractMapping(oldContracts, newContracts);
  console.log(`  ${matched} mapped, ${unmatched} unmapped`);

  // Connect to database
  console.log('Connecting to database...');
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('  Connected.');

  // Run migration in a transaction
  let meetingCount = 0;
  let noteCount = 0;
  let skipped = 0;
  let errors = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < meetingRows.length; i++) {
      const row = meetingRows[i];
      const result = transformMeeting(row, mapping);

      if (!result) {
        skipped++;
        const ext = oldToExternal[row.contract_id];
        console.log(`  SKIP: Meeting ${row.id} — no contract match (ext: ${ext || 'none'})`);
        continue;
      }

      try {
        const meetingId = await insertMeeting(client, result.meeting);
        meetingCount++;

        if (result.note) {
          await insertNote(client, result.note, meetingId);
          noteCount++;
        }

        if ((meetingCount) % 25 === 0) {
          console.log(`  Progress: ${meetingCount} meetings, ${noteCount} notes...`);
        }
      } catch (err) {
        errors++;
        console.error(`  ERROR on meeting ${row.id} (${result.meeting.title}): ${err.message}`);
        // Continue with other rows — don't abort the whole migration
      }
    }

    if (errors > 0) {
      console.log(`\n${errors} errors encountered. Rolling back.`);
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      console.log('\nCOMMITTED.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transaction failed, rolled back:', err.message);
  } finally {
    await client.end();
  }

  console.log('\n=== Migration Summary ===');
  console.log(`Meetings inserted: ${meetingCount}`);
  console.log(`Notes created:     ${noteCount}`);
  console.log(`Skipped:           ${skipped}`);
  console.log(`Errors:            ${errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
