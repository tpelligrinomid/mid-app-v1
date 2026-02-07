import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import {
  CreateMeetingDTO,
  UpdateMeetingDTO,
  MeetingSource,
  TranscriptSegment,
  validateMeetingData,
  isValidMeetingSource,
  MEETING_SOURCE_VALUES,
  extractFirefliesId,
} from '../../types/meetings.js';
import { fetchTranscript } from '../../services/fireflies/client.js';
import {
  submitMeetingNotes,
  pollUntilComplete,
} from '../../services/master-marketer/client.js';
import type {
  MeetingNotesSubmission,
  ProcessingState,
  JobOutput,
} from '../../services/master-marketer/types.js';
import { update as edgeFnUpdate, insert as edgeFnInsert } from '../../utils/edge-functions.js';

const router = Router();

// ============================================================================
// Background Processing Helpers (module-internal)
// ============================================================================

/**
 * Update the processing state in raw_metadata via the edge-functions proxy.
 * Uses service-role so it works even after the user JWT expires.
 */
async function updateProcessingState(
  meetingId: string,
  state: ProcessingState['master_marketer']
): Promise<void> {
  try {
    await edgeFnUpdate(
      'compass_meetings',
      { raw_metadata: { master_marketer: state } },
      { meeting_id: meetingId }
    );
  } catch (err) {
    console.error(`Failed to update processing state for meeting ${meetingId}:`, err);
  }
}

/**
 * Write the AI analysis results back to the database:
 * 1. Update compass_meetings.sentiment with the AI sentiment
 * 2. Insert a compass_note with note_type='meeting', is_auto_generated=true
 */
async function writeProcessingResults(
  meetingId: string,
  contractId: string,
  title: string,
  date: string,
  output: JobOutput
): Promise<void> {
  // 1. Update meeting sentiment
  await edgeFnUpdate(
    'compass_meetings',
    {
      sentiment: {
        label: output.sentiment.label,
        confidence: output.sentiment.confidence,
        bullets: output.key_topics,
        highlights: [],
        topics: output.key_topics,
        model: 'master-marketer',
        version: 1,
        generated_at: new Date().toISOString(),
      },
      raw_metadata: {
        master_marketer: {
          status: 'completed',
          completed_at: new Date().toISOString(),
        },
      },
    },
    { meeting_id: meetingId }
  );

  // 2. Build note content from the AI output
  const contentParts: string[] = [];
  if (output.summary) {
    contentParts.push(`## Summary\n\n${output.summary}`);
  }
  if (output.decisions && output.decisions.length > 0) {
    contentParts.push(`## Decisions\n\n${output.decisions.map((d) => `- ${d}`).join('\n')}`);
  }
  if (output.key_topics && output.key_topics.length > 0) {
    contentParts.push(`## Key Topics\n\n${output.key_topics.map((t) => `- ${t}`).join('\n')}`);
  }

  const actionItems = (output.action_items || []).map((item) => ({
    text: item,
    completed: false,
  }));

  // Calculate week number from the meeting date
  const meetingDate = new Date(date);
  const startOfYear = new Date(meetingDate.getFullYear(), 0, 1);
  const dayOfYear = Math.floor(
    (meetingDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000)
  );
  const weekNumber = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);

  await edgeFnInsert('compass_notes', {
    contract_id: contractId,
    meeting_id: meetingId,
    note_type: 'meeting',
    title: `Meeting Notes: ${title}`,
    content_raw: contentParts.join('\n\n'),
    note_date: date,
    week_number: weekNumber,
    year: meetingDate.getFullYear(),
    status: 'draft',
    action_items: actionItems,
    is_auto_generated: true,
  });
}

/**
 * Core background pipeline: submit transcript to Master Marketer, poll for results, write back.
 * Runs as fire-and-forget — errors are logged and written to raw_metadata.
 */
