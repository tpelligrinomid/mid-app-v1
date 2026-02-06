import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import {
  CreateMeetingDTO,
  UpdateMeetingDTO,
  MeetingSource,
  validateMeetingData,
  isValidMeetingSource,
  MEETING_SOURCE_VALUES,
  extractFirefliesId,
} from '../../types/meetings.js';

const router = Router();

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
 * Create a meeting by fetching from Fireflies API
 * Body: { contract_id, fireflies_url } or { contract_id, fireflies_id }
 *
 * NOTE: This endpoint is a placeholder. Fireflies API integration requires
 * an API key and additional setup. For now, use the manual create endpoint
 * and paste the transcript content directly.
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

    // TODO: Implement Fireflies API call
    // const firefliesData = await fetchFromFireflies(meetingId);
    // For now, return a placeholder response indicating the feature needs setup

    res.status(501).json({
      error: 'Fireflies API integration not yet implemented',
      details: 'Use the manual create endpoint (/api/compass/meetings) and paste the transcript content directly.',
      extracted_id: meetingId,
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
