/**
 * Migration script: contract_meetings → compass_meetings + compass_notes
 *
 * Reads:
 *   - contract_meetings_rows.csv (old meeting data)
 *   - contracts_rows_2.7.26-old.csv (old contracts with external_id)
 *   - contracts-export-2026-02-07_12-04-28-new.csv (new contracts with contract_id)
 *
 * Maps old contract UUIDs → external_id (MID number) → new contract UUID
 * Generates SQL INSERT statements for the new Supabase SQL Editor.
 *
 * Usage: node migrate.mjs
 * Output: migration.sql
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Multi-line CSV Parser (handles quoted fields with commas, newlines, escaped quotes)
// ============================================================================

function parseCSV(text, delimiter = ',') {
  const rows = [];

  // Find end of header line
  const headerEnd = findRowEnd(text, 0);
  const headers = splitRow(text.substring(0, headerEnd).replace(/\r$/, ''), delimiter);
  let i = headerEnd + 1;

  while (i < text.length) {
    // Skip blank lines
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
      i++; // skip opening quote
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
// SQL Escaping
// ============================================================================

function sqlStr(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function sqlJson(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  try {
    const obj = typeof val === 'string' ? JSON.parse(val) : val;
    const json = JSON.stringify(obj);
    return `'${json.replace(/'/g, "''")}'::jsonb`;
  } catch {
    return 'NULL';
  }
}

function sqlTextArray(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  try {
    const arr = typeof val === 'string' ? JSON.parse(val) : val;
    if (!Array.isArray(arr) || arr.length === 0) return 'NULL';
    const elements = arr.map(s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    return `'{${elements.join(',')}}'::text[]`;
  } catch {
    return 'NULL';
  }
}

// ============================================================================
// Contract ID Mapping
// ============================================================================

function buildContractMapping(oldContracts, newContracts) {
  // old UUID → external_id (MID number)
  const oldToExternal = {};
  for (const r of oldContracts) {
    if (r.contract_id && r.external_id) {
      oldToExternal[r.contract_id] = r.external_id;
    }
  }

  // external_id (MID number) → new UUID
  const externalToNew = {};
  for (const r of newContracts) {
    if (r.external_id && r.contract_id) {
      externalToNew[r.external_id] = r.contract_id;
    }
  }

  // old UUID → new UUID (via external_id)
  const mapping = {};
  let matched = 0, unmatched = 0;
  for (const [oldId, extId] of Object.entries(oldToExternal)) {
    const newId = externalToNew[extId];
    if (newId) {
      mapping[oldId] = newId;
      matched++;
    } else {
      unmatched++;
    }
  }

  return { mapping, matched, unmatched, oldToExternal };
}

// ============================================================================
// Transform
// ============================================================================

function transformMeeting(row, contractMapping) {
  // Map old contract_id to new contract_id
  const newContractId = contractMapping[row.contract_id];
  if (!newContractId) return null;

  // Parse nested JSON fields
  let transcript = null;
  let participants = null;
  let sentiment = null;

  try { transcript = JSON.parse(row.transcript); } catch { /* empty */ }
  try { participants = JSON.parse(row.participants); } catch { /* empty */ }
  try { sentiment = JSON.parse(row.sentiment); } catch { /* empty */ }

  const externalId = transcript?.id || null;
  const title = transcript?.title || null;

  // Map old sentiment to MeetingSentiment schema
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
      title: title,
      participants: participants,
      duration_seconds: row.duration_seconds ? parseInt(row.duration_seconds) : null,
      recording_url: row.recording_url || null,
      transcript: transcript,
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
    if (trimmed.length > 0) {
      items.push({ text: trimmed, completed: false });
    }
  }
  return items.length > 0 ? items : null;
}

// ============================================================================
// Generate SQL
// ============================================================================

function generateMeetingSQL(meeting, note) {
  const lines = [];

  if (note) {
    lines.push(`-- Meeting: ${meeting.title || 'Untitled'} (${meeting.meeting_date})`);
    lines.push(`WITH new_meeting AS (`);
    lines.push(`  INSERT INTO compass_meetings (contract_id, meeting_date, source, external_id, title, participants, duration_seconds, recording_url, transcript, sentiment, raw_metadata, created_at, updated_at)`);
    lines.push(`  VALUES (`);
    lines.push(`    ${sqlStr(meeting.contract_id)},`);
    lines.push(`    ${sqlStr(meeting.meeting_date)},`);
    lines.push(`    ${sqlStr(meeting.source)},`);
    lines.push(`    ${sqlStr(meeting.external_id)},`);
    lines.push(`    ${sqlStr(meeting.title)},`);
    lines.push(`    ${sqlTextArray(meeting.participants)},`);
    lines.push(`    ${meeting.duration_seconds || 'NULL'},`);
    lines.push(`    ${sqlStr(meeting.recording_url)},`);
    lines.push(`    ${sqlJson(meeting.transcript)},`);
    lines.push(`    ${sqlJson(meeting.sentiment)},`);
    lines.push(`    ${sqlJson(meeting.raw_metadata)},`);
    lines.push(`    ${sqlStr(meeting.created_at)},`);
    lines.push(`    ${sqlStr(meeting.updated_at)}`);
    lines.push(`  )`);
    lines.push(`  RETURNING meeting_id, contract_id`);
    lines.push(`)`);
    lines.push(`INSERT INTO compass_notes (contract_id, meeting_id, note_type, title, content_raw, note_date, status, action_items, is_auto_generated)`);
    lines.push(`SELECT`);
    lines.push(`  new_meeting.contract_id,`);
    lines.push(`  new_meeting.meeting_id,`);
    lines.push(`  ${sqlStr(note.note_type)},`);
    lines.push(`  ${sqlStr(note.title)},`);
    lines.push(`  ${sqlStr(note.content_raw)},`);
    lines.push(`  ${sqlStr(note.note_date)},`);
    lines.push(`  ${sqlStr(note.status)},`);
    lines.push(`  ${sqlJson(note.action_items)},`);
    lines.push(`  true`);
    lines.push(`FROM new_meeting;`);
  } else {
    lines.push(`-- Meeting: ${meeting.title || 'Untitled'} (${meeting.meeting_date}) [no summary]`);
    lines.push(`INSERT INTO compass_meetings (contract_id, meeting_date, source, external_id, title, participants, duration_seconds, recording_url, transcript, sentiment, raw_metadata, created_at, updated_at)`);
    lines.push(`VALUES (`);
    lines.push(`  ${sqlStr(meeting.contract_id)},`);
    lines.push(`  ${sqlStr(meeting.meeting_date)},`);
    lines.push(`  ${sqlStr(meeting.source)},`);
    lines.push(`  ${sqlStr(meeting.external_id)},`);
    lines.push(`  ${sqlStr(meeting.title)},`);
    lines.push(`  ${sqlTextArray(meeting.participants)},`);
    lines.push(`  ${meeting.duration_seconds || 'NULL'},`);
    lines.push(`  ${sqlStr(meeting.recording_url)},`);
    lines.push(`  ${sqlJson(meeting.transcript)},`);
    lines.push(`  ${sqlJson(meeting.sentiment)},`);
    lines.push(`  ${sqlJson(meeting.raw_metadata)},`);
    lines.push(`  ${sqlStr(meeting.created_at)},`);
    lines.push(`  ${sqlStr(meeting.updated_at)}`);
    lines.push(`);`);
  }
  lines.push('');

  return lines.join('\n');
}

