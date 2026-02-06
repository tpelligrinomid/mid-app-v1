import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import {
  CreateNoteDTO,
  UpdateNoteDTO,
  NoteType,
  NoteStatus,
  validateNoteData,
  isValidNoteType,
  isValidNoteStatus,
  NOTE_TYPE_VALUES,
  NOTE_STATUS_VALUES,
} from '../../types/notes.js';

const router = Router();

/**
 * GET /api/compass/notes
 * List notes for a contract with optional filters
 * Query params: contract_id (required), note_type, status, limit, offset
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { contract_id, note_type, status, limit, offset } = req.query;

  // Validate required params
  if (!contract_id || typeof contract_id !== 'string') {
    res.status(400).json({ error: 'contract_id query parameter is required' });
    return;
  }

  // Validate optional enum params
  if (note_type && !isValidNoteType(note_type as string)) {
    res.status(400).json({
      error: `Invalid note_type. Valid values: ${NOTE_TYPE_VALUES.join(', ')}`,
    });
    return;
  }

  if (status && !isValidNoteStatus(status as string)) {
    res.status(400).json({
      error: `Invalid status. Valid values: ${NOTE_STATUS_VALUES.join(', ')}`,
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
    .from('compass_notes')
    .select(`
      note_id,
      contract_id,
      note_type,
      title,
      note_date,
      status,
      is_auto_generated,
      action_items,
      created_at,
      updated_at
    `)
    .eq('contract_id', contract_id)
    .order('note_date', { ascending: false });

  // Apply optional filters
  if (note_type) {
    query = query.eq('note_type', note_type as NoteType);
  }

  if (status) {
    query = query.eq('status', status as NoteStatus);
  }

  // Apply pagination
  const limitNum = parseInt(limit as string) || 50;
  const offsetNum = parseInt(offset as string) || 0;
  query = query.range(offsetNum, offsetNum + limitNum - 1);

  const { data: notes, error } = await query;

  if (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
    return;
  }

  // Transform to include has_action_items flag
  const notesWithFlags = (notes || []).map((note) => ({
    ...note,
    has_action_items: Array.isArray(note.action_items) && note.action_items.length > 0,
    action_items: undefined, // Remove raw action_items from list view
  }));

  res.json({ notes: notesWithFlags });
});

/**
 * GET /api/compass/notes/:id
 * Get a single note by ID
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { id } = req.params;

  // Fetch note with meeting data if linked
  const { data: note, error } = await req.supabase
    .from('compass_notes')
    .select(`
      *,
      meeting:compass_meetings(
        meeting_id,
        meeting_date,
        title,
        recording_url,
        participants,
        duration_seconds
      )
    `)
    .eq('note_id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Note not found' });
      return;
    }
    console.error('Error fetching note:', error);
    res.status(500).json({ error: 'Failed to fetch note' });
    return;
  }

  // For clients, verify they have access to this contract
  if (req.user.role === 'client') {
    const { data: access } = await req.supabase
      .from('user_contract_access')
      .select('contract_id')
      .eq('user_id', req.user.id)
      .eq('contract_id', note.contract_id)
      .single();

    if (!access) {
      res.status(403).json({
        error: 'Access denied to this contract',
        code: 'CONTRACT_ACCESS_DENIED',
      });
      return;
    }
  }

  res.json({ note });
});

/**
 * POST /api/compass/notes
 * Create a new note
 * Body: CreateNoteDTO
 */
router.post(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const noteData: CreateNoteDTO = req.body;

    // Validate required fields
    if (!noteData.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }

    if (!noteData.note_type) {
      res.status(400).json({ error: 'note_type is required' });
      return;
    }

    if (!noteData.title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    if (!noteData.note_date) {
      res.status(400).json({ error: 'note_date is required' });
      return;
    }

    // Validate enum values and data format
    const validationErrors = validateNoteData(noteData);
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
      .eq('contract_id', noteData.contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    // If meeting_id is provided, verify it exists and belongs to the same contract
    if (noteData.meeting_id) {
      const { data: meeting, error: meetingError } = await req.supabase
        .from('compass_meetings')
        .select('meeting_id, contract_id')
        .eq('meeting_id', noteData.meeting_id)
        .single();

      if (meetingError || !meeting) {
        res.status(400).json({ error: 'Invalid meeting_id: meeting not found' });
        return;
      }

      if (meeting.contract_id !== noteData.contract_id) {
        res.status(400).json({ error: 'meeting_id must belong to the same contract' });
        return;
      }
    }

    // Create the note
    const { data: note, error } = await req.supabase
      .from('compass_notes')
      .insert({
        contract_id: noteData.contract_id,
        note_type: noteData.note_type,
        title: noteData.title,
        content_raw: noteData.content_raw || null,
        content_structured: noteData.content_structured || null,
        note_date: noteData.note_date,
        week_number: noteData.week_number || null,
        year: noteData.year || null,
        status: noteData.status || 'draft',
        meeting_id: noteData.meeting_id || null,
        action_items: noteData.action_items || null,
        is_auto_generated: noteData.is_auto_generated || false,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating note:', error);
      res.status(500).json({ error: 'Failed to create note' });
      return;
    }

    res.status(201).json({ note });
  }
);

/**
 * PUT /api/compass/notes/:id
 * Update an existing note
 * Body: UpdateNoteDTO
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
    const updateData: UpdateNoteDTO = req.body;

    // Validate enum values if provided
    const validationErrors = validateNoteData(updateData);
    if (validationErrors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: validationErrors,
      });
      return;
    }

    // Check if note exists
    const { data: existingNote, error: fetchError } = await req.supabase
      .from('compass_notes')
      .select('note_id')
      .eq('note_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      console.error('Error fetching note:', fetchError);
      res.status(500).json({ error: 'Failed to fetch note' });
      return;
    }

    // Build update object with only provided fields
    const updateFields: Record<string, unknown> = {};
    if (updateData.note_type !== undefined) updateFields.note_type = updateData.note_type;
    if (updateData.title !== undefined) updateFields.title = updateData.title;
    if (updateData.content_raw !== undefined) updateFields.content_raw = updateData.content_raw;
    if (updateData.content_structured !== undefined) updateFields.content_structured = updateData.content_structured;
    if (updateData.note_date !== undefined) updateFields.note_date = updateData.note_date;
    if (updateData.week_number !== undefined) updateFields.week_number = updateData.week_number;
    if (updateData.year !== undefined) updateFields.year = updateData.year;
    if (updateData.status !== undefined) updateFields.status = updateData.status;
    if (updateData.action_items !== undefined) updateFields.action_items = updateData.action_items;

    if (Object.keys(updateFields).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Update the note
    const { data: note, error } = await req.supabase
      .from('compass_notes')
      .update(updateFields)
      .eq('note_id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating note:', error);
      res.status(500).json({ error: 'Failed to update note' });
      return;
    }

    res.json({ note });
  }
);

/**
 * DELETE /api/compass/notes/:id
 * Delete a note
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

    // Check if note exists
    const { data: existingNote, error: fetchError } = await req.supabase
      .from('compass_notes')
      .select('note_id')
      .eq('note_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Note not found' });
        return;
      }
      console.error('Error fetching note:', fetchError);
      res.status(500).json({ error: 'Failed to fetch note' });
      return;
    }

    // Delete the note
    const { error } = await req.supabase
      .from('compass_notes')
      .delete()
      .eq('note_id', id);

    if (error) {
      console.error('Error deleting note:', error);
      res.status(500).json({ error: 'Failed to delete note' });
      return;
    }

    res.status(204).send();
  }
);

export default router;
