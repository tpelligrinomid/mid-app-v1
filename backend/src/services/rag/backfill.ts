/**
 * Backfill Embeddings Service
 *
 * Batch-processes existing notes, meetings, and deliverables into compass_knowledge.
 * Idempotent: skips records that already have chunks in compass_knowledge.
 */

import type { SourceType } from '../../types/rag.js';
import { ingestContent } from './ingestion.js';
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
  source_id: string;
}

interface NoteRow {
  note_id: string;
  contract_id: string;
  title: string;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
}

interface MeetingRow {
  meeting_id: string;
  contract_id: string;
  title: string | null;
  transcript: unknown;
  sentiment: { bullets?: string[] } | null;
}

interface DeliverableRow {
  deliverable_id: string;
  contract_id: string;
  title: string;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
  description: string | null;
}

/**
 * Extract text content from a meeting for embedding
 */
function getMeetingContent(meeting: MeetingRow): string {
  const parts: string[] = [];

  if (meeting.title) {
    parts.push(meeting.title);
  }

  // Extract transcript text
  if (meeting.transcript) {
    if (typeof meeting.transcript === 'string') {
      parts.push(meeting.transcript);
    } else if (Array.isArray(meeting.transcript)) {
      // TranscriptSegment[]
      const segments = meeting.transcript as { text: string; speaker?: string }[];
      parts.push(segments.map((s) => s.speaker ? `${s.speaker}: ${s.text}` : s.text).join('\n'));
    } else if (typeof meeting.transcript === 'object') {
      parts.push(JSON.stringify(meeting.transcript));
    }
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

  // Get existing source_ids in compass_knowledge to skip already-processed records
  // Use limit: 50000 to avoid Supabase default pagination (1000 rows)
  let existingSourceIds: Set<string>;
  try {
    const existing = await select<ExistingChunkRow[]>('compass_knowledge', {
      select: 'source_id',
      limit: 50000,
    });
    // Deduplicate since multiple chunks share the same source_id
    existingSourceIds = new Set((existing || []).map((r) => r.source_id));
    console.log(`[Backfill] Found ${existingSourceIds.size} already-embedded source records (from ${(existing || []).length} chunks)`);
  } catch {
    existingSourceIds = new Set();
    console.warn('[Backfill] Could not fetch existing chunks, will process all');
  }

  // Process notes
  if (sourceTypes.includes('note')) {
    try {
      const notes = await select<NoteRow[]>('compass_notes', {
        select: 'note_id, contract_id, title, content_raw, content_structured',
        limit: 10000,
      });

      const allNotes = notes || [];
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
  if (sourceTypes.includes('meeting')) {
    try {
      const meetings = await select<MeetingRow[]>('compass_meetings', {
        select: 'meeting_id, contract_id, title, transcript, sentiment',
        limit: 10000,
      });

      const allMeetings = meetings || [];
      const alreadyEmbedded = allMeetings.filter((m) => existingSourceIds.has(m.meeting_id));
      const noContent = allMeetings.filter((m) => !existingSourceIds.has(m.meeting_id) && !m.transcript && !m.sentiment);
      const toProcess = allMeetings.filter(
        (m) => !existingSourceIds.has(m.meeting_id) && (m.transcript || m.sentiment)
      );

      result.breakdown.meetings = {
        total: allMeetings.length,
        already_embedded: alreadyEmbedded.length,
        no_content: noContent.length,
        to_process: toProcess.length,
      };
      result.skipped_already_embedded += alreadyEmbedded.length;
      result.skipped_no_content += noContent.length;
      console.log(`[Backfill] Meetings: ${allMeetings.length} total, ${alreadyEmbedded.length} already embedded, ${noContent.length} no content, ${toProcess.length} to process`);

      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, i + batchSize);

        for (const meeting of batch) {
          try {
            const content = getMeetingContent(meeting);
            if (!content.trim()) {
              result.skipped_no_content++;
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
            result.errors.push(`Meeting ${meeting.meeting_id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        if (i + batchSize < toProcess.length) {
          await delay(1000);
        }
      }
    } catch (err) {
      result.errors.push(`Meetings query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Process deliverables
  if (sourceTypes.includes('deliverable')) {
    try {
      const deliverables = await select<DeliverableRow[]>('compass_deliverables', {
        select: 'deliverable_id, contract_id, title, content_raw, content_structured, description',
        limit: 10000,
      });

      const allDeliverables = deliverables || [];
      const alreadyEmbedded = allDeliverables.filter((d) => existingSourceIds.has(d.deliverable_id));
      const noContent = allDeliverables.filter((d) => !existingSourceIds.has(d.deliverable_id) && !d.content_raw && !d.content_structured && !d.description);
      const toProcess = allDeliverables.filter(
        (d) => !existingSourceIds.has(d.deliverable_id) && (d.content_raw || d.content_structured || d.description)
      );

      result.breakdown.deliverables = {
        total: allDeliverables.length,
        already_embedded: alreadyEmbedded.length,
        no_content: noContent.length,
        to_process: toProcess.length,
      };
      result.skipped_already_embedded += alreadyEmbedded.length;
      result.skipped_no_content += noContent.length;
      console.log(`[Backfill] Deliverables: ${allDeliverables.length} total, ${alreadyEmbedded.length} already embedded, ${noContent.length} no content, ${toProcess.length} to process`);

      for (let i = 0; i < toProcess.length; i += batchSize) {
        const batch = toProcess.slice(i, i + batchSize);

        for (const deliverable of batch) {
          try {
            const content = getDeliverableContent(deliverable);
            if (!content.trim()) {
              result.skipped_no_content++;
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
            result.errors.push(`Deliverable ${deliverable.deliverable_id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        if (i + batchSize < toProcess.length) {
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