// ============================================================================
// Main
// ============================================================================

const CHUNK_COUNT = 20;

const meetingsPath = join(__dirname, 'contract_meetings_rows.csv');
const oldContractsPath = join(__dirname, 'contracts_rows_2.7.26-old.csv');
const newContractsPath = join(__dirname, 'contracts-export-2026-02-07_12-04-28-new.csv');
const outputDir = join(__dirname, 'chunks');

// Ensure output directory exists
mkdirSync(outputDir, { recursive: true });

// Parse all CSVs
console.error('Reading meetings CSV...');
const meetingRows = parseCSV(readFileSync(meetingsPath, 'utf8'));
console.error(`  ${meetingRows.length} meetings`);

console.error('Reading old contracts CSV...');
const oldContracts = parseCSV(readFileSync(oldContractsPath, 'utf8'));
console.error(`  ${oldContracts.length} old contracts`);

console.error('Reading new contracts CSV...');
const newContracts = parseCSV(readFileSync(newContractsPath, 'utf8'), ';');
console.error(`  ${newContracts.length} new contracts`);

// Build mapping
console.error('Building contract ID mapping...');
const { mapping, matched, unmatched, oldToExternal } = buildContractMapping(oldContracts, newContracts);
console.error(`  ${matched} mapped, ${unmatched} unmapped`);

// Check coverage of meetings
let meetingsMapped = 0, meetingsUnmapped = 0;
for (const m of meetingRows) {
  if (mapping[m.contract_id]) meetingsMapped++;
  else {
    meetingsUnmapped++;
    const ext = oldToExternal[m.contract_id];
    console.error(`  WARNING: Meeting ${m.id} has old contract ${m.contract_id} (ext: ${ext || 'none'}) with no match in new DB`);
  }
}
console.error(`Meetings coverage: ${meetingsMapped} mapped, ${meetingsUnmapped} unmapped`);

// Transform all meetings first
console.error('Transforming meetings...');
const transformed = [];
let skipped = 0;
for (const row of meetingRows) {
  const result = transformMeeting(row, mapping);
  if (!result) { skipped++; continue; }
  transformed.push(result);
}
console.error(`  ${transformed.length} to insert, ${skipped} skipped`);

// Split into chunks and write files
const chunkSize = Math.ceil(transformed.length / CHUNK_COUNT);
let totalMeetings = 0;
let totalNotes = 0;

for (let c = 0; c < CHUNK_COUNT; c++) {
  const start = c * chunkSize;
  const end = Math.min(start + chunkSize, transformed.length);
  if (start >= transformed.length) break;

  const chunk = transformed.slice(start, end);
  const fileNum = String(c + 1).padStart(2, '0');
  const lines = [];

  lines.push('-- ==========================================================================');
  lines.push(`-- Migration chunk ${c + 1}/${CHUNK_COUNT}: meetings ${start + 1}–${end} of ${transformed.length}`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('-- ==========================================================================');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  let chunkMeetings = 0;
  let chunkNotes = 0;

  for (const { meeting, note } of chunk) {
    lines.push(generateMeetingSQL(meeting, note));
    chunkMeetings++;
    if (note) chunkNotes++;
  }

  lines.push('COMMIT;');
  lines.push('');
  lines.push(`-- Chunk summary: ${chunkMeetings} meetings, ${chunkNotes} notes`);

  const filePath = join(outputDir, `migration_${fileNum}.sql`);
  writeFileSync(filePath, lines.join('\n'), 'utf8');
  console.error(`  Wrote ${filePath} (${chunkMeetings} meetings, ${chunkNotes} notes)`);

  totalMeetings += chunkMeetings;
  totalNotes += chunkNotes;
}

console.error(`\nDone! ${CHUNK_COUNT} files in ${outputDir}`);
console.error(`Total: ${totalMeetings} meetings, ${totalNotes} notes, ${skipped} skipped`);
console.error('Run each file in order in the Supabase SQL Editor.');
