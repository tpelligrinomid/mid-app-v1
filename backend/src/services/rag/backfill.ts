/**
 * Backfill Embeddings Service
 *
 * Batch-processes existing notes, meetings, and deliverables into compass_knowledge.
 * Idempotent: skips records that already have chunks in compass_knowledge.
 *
 * IMPORTANT: Supabase/PostgREST caps any single response at 1000 rows regardless
 * of the requested `limit`, so all bulk reads MUST paginate explicitly. We page
 * with limit+offset and de-duplicate by primary key (which also guards against a
 * proxy that ignores `offset` — we stop as soon as a page adds no new rows).
 */

import type { SourceType } from '../../types/rag.js';
import { ingestContent } from './ingestion.js';
import { extractTranscriptText } from '../../utils/transcript.js';
import { select } from '../../utils/edge-functions.js';

export interface BackfillOptions {
  batch_size?: number;
  source_types?: SourceType[];
}

export interface BackfillResult {
  processed: number;
  skipped_already_embedded: number;
  skipped_no_content: number;
  failed: number;
  errors: string[];
  breakdown: {
    notes: { total: number; already_embedded: number; no_content: number; to_process: number };
    meetings: { total: number; already_embedded: number; no_content: number; to_process: number };
    deliverables: { total: number; already_embedded: number; no_content: number; to_process: number };
  };
}

interface ExistingChunkRow {
  chunk_id: string;
  source_id: string;
}

interface NoteRow {
  note_id: string;
  contract_id: string;
  title: string;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
}

interface MeetingLightRow {
  meeting_id: string;
  contract_id: string;
  title: string | null;
}

interface MeetingRow extends MeetingLightRow {
  transcript: unknown;
  sentiment: { bullets?: string[] } | null;
}

interface DeliverableLightRow {
  deliverable_id: string;
  contract_id: string;
  title: string;
}

interface DeliverableRow extends DeliverableLightRow {
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
  description: string | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 500; // safety cap (≤500k rows) to prevent an unbounded loop

/**
 * Fetch every row from a table, paging past Supabase's 1000-row response cap.
 *
 * De-duplicates by primary key so that if the proxy ignores `offset` (and keeps
 * returning the first page) we detect "no new rows" and stop instead of looping
 * forever. Requires a stable `orderColumn` (the table's PK) for consistent paging.
 */
async function selectAllPaged<T>(
  table: string,
  selectCols: string,
  orderColumn: string,
  keyOf: (row: T) => string
): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const rows =
      (await select<T[]>(table, {
        select: selectCols,
        order: [{ column: orderColumn, ascending: true }],
        limit: PAGE_SIZE,
        offset,
      })) || [];

    let added = 0;
    for (const row of rows) {
      const key = keyOf(row);
      if (!seen.has(key)) {
        seen.add(key);
        all.push(row);
        added++;
      }
    }

    // Stop on a short page (end of table) or when offset stops yielding new rows.
    if (rows.length < PAGE_SIZE || added === 0) break;
    offset += PAGE_SIZE;
  }

  return all;
}

/**
 * Extract text content from a meeting for embedding
 */
