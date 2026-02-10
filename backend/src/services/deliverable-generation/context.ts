/**
 * Context Assembly for Deliverable Generation
 *
 * Assembles relevant context from a contract's knowledge base
 * (meetings, notes, process library) for AI generation.
 *
 * Meeting weighting: primary meetings (user-selected) get their full
 * transcript included. All other meetings only get summary and key topics.
 */

import { select } from '../../utils/edge-functions.js';
import type { DeliverableContext } from './types.js';

// ============================================================================
// Raw DB row shapes (only the columns we select)
// ============================================================================

interface MeetingRow {
  meeting_id: string;
  title: string | null;
  meeting_date: string;
  transcript: unknown;
  participants: string[] | null;
  sentiment: {
    bullets?: string[];
    topics?: string[];
  } | null;
}

interface NoteRow {
  title: string;
  content_raw: string | null;
  note_date: string | null;
}

interface ProcessRow {
  name: string;
  phase: string;
  points: number | null;
  description: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract plain text from a transcript (may be string, segment array, or JSON) */
function transcriptToText(transcript: unknown): string {
  if (typeof transcript === 'string') return transcript;

  if (Array.isArray(transcript)) {
    return transcript
      .map((s: { speaker?: string; text?: string }) =>
        s.speaker ? `${s.speaker}: ${s.text ?? ''}` : (s.text ?? '')
      )
      .join('\n');
  }

  return JSON.stringify(transcript);
}

// ============================================================================
// Main
// ============================================================================

/**
 * Assemble context from the contract's data for AI generation.
 *
 * @param contractId  - The contract to pull context from
 * @param deliverableTitle - Title of the deliverable being generated
 * @param primaryMeetingIds - Meeting IDs to weight heavily (full transcript)
 */
export async function assembleContext(
  contractId: string,
  deliverableTitle: string,
  primaryMeetingIds?: string[]
): Promise<DeliverableContext> {
  const primarySet = new Set(primaryMeetingIds ?? []);

  // Fetch all in parallel
  const [meetings, notes, processes] = await Promise.all([
    // 1. Last 30 meetings for this contract
    select<MeetingRow[]>('compass_meetings', {
      select: 'meeting_id, title, meeting_date, transcript, participants, sentiment',
      filters: { contract_id: contractId },
      order: [{ column: 'meeting_date', ascending: false }],
      limit: 30,
    }),

    // 2. Published notes for this contract (last 20)
    select<NoteRow[]>('compass_notes', {
      select: 'title, content_raw, note_date',
      filters: { contract_id: contractId, status: 'published' },
      order: [{ column: 'note_date', ascending: false }],
      limit: 20,
    }),

    // 3. Active process library items (global)
    select<ProcessRow[]>('compass_process_library', {
      select: 'name, phase, points, description',
      filters: { is_active: true },
      order: [{ column: 'phase_order', ascending: true }],
    }),
  ]);

  // Split meetings into primary (full transcript) and other (summary only)
  const primary_meetings: DeliverableContext['primary_meetings'] = [];
  const other_meetings: DeliverableContext['other_meetings'] = [];

  for (const m of meetings) {
    if (primarySet.has(m.meeting_id)) {
      primary_meetings.push({
        title: m.title || 'Untitled Meeting',
        date: m.meeting_date,
        transcript: m.transcript ? transcriptToText(m.transcript) : '',
        participants: m.participants || [],
      });
    } else {
      other_meetings.push({
        title: m.title || 'Untitled Meeting',
        date: m.meeting_date,
        summary: m.sentiment?.bullets?.join('. '),
        key_topics: m.sentiment?.topics,
      });
    }
  }

  // Map notes
  const contextNotes: DeliverableContext['notes'] = notes
    .filter((n) => n.content_raw)
    .map((n) => ({
      title: n.title,
      content: n.content_raw!,
      date: n.note_date || '',
    }));

  // Map processes
  const contextProcesses: DeliverableContext['processes'] = processes.map((p) => ({
    name: p.name,
    phase: p.phase,
    points: p.points,
    description: p.description,
  }));

  return {
    primary_meetings,
    other_meetings,
    notes: contextNotes,
    processes: contextProcesses,
  };
}