async function processMeetingInBackground(
  meetingId: string,
  contractId: string,
  transcript: string,
  title: string,
  date: string,
  participants: string[]
): Promise<void> {
  try {
    // Mark as submitted
    await updateProcessingState(meetingId, {
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });

    // Submit to Master Marketer
    const submission: MeetingNotesSubmission = {
      title,
      date,
      participants,
      transcript,
      metadata: {
        source: 'fireflies',
        meeting_id: meetingId,
        contract_id: contractId,
      },
    };

    const { jobId } = await submitMeetingNotes(submission);

    // Update state with job ID
    await updateProcessingState(meetingId, {
      status: 'polling',
      job_id: jobId,
      submitted_at: new Date().toISOString(),
    });

    // Poll until complete
    const result = await pollUntilComplete(jobId);

    if (!result.output) {
      throw new Error('Master Marketer returned completed status but no output');
    }

    // Write results back
    await writeProcessingResults(meetingId, contractId, title, date, result.output);

    console.log(`Meeting ${meetingId} processed successfully (job ${jobId})`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Background processing failed for meeting ${meetingId}:`, errorMessage);

    await updateProcessingState(meetingId, {
      status: 'failed',
      error: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }
}

/**
 * Format transcript segments into a plain text string for Master Marketer
 */
function formatTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join('\n');
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /api/compass/meetings
 * List meetings for a contract with optional filters
 * Query params: contract_id (required), source, limit, offset
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { contract_id, source, limit, offset } = req.query;

  // Validate required params
  if (!contract_id || typeof contract_id !== 'string') {
    res.status(400).json({ error: 'contract_id query parameter is required' });
    return;
  }

  // Validate optional enum params
  if (source && !isValidMeetingSource(source as string)) {
    res.status(400).json({
      error: `Invalid source. Valid values: ${MEETING_SOURCE_VALUES.join(', ')}`,
    });
    return;
  }

  // For clients, verify they have access to this contract
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', contract_id)
      .single();

    if (!access) {
      res.status(403).json({
        error: 'Access denied to this contract',
        code: 'CONTRACT_ACCESS_DENIED',
      });
      return;
    }
  }

  // Build query
  let query = req.supabase
    .from('compass_meetings')
    .select(`
      meeting_id,
      contract_id,
      meeting_date,
      source,
      external_id,
      title,
      participants,
      duration_seconds,
      recording_url,
      transcript,
      sentiment,
      created_at,
      updated_at
    `)
    .eq('contract_id', contract_id)
    .order('meeting_date', { ascending: false });

  // Apply optional filters
  if (source) {
    query = query.eq('source', source as MeetingSource);
  }

  // Apply pagination
  const limitNum = parseInt(limit as string) || 50;
  const offsetNum = parseInt(offset as string) || 0;
  query = query.range(offsetNum, offsetNum + limitNum - 1);

  const { data: meetings, error } = await query;

  if (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
    return;
  }

  // Get linked notes for these meetings
  const meetingIds = (meetings || []).map((m) => m.meeting_id);
  let notesMap: Record<string, { note_id: string; title: string; status: string }> = {};

  if (meetingIds.length > 0) {
    const { data: notes } = await req.supabase
      .from('compass_notes')
      .select('note_id, meeting_id, title, status')
      .in('meeting_id', meetingIds);

    if (notes) {
      notesMap = notes.reduce((acc, note) => {
        if (note.meeting_id) {
          acc[note.meeting_id] = {
            note_id: note.note_id,
            title: note.title,
            status: note.status,
          };
        }
        return acc;
      }, {} as Record<string, { note_id: string; title: string; status: string }>);
    }
  }

  // Transform to include flags
  const meetingsWithFlags = (meetings || []).map((meeting) => ({
    meeting_id: meeting.meeting_id,
    contract_id: meeting.contract_id,
    meeting_date: meeting.meeting_date,
    source: meeting.source,
    external_id: meeting.external_id,
    title: meeting.title,
    participants: meeting.participants,
    duration_seconds: meeting.duration_seconds,
    has_transcript: meeting.transcript !== null,
    has_recording: meeting.recording_url !== null,
    has_sentiment: meeting.sentiment !== null,
    sentiment_label: meeting.sentiment?.label || null,
    has_note: !!notesMap[meeting.meeting_id],
    note: notesMap[meeting.meeting_id] || null,
    created_at: meeting.created_at,
  }));

  res.json({ meetings: meetingsWithFlags });
});

/**
 * GET /api/compass/meetings/:id
 * Get a single meeting by ID (includes full transcript)
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { id } = req.params;

  // Fetch meeting
  const { data: meeting, error } = await req.supabase
    .from('compass_meetings')
    .select('*')
    .eq('meeting_id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }
    console.error('Error fetching meeting:', error);
    res.status(500).json({ error: 'Failed to fetch meeting' });
    return;
  }

  // For clients, verify they have access to this contract
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', meeting.contract_id)
      .single();

    if (!access) {
      res.status(403).json({
        error: 'Access denied to this contract',
        code: 'CONTRACT_ACCESS_DENIED',
      });
      return;
    }
  }

  // Get linked note if exists
  const { data: linkedNote } = await req.supabase
    .from('compass_notes')
    .select('note_id, title, status, content_raw, action_items')
    .eq('meeting_id', id)
    .single();

  res.json({
    meeting: {
      ...meeting,
      note: linkedNote || null,
    },
  });
});

/**
 * POST /api/compass/meetings
 * Create a new meeting (manual entry or with transcript)
 * Body: CreateMeetingDTO
 */
router.post(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const meetingData: CreateMeetingDTO = req.body;

    // Validate required fields
    if (!meetingData.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }

    if (!meetingData.meeting_date) {
      res.status(400).json({ error: 'meeting_date is required' });
      return;
    }

    // Validate data format
    const validationErrors = validateMeetingData(meetingData);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
      });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', meetingData.contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    // If external_id is provided with fireflies source, check for duplicates
    if (meetingData.external_id && meetingData.source === 'fireflies') {
      const { data: existing } = await req.supabase
        .from('compass_meetings')
        .select('meeting_id')
        .eq('external_id', meetingData.external_id)
        .eq('source', 'fireflies')
        .single();

      if (existing) {
        res.status(409).json({
          error: 'A meeting with this Fireflies ID already exists',
          existing_meeting_id: existing.meeting_id,
        });
        return;
      }
    }

    // Create the meeting
    const { data: meeting, error } = await req.supabase
      .from('compass_meetings')
      .insert({
        contract_id: meetingData.contract_id,
        meeting_date: meetingData.meeting_date,
        source: meetingData.source || 'manual',
        external_id: meetingData.external_id || null,
        title: meetingData.title || null,
        participants: meetingData.participants || null,
        duration_seconds: meetingData.duration_seconds || null,
        recording_url: meetingData.recording_url || null,
        transcript: meetingData.transcript || null,
        sentiment: meetingData.sentiment || null,
        raw_metadata: meetingData.raw_metadata || null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating meeting:', error);
      res.status(500).json({ error: 'Failed to create meeting' });
      return;
    }

    res.status(201).json({ meeting });
  }
);

/**
 * POST /api/compass/meetings/from-fireflies
 * Create a meeting by fetching transcript from Fireflies API
 * Body: { contract_id, fireflies_url } or { contract_id, fireflies_id }
 *
 * Returns 201 with the meeting immediately, then auto-submits to
 * Master Marketer for AI analysis in the background (if configured).
 */
router.post(
  '/from-fireflies',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id, fireflies_url, fireflies_id } = req.body;

    if (!contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }

    if (!fireflies_url && !fireflies_id) {
      res.status(400).json({ error: 'Either fireflies_url or fireflies_id is required' });
      return;
    }

    // Extract ID from URL if provided
    const meetingId = fireflies_id || extractFirefliesId(fireflies_url);
    if (!meetingId) {
      res.status(400).json({ error: 'Could not extract Fireflies meeting ID from URL' });
      return;
    }

    // Check if FIREFLIES_API_KEY is configured
    if (!process.env.FIREFLIES_API_KEY) {
      res.status(503).json({
        error: 'Fireflies integration not configured',
        details: 'FIREFLIES_API_KEY environment variable is not set. Please use the manual create endpoint and paste the transcript content directly.',
        extracted_id: meetingId,
      });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    // Check for duplicates
    const { data: existing } = await req.supabase
      .from('compass_meetings')
      .select('meeting_id')
      .eq('external_id', meetingId)
      .eq('source', 'fireflies')
      .single();

    if (existing) {
      res.status(409).json({
        error: 'A meeting with this Fireflies ID already exists',
        existing_meeting_id: existing.meeting_id,
      });
      return;
    }

    // Fetch transcript from Fireflies
    let firefliesData;
    try {
      firefliesData = await fetchTranscript(meetingId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Fireflies API error:', message);
      res.status(502).json({
        error: 'Failed to fetch transcript from Fireflies',
        details: message,
      });
      return;
    }

    if (!firefliesData) {
      res.status(404).json({
        error: 'Transcript not found in Fireflies',
        fireflies_id: meetingId,
      });
      return;
    }

    // Map Fireflies sentences to TranscriptSegment[]
    const transcriptSegments: TranscriptSegment[] = (firefliesData.sentences || []).map(
      (s) => ({
        speaker: s.speaker_name,
        text: s.text,
        start_time: s.start_time,
        end_time: s.end_time,
      })
    );

    // Insert meeting into compass_meetings
    const { data: meeting, error: insertError } = await req.supabase
      .from('compass_meetings')
      .insert({
        contract_id,
        meeting_date: firefliesData.date,
        source: 'fireflies' as MeetingSource,
        external_id: firefliesData.id,
        title: firefliesData.title,
        participants: firefliesData.participants,
        duration_seconds: firefliesData.duration ? Math.round(firefliesData.duration * 60) : null,
        recording_url: firefliesData.audio_url || firefliesData.transcript_url || null,
        transcript: transcriptSegments,
        raw_metadata: {
          fireflies_summary: firefliesData.summary || null,
          master_marketer: { status: 'pending' },
        },
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating meeting from Fireflies:', insertError);
      res.status(500).json({ error: 'Failed to create meeting' });
      return;
    }

    // Return immediately with processing status
    res.status(201).json({
      meeting,
      processing: { status: 'pending' },
    });

    // Fire-and-forget: auto-process if Master Marketer is configured
    if (process.env.MASTER_MARKETER_URL && process.env.MASTER_MARKETER_API_KEY) {
      const transcriptText = formatTranscriptText(transcriptSegments);
      processMeetingInBackground(
        meeting.meeting_id,
        contract_id,
        transcriptText,
        firefliesData.title || 'Untitled Meeting',
        firefliesData.date,
        firefliesData.participants || []
      ).catch(() => {
        // Already handled inside processMeetingInBackground
      });
    }
  }
);

/**
 * POST /api/compass/meetings/:id/process
 * Manually trigger Master Marketer processing for an existing meeting
 * Meeting must have a transcript. Returns 202 immediately; processing runs in background.
 */
router.post(
  '/:id/process',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Check Master Marketer is configured
    if (!process.env.MASTER_MARKETER_URL || !process.env.MASTER_MARKETER_API_KEY) {
      res.status(503).json({
        error: 'Master Marketer integration not configured',
        details: 'MASTER_MARKETER_URL and MASTER_MARKETER_API_KEY environment variables are required.',
      });
      return;
    }

    const { id } = req.params;

    // Fetch meeting
    const { data: meeting, error } = await req.supabase
      .from('compass_meetings')
      .select('*')
      .eq('meeting_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Meeting not found' });
        return;
      }
      console.error('Error fetching meeting:', error);
      res.status(500).json({ error: 'Failed to fetch meeting' });
      return;
    }

    // Must have a transcript
    if (!meeting.transcript) {
      res.status(400).json({
        error: 'Meeting has no transcript to process',
        details: 'Add a transcript to this meeting before processing.',
      });
      return;
    }

    // Check if already processing (prevent duplicate runs)
    const rawMeta = meeting.raw_metadata as ProcessingState | null;
    const currentStatus = rawMeta?.master_marketer?.status;
    if (currentStatus === 'submitted' || currentStatus === 'polling') {
      res.status(409).json({
        error: 'Meeting is already being processed',
        processing: rawMeta?.master_marketer,
      });
      return;
    }

    // Format transcript text
    let transcriptText: string;
    if (Array.isArray(meeting.transcript)) {
      transcriptText = formatTranscriptText(meeting.transcript as TranscriptSegment[]);
    } else if (typeof meeting.transcript === 'string') {
      transcriptText = meeting.transcript;
    } else {
      transcriptText = JSON.stringify(meeting.transcript);
    }

    // Return 202 immediately
    res.status(202).json({
      message: 'Processing started',
      meeting_id: id,
      processing: { status: 'pending' },
    });

    // Fire-and-forget
    processMeetingInBackground(
      meeting.meeting_id,
      meeting.contract_id,
      transcriptText,
      meeting.title || 'Untitled Meeting',
      meeting.meeting_date,
      meeting.participants || []
    ).catch(() => {
      // Already handled inside processMeetingInBackground
    });
  }
);

/**
 * PUT /api/compass/meetings/:id
 * Update an existing meeting
 * Body: UpdateMeetingDTO
 */
router.put(
  '/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const updateData: UpdateMeetingDTO = req.body;

    // Validate data if provided
    const validationErrors = validateMeetingData(updateData);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
      });
      return;
    }

    // Check if meeting exists
    const { data: existingMeeting, error: fetchError } = await req.supabase
      .from('compass_meetings')
      .select('meeting_id')
      .eq('meeting_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Meeting not found' });
        return;
      }
      console.error('Error fetching meeting:', fetchError);
      res.status(500).json({ error: 'Failed to fetch meeting' });
      return;
    }

    // Build update object with only provided fields
    const updateFields: Record<string, unknown> = {};
    if (updateData.meeting_date !== undefined) updateFields.meeting_date = updateData.meeting_date;
    if (updateData.source !== undefined) updateFields.source = updateData.source;
    if (updateData.external_id !== undefined) updateFields.external_id = updateData.external_id;
    if (updateData.title !== undefined) updateFields.title = updateData.title;
    if (updateData.participants !== undefined) updateFields.participants = updateData.participants;
    if (updateData.duration_seconds !== undefined) updateFields.duration_seconds = updateData.duration_seconds;
    if (updateData.recording_url !== undefined) updateFields.recording_url = updateData.recording_url;
    if (updateData.transcript !== undefined) updateFields.transcript = updateData.transcript;
    if (updateData.sentiment !== undefined) updateFields.sentiment = updateData.sentiment;
    if (updateData.raw_metadata !== undefined) updateFields.raw_metadata = updateData.raw_metadata;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Update the meeting
    const { data: meeting, error } = await req.supabase
      .from('compass_meetings')
      .update(updateFields)
      .eq('meeting_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating meeting:', error);
      res.status(500).json({ error: 'Failed to update meeting' });
      return;
    }

    res.json({ meeting });
  }
);

/**
 * DELETE /api/compass/meetings/:id
 * Delete a meeting (also unlinks any associated notes)
 */
router.delete(
  '/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Check if meeting exists
    const { data: existingMeeting, error: fetchError } = await req.supabase
      .from('compass_meetings')
      .select('meeting_id')
      .eq('meeting_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Meeting not found' });
        return;
      }
      console.error('Error fetching meeting:', fetchError);
      res.status(500).json({ error: 'Failed to fetch meeting' });
      return;
    }

    // Unlink any associated notes (set meeting_id to null, don't delete the note)
    await req.supabase
      .from('compass_notes')
      .update({ meeting_id: null })
      .eq('meeting_id', id);

    // Delete the meeting
    const { error } = await req.supabase
      .from('compass_meetings')
      .delete()
      .eq('meeting_id', id);

    if (error) {
      console.error('Error deleting meeting:', error);
      res.status(500).json({ error: 'Failed to delete meeting' });
      return;
    }

    res.status(204).send();
  }
);

export default router;