function getMeetingContent(meeting: MeetingRow): string {
  const parts: string[] = [];

  if (meeting.title) {
    parts.push(meeting.title);
  }

  const transcriptText = extractTranscriptText(meeting.transcript);
  if (transcriptText) {
    parts.push(transcriptText);
  }

  // Add sentiment bullets if available
  if (meeting.sentiment?.bullets) {
    parts.push(meeting.sentiment.bullets.join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Extract text content from a deliverable for embedding
 */
function getDeliverableContent(deliverable: DeliverableRow): string {
  const parts: string[] = [deliverable.title];

  if (deliverable.description) {
    parts.push(deliverable.description);
  }

  if (deliverable.content_raw) {
    parts.push(deliverable.content_raw);
  } else if (deliverable.content_structured) {
    parts.push(JSON.stringify(deliverable.content_structured));
  }

  return parts.join('\n\n');
}

/**
 * Small delay to respect rate limits between batches
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backfill existing content into compass_knowledge
 */
export async function backfillEmbeddings(
  options?: BackfillOptions
): Promise<BackfillResult> {
  const batchSize = options?.batch_size ?? 10;
  const sourceTypes = options?.source_types ?? ['note', 'meeting', 'deliverable'];

  const result: BackfillResult = {
    processed: 0,
    skipped_already_embedded: 0,
    skipped_no_content: 0,
    failed: 0,
    errors: [],
    breakdown: {
      notes: { total: 0, already_embedded: 0, no_content: 0, to_process: 0 },
      meetings: { total: 0, already_embedded: 0, no_content: 0, to_process: 0 },
      deliverables: { total: 0, already_embedded: 0, no_content: 0, to_process: 0 },
    },
  };

  // Get existing source_ids in compass_knowledge to skip already-processed records.
  // Paginated: the table has far more than 1000 chunks, so a single read would
  // silently truncate and make almost everything look "not embedded".
  let existingSourceIds: Set<string>;
  try {
    const existing = await selectAllPaged<ExistingChunkRow>(
      'compass_knowledge',
      'chunk_id, source_id',
      'chunk_id',
      (r) => r.chunk_id
    );
    // Deduplicate since multiple chunks share the same source_id
    existingSourceIds = new Set(existing.map((r) => r.source_id));
    console.log(`[Backfill] Found ${existingSourceIds.size} already-embedded source records (from ${existing.length} chunks)`);
  } catch (err) {
    existingSourceIds = new Set();
    console.warn('[Backfill] Could not fetch existing chunks, will process all:', err instanceof Error ? err.message : String(err));
  }

  // Process notes
  if (sourceTypes.includes('note')) {
    try {
      const allNotes = await selectAllPaged<NoteRow>(
        'compass_notes',
        'note_id, contract_id, title, content_raw, content_structured',
        'note_id',
        (n) => n.note_id
      );

      const alreadyEmbedded = allNotes.filter((n) => existingSourceIds.has(n.note_id));
      const noContent = allNotes.filter((n) => !existingSourceIds.has(n.note_id) && !n.content_raw && !n.content_structured);
      const toProcess = allNotes.filter(
        (n) => !existingSourceIds.has(n.note_id) && (n.content_raw || n.content_structured)
      );

      result.breakdown.notes = {
        total: allNotes.length,
        already_embedded: alreadyEmbedded.length,
        no_content: noContent.length,
        to_process: toProcess.length,
      };
      result.skipped_already_embedded += alreadyEmbedded.length;
      result.skipped_no_content += noContent.length;
      console.log(`[Backfill] Notes: ${allNotes.length} total, ${alreadyEmbedded.length} already embedded, ${noContent.length} no content, ${toProcess.length} to process`);

      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, i + batchSize);

        for (const note of batch) {
          try {
            const content = note.content_raw || JSON.stringify(note.content_structured);
            await ingestContent({
              contract_id: note.contract_id,
              source_type: 'note',
              source_id: note.note_id,
              title: note.title,
              content,
            });
            result.processed++;
          } catch (err) {
            result.failed++;
            result.errors.push(`Note ${note.note_id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Rate limit delay between batches
        if (i + batchSize < toProcess.length) {
          await delay(1000);
        }
      }
    } catch (err) {
      result.errors.push(`Notes query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Process meetings
  // Light scan (no transcript) avoids the WORKER_RESOURCE_LIMIT that a bulk
  // select of all transcripts triggers; full rows are fetched one at a time
  // only for meetings that still need embedding.
  if (sourceTypes.includes('meeting')) {
    try {
      const allMeetings = await selectAllPaged<MeetingLightRow>(
        'compass_meetings',
        'meeting_id, contract_id, title',
        'meeting_id',
        (m) => m.meeting_id
      );

      const candidates = allMeetings.filter((m) => !existingSourceIds.has(m.meeting_id));
      const alreadyEmbedded = allMeetings.length - candidates.length;

      result.breakdown.meetings.total = allMeetings.length;
      result.breakdown.meetings.already_embedded = alreadyEmbedded;
      result.breakdown.meetings.to_process = candidates.length;
      result.skipped_already_embedded += alreadyEmbedded;
      console.log(`[Backfill] Meetings: ${allMeetings.length} total, ${alreadyEmbedded} already embedded, ${candidates.length} to process`);

      let processedSinceDelay = 0;
      for (const lite of candidates) {
        try {
          const fullRows = await select<MeetingRow[]>('compass_meetings', {
            select: 'meeting_id, contract_id, title, transcript, sentiment',
            filters: { meeting_id: lite.meeting_id },
            limit: 1,
          });
          const meeting = (fullRows || [])[0];

          const content = meeting ? getMeetingContent(meeting) : '';
          if (!content.trim()) {
            result.skipped_no_content++;
            result.breakdown.meetings.no_content++;
            continue;
          }

          await ingestContent({
            contract_id: meeting.contract_id,
            source_type: 'meeting',
            source_id: meeting.meeting_id,
            title: meeting.title || 'Meeting',
            content,
          });
          result.processed++;
        } catch (err) {
          result.failed++;
          result.errors.push(`Meeting ${lite.meeting_id}: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (++processedSinceDelay >= batchSize) {
          processedSinceDelay = 0;
          await delay(1000);
        }
      }
    } catch (err) {
      result.errors.push(`Meetings query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Process deliverables (same light-scan-then-fetch-per-item strategy as meetings)
  if (sourceTypes.includes('deliverable')) {
    try {
      const allDeliverables = await selectAllPaged<DeliverableLightRow>(
        'compass_deliverables',
        'deliverable_id, contract_id, title',
        'deliverable_id',
        (d) => d.deliverable_id
      );

      const candidates = allDeliverables.filter((d) => !existingSourceIds.has(d.deliverable_id));
      const alreadyEmbedded = allDeliverables.length - candidates.length;

      result.breakdown.deliverables.total = allDeliverables.length;
      result.breakdown.deliverables.already_embedded = alreadyEmbedded;
      result.breakdown.deliverables.to_process = candidates.length;
      result.skipped_already_embedded += alreadyEmbedded;
      console.log(`[Backfill] Deliverables: ${allDeliverables.length} total, ${alreadyEmbedded} already embedded, ${candidates.length} to process`);

      let processedSinceDelay = 0;
      for (const lite of candidates) {
        try {
          const fullRows = await select<DeliverableRow[]>('compass_deliverables', {
            select: 'deliverable_id, contract_id, title, content_raw, content_structured, description',
            filters: { deliverable_id: lite.deliverable_id },
            limit: 1,
          });
          const deliverable = (fullRows || [])[0];

          const content = deliverable ? getDeliverableContent(deliverable) : '';
          if (!content.trim()) {
            result.skipped_no_content++;
            result.breakdown.deliverables.no_content++;
            continue;
          }

          await ingestContent({
            contract_id: deliverable.contract_id,
            source_type: 'deliverable',
            source_id: deliverable.deliverable_id,
            title: deliverable.title,
            content,
          });
          result.processed++;
        } catch (err) {
          result.failed++;
          result.errors.push(`Deliverable ${lite.deliverable_id}: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (++processedSinceDelay >= batchSize) {
          processedSinceDelay = 0;
          await delay(1000);
        }
      }
    } catch (err) {
      result.errors.push(`Deliverables query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[Backfill] Complete: ${result.processed} processed, ${result.skipped_already_embedded} already embedded, ${result.skipped_no_content} no content, ${result.failed} failed`);

  return result;
}
