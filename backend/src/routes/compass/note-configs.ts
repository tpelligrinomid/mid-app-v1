import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import {
  CreateNoteConfigDTO,
  UpdateNoteConfigDTO,
  NoteConfig,
  validateNoteConfigData,
  isValidAutoNoteType,
  AUTO_NOTE_TYPE_VALUES,
} from '../../types/note-configs.js';
import { computeNextRunAt } from '../../services/strategy-notes/scheduler.js';
import { generateStrategyNote } from '../../services/strategy-notes/generate.js';

const router = Router();

/**
 * GET /api/compass/note-configs
 * List all note configs for a contract
 * Query params: contract_id (required)
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { contract_id } = req.query;

  if (!contract_id || typeof contract_id !== 'string') {
    res.status(400).json({ error: 'contract_id query parameter is required' });
    return;
  }

  const { data: configs, error } = await req.supabase
    .from('compass_note_configs')
    .select('*')
    .eq('contract_id', contract_id)
    .order('note_type', { ascending: true });

  if (error) {
    console.error('[NoteConfigs] Error fetching configs:', error);
    res.status(500).json({ error: 'Failed to fetch note configs' });
    return;
  }

  res.json({ configs: configs || [] });
});

/**
 * GET /api/compass/note-configs/:id
 * Get a single config
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  if (!req.supabase || !req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const { id } = req.params;

  const { data: config, error } = await req.supabase
    .from('compass_note_configs')
    .select('*')
    .eq('config_id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      res.status(404).json({ error: 'Note config not found' });
      return;
    }
    console.error('[NoteConfigs] Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch note config' });
    return;
  }

  res.json({ config });
});

/**
 * POST /api/compass/note-configs
 * Create a new note config (starts disabled)
 */
router.post(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const configData: CreateNoteConfigDTO = req.body;

    // Validate required fields
    if (!configData.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }
    if (!configData.note_type) {
      res.status(400).json({ error: 'note_type is required' });
      return;
    }
    if (configData.day_of_week === undefined) {
      res.status(400).json({ error: 'day_of_week is required' });
      return;
    }

    const validationErrors = validateNoteConfigData(configData as unknown as Record<string, unknown>);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', configData.contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    const { data: config, error } = await req.supabase
      .from('compass_note_configs')
      .insert({
        contract_id: configData.contract_id,
        note_type: configData.note_type,
        enabled: false,
        day_of_week: configData.day_of_week,
        generate_time: configData.generate_time || '20:00',
        timezone: configData.timezone || 'America/New_York',
        lookback_days: configData.lookback_days || 7,
        lookahead_days: configData.lookahead_days || 30,
        additional_instructions: configData.additional_instructions || null,
        created_by: req.user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({
          error: `A ${configData.note_type} note config already exists for this contract`,
        });
        return;
      }
      console.error('[NoteConfigs] Error creating config:', error);
      res.status(500).json({ error: 'Failed to create note config' });
      return;
    }

    res.status(201).json({ config });
  }
);

/**
 * PUT /api/compass/note-configs/:id
 * Update a config (enable/disable, change schedule, etc.)
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
    const updateData: UpdateNoteConfigDTO = req.body;

    const validationErrors = validateNoteConfigData(updateData as unknown as Record<string, unknown>);
    if (validationErrors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: validationErrors });
      return;
    }

    // Check if config exists
    const { data: existing, error: fetchError } = await req.supabase
      .from('compass_note_configs')
      .select('*')
      .eq('config_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Note config not found' });
        return;
      }
      console.error('[NoteConfigs] Error fetching config:', fetchError);
      res.status(500).json({ error: 'Failed to fetch note config' });
      return;
    }

    // Build update object
    const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updateData.enabled !== undefined) updateFields.enabled = updateData.enabled;
    if (updateData.day_of_week !== undefined) updateFields.day_of_week = updateData.day_of_week;
    if (updateData.generate_time !== undefined) updateFields.generate_time = updateData.generate_time;
    if (updateData.timezone !== undefined) updateFields.timezone = updateData.timezone;
    if (updateData.lookback_days !== undefined) updateFields.lookback_days = updateData.lookback_days;
    if (updateData.lookahead_days !== undefined) updateFields.lookahead_days = updateData.lookahead_days;
    if (updateData.additional_instructions !== undefined) updateFields.additional_instructions = updateData.additional_instructions;

    // Recompute next_run_at if schedule changed or enabling
    const scheduleChanged = updateData.day_of_week !== undefined
      || updateData.generate_time !== undefined
      || updateData.timezone !== undefined;
    const enabling = updateData.enabled === true && !existing.enabled;

    if (scheduleChanged || enabling) {
      const dayOfWeek = updateData.day_of_week ?? existing.day_of_week;
      const generateTime = updateData.generate_time ?? existing.generate_time;
      const timezone = updateData.timezone ?? existing.timezone;
      updateFields.next_run_at = computeNextRunAt(dayOfWeek, generateTime, timezone);
    }

    // If disabling, clear next_run_at
    if (updateData.enabled === false) {
      updateFields.next_run_at = null;
    }

    const { data: config, error } = await req.supabase
      .from('compass_note_configs')
      .update(updateFields)
      .eq('config_id', id)
      .select()
      .single();

    if (error) {
      console.error('[NoteConfigs] Error updating config:', error);
      res.status(500).json({ error: 'Failed to update note config' });
      return;
    }

    res.json({ config });
  }
);

/**
 * DELETE /api/compass/note-configs/:id
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

    const { data: existing, error: fetchError } = await req.supabase
      .from('compass_note_configs')
      .select('config_id')
      .eq('config_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Note config not found' });
        return;
      }
      console.error('[NoteConfigs] Error fetching config:', fetchError);
      res.status(500).json({ error: 'Failed to fetch note config' });
      return;
    }

    const { error } = await req.supabase
      .from('compass_note_configs')
      .delete()
      .eq('config_id', id);

    if (error) {
      console.error('[NoteConfigs] Error deleting config:', error);
      res.status(500).json({ error: 'Failed to delete note config' });
      return;
    }

    res.status(204).send();
  }
);

/**
 * POST /api/compass/note-configs/:id/generate-now
 * Generate a note immediately (for testing/manual trigger)
 */
router.post(
  '/:id/generate-now',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    // Fetch the config
    const { data: config, error: fetchError } = await req.supabase
      .from('compass_note_configs')
      .select('*')
      .eq('config_id', id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        res.status(404).json({ error: 'Note config not found' });
        return;
      }
      console.error('[NoteConfigs] Error fetching config:', fetchError);
      res.status(500).json({ error: 'Failed to fetch note config' });
      return;
    }

    try {
      const note = await generateStrategyNote(config as NoteConfig);

      res.json({
        success: true,
        note_id: note.note_id,
        title: note.title,
        status: note.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[NoteConfigs] Generate-now failed:', error);
      res.status(500).json({ error: 'Failed to generate note', details: message });
    }
  }
);

export default router;
