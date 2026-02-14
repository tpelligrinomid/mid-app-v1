import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import {
  validateDeliverableInput,
  isValidDeliverableType,
  isValidDeliverableStatus,
  DELIVERABLE_TYPE_VALUES,
  DELIVERABLE_STATUS_VALUES,
} from '../../types/deliverables.js';
import type {
  Deliverable,
  DeliverableInput,
  DeliverableUpdate,
  DeliverableVersion,
} from '../../types/deliverables.js';
import { insert, update, del } from '../../utils/edge-functions.js';
import { ingestContent } from '../../services/rag/ingestion.js';
import { generateDeliverableInBackground } from '../../services/deliverable-generation/processor.js';
import type { GenerateDeliverableRequest, GenerationState } from '../../services/deliverable-generation/types.js';

const router = Router();

// ============================================================================
// Deliverable CRUD
// ============================================================================

/**
 * GET /api/compass/deliverables?contract_id=X
 * List deliverables for a contract (lightweight, no content fields)
 */
router.get(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id, deliverable_type, status } = req.query;

    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    if (deliverable_type && !isValidDeliverableType(deliverable_type as string)) {
      res.status(400).json({
        error: `Invalid deliverable_type. Valid values: ${DELIVERABLE_TYPE_VALUES.join(', ')}`,
      });
      return;
    }

    if (status && !isValidDeliverableStatus(status as string)) {
      res.status(400).json({
        error: `Invalid status. Valid values: ${DELIVERABLE_STATUS_VALUES.join(', ')}`,
      });
      return;
    }

    try {
      let query = req.supabase
        .from('compass_deliverables')
        .select(`
          deliverable_id,
          contract_id,
          title,
          deliverable_type,
          status,
          description,
          clickup_task_id,
          due_date,
          delivered_date,
          version,
          created_by,
          created_at,
          updated_at
        `)
        .eq('contract_id', contract_id)
        .order('created_at', { ascending: false });

      if (deliverable_type) {
        query = query.eq('deliverable_type', deliverable_type as string);
      }

      if (status) {
        query = query.eq('status', status as string);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Deliverables] List error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ deliverables: data || [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] List error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/compass/deliverables/:id
 * Get single deliverable with content
 */
router.get(
  '/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const { data, error } = await req.supabase
        .from('compass_deliverables')
        .select('*')
        .eq('deliverable_id', req.params.id)
        .maybeSingle();

      if (error) {
        console.error('[Deliverables] Get error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      if (!data) {
        res.status(404).json({ error: 'Deliverable not found' });
        return;
      }

      res.json({ deliverable: data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] Get error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/compass/deliverables
 * Create deliverable (auto-embeds content if provided)
 */
router.post(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: DeliverableInput = req.body;

    if (!input.contract_id) {
      res.status(400).json({ error: 'contract_id is required' });
      return;
    }

    if (!input.title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    if (!input.deliverable_type) {
      res.status(400).json({ error: 'deliverable_type is required' });
      return;
    }

    const errors = validateDeliverableInput(input);
    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    // Verify contract exists
    const { data: contract, error: contractError } = await req.supabase
      .from('contracts')
      .select('contract_id')
      .eq('contract_id', input.contract_id)
      .single();

    if (contractError || !contract) {
      res.status(400).json({ error: 'Invalid contract_id: contract not found' });
      return;
    }

    try {
      const insertData: Record<string, unknown> = {
        contract_id: input.contract_id,
        title: input.title,
        deliverable_type: input.deliverable_type,
        status: input.status || 'planned',
        description: input.description || null,
        content_raw: input.content_raw || null,
        content_structured: input.content_structured || null,
        clickup_task_id: input.clickup_task_id || null,
        due_date: input.due_date || null,
        delivered_date: input.delivered_date || null,
        created_by: req.user.id,
      };

      const result = await insert<Deliverable[]>(
        'compass_deliverables',
        insertData,
        { select: '*' }
      );

      const deliverable = result[0];

      // Auto-embed content if provided
      const contentToEmbed = input.content_raw ||
        (input.content_structured ? JSON.stringify(input.content_structured) : null);

      if (contentToEmbed && process.env.OPENAI_API_KEY) {
        try {
          await ingestContent({
            contract_id: input.contract_id,
            source_type: 'deliverable',
            source_id: deliverable.deliverable_id,
            title: input.title,
            content: contentToEmbed,
          });
        } catch (embedErr) {
          console.error('[Deliverables] Embedding failed (non-blocking):', embedErr);
        }
      }

      res.status(201).json({ deliverable });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] Create error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /api/compass/deliverables/:id
 * Update deliverable (re-embeds if content changed)
 */
router.put(
  '/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const deliverableId = req.params.id;
    const updates: DeliverableUpdate = req.body;

    const errors = validateDeliverableInput(updates);
    if (errors.length > 0) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }

    // Verify deliverable exists
    const { data: existing, error: fetchError } = await req.supabase
      .from('compass_deliverables')
      .select('*')
      .eq('deliverable_id', deliverableId)
      .maybeSingle();

    if (fetchError) {
      console.error('[Deliverables] Fetch error:', fetchError);
      res.status(500).json({ error: fetchError.message });
      return;
    }

    if (!existing) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    try {
      const updateFields: Record<string, unknown> = {};
      if (updates.title !== undefined) updateFields.title = updates.title;
      if (updates.deliverable_type !== undefined) updateFields.deliverable_type = updates.deliverable_type;
      if (updates.status !== undefined) updateFields.status = updates.status;
      if (updates.description !== undefined) updateFields.description = updates.description;
      if (updates.content_raw !== undefined) updateFields.content_raw = updates.content_raw;
      if (updates.content_structured !== undefined) updateFields.content_structured = updates.content_structured;
      if (updates.clickup_task_id !== undefined) updateFields.clickup_task_id = updates.clickup_task_id;
      if (updates.due_date !== undefined) updateFields.due_date = updates.due_date;
      if (updates.delivered_date !== undefined) updateFields.delivered_date = updates.delivered_date;

      if (Object.keys(updateFields).length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      const result = await update<Deliverable[]>(
        'compass_deliverables',
        updateFields,
        { deliverable_id: deliverableId },
        { select: '*' }
      );

      const deliverable = result[0];

      // Re-embed if content changed
      const contentChanged = updates.content_raw !== undefined || updates.content_structured !== undefined;
      if (contentChanged && process.env.OPENAI_API_KEY) {
        const contentToEmbed = deliverable.content_raw ||
          (deliverable.content_structured ? JSON.stringify(deliverable.content_structured) : null);

        if (contentToEmbed) {
          try {
            await ingestContent({
              contract_id: deliverable.contract_id,
              source_type: 'deliverable',
              source_id: deliverable.deliverable_id,
              title: deliverable.title,
              content: contentToEmbed,
            });
          } catch (embedErr) {
            console.error('[Deliverables] Re-embedding failed (non-blocking):', embedErr);
          }
        }
      }

      res.json({ deliverable });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] Update error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * DELETE /api/compass/deliverables/:id
 * Delete deliverable and its knowledge chunks
 */
router.delete(
  '/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const deliverableId = req.params.id;

    // Verify it exists
    const { data: existing, error: fetchError } = await req.supabase
      .from('compass_deliverables')
      .select('deliverable_id')
      .eq('deliverable_id', deliverableId)
      .maybeSingle();

    if (fetchError) {
      console.error('[Deliverables] Fetch error:', fetchError);
      res.status(500).json({ error: fetchError.message });
      return;
    }

    if (!existing) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    try {
      // Delete knowledge chunks first
      try {
        await del('compass_knowledge', { source_id: deliverableId });
      } catch (chunkErr) {
        console.warn('[Deliverables] Knowledge chunk cleanup warning:', chunkErr);
      }

      // Delete versions (FK constraint)
      try {
        await del('compass_deliverable_versions', { deliverable_id: deliverableId });
      } catch (versionErr) {
        console.warn('[Deliverables] Version cleanup warning:', versionErr);
      }

      // Delete the deliverable
      await del('compass_deliverables', { deliverable_id: deliverableId });

      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] Delete error:', err);
      res.status(500).json({ error: message });
    }
  }
);

// ============================================================================
// AI Generation
// ============================================================================

/**
 * POST /api/compass/deliverables/:id/generate
 * Trigger AI generation for a deliverable.
 * Returns 202 immediately; generation runs in the background.
 */
router.post(
  '/:id/generate',
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

    const deliverableId = req.params.id;
    const { instructions, primary_meeting_ids, research_inputs, previous_roadmap_id } = req.body as GenerateDeliverableRequest;

    // Frontend nests seed_topics/max_crawl_pages inside research_inputs; accept both locations
    const body = req.body as Record<string, unknown>;
    const ri = research_inputs as Record<string, unknown> | undefined;
    const seed_topics = (body.seed_topics ?? ri?.seed_topics) as string[] | undefined;
    const max_crawl_pages = (body.max_crawl_pages ?? ri?.max_crawl_pages) as number | undefined;

    console.log('[Deliverables] Generate request body:', JSON.stringify({
      has_instructions: !!instructions,
      has_research_inputs: !!research_inputs,
      client: research_inputs?.client,
      competitors_count: research_inputs?.competitors?.length,
      seed_topics,
      max_crawl_pages,
    }));

    // Fetch the deliverable
    const { data: deliverable, error: fetchError } = await req.supabase
      .from('compass_deliverables')
      .select('*')
      .eq('deliverable_id', deliverableId)
      .maybeSingle();

    if (fetchError) {
      console.error('[Deliverables] Generate fetch error:', fetchError);
      res.status(500).json({ error: fetchError.message });
      return;
    }

    if (!deliverable) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    // Check not already generating (prevent duplicate runs)
    const metadata = deliverable.metadata as GenerationState | null;
    const currentStatus = metadata?.generation?.status;
    if (
      currentStatus === 'assembling_context' ||
      currentStatus === 'submitted'
    ) {
      res.status(409).json({
        error: 'Generation is already in progress',
        generation: metadata?.generation,
      });
      return;
    }

    // Return 202 immediately
    res.status(202).json({
      message: 'Generation started',
      deliverable_id: deliverableId,
      processing: { status: 'pending' },
    });

    // Fire-and-forget
    generateDeliverableInBackground(
      deliverableId,
      deliverable.contract_id,
      deliverable.title,
      deliverable.deliverable_type,
      instructions,
      primary_meeting_ids,
      research_inputs,
      previous_roadmap_id,
      seed_topics,
      max_crawl_pages
    ).catch(() => {
      // Already handled inside generateDeliverableInBackground
    });
  }
);

/**
 * GET /api/compass/deliverables/:id/generation-status
 * Check AI generation progress for a deliverable.
 */
router.get(
  '/:id/generation-status',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const deliverableId = req.params.id;

    const { data: deliverable, error } = await req.supabase
      .from('compass_deliverables')
      .select('metadata')
      .eq('deliverable_id', deliverableId)
      .maybeSingle();

    if (error) {
      console.error('[Deliverables] Generation status error:', error);
      res.status(500).json({ error: error.message });
      return;
    }

    if (!deliverable) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    const metadata = deliverable.metadata as GenerationState | null;
    res.json({ generation: metadata?.generation || null });
  }
);

// ============================================================================
// Version History
// ============================================================================

/**
 * GET /api/compass/deliverables/:id/versions
 * List version history for a deliverable
 */
router.get(
  '/:id/versions',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const { data, error } = await req.supabase
        .from('compass_deliverable_versions')
        .select('*')
        .eq('deliverable_id', req.params.id)
        .order('version_number', { ascending: false });

      if (error) {
        console.error('[Deliverables] List versions error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ versions: data || [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] List versions error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/compass/deliverables/:id/versions
 * Create a new version snapshot
 */
router.post(
  '/:id/versions',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const deliverableId = req.params.id;

    // Fetch current deliverable
    const { data: deliverable, error: fetchError } = await req.supabase
      .from('compass_deliverables')
      .select('*')
      .eq('deliverable_id', deliverableId)
      .maybeSingle();

    if (fetchError) {
      console.error('[Deliverables] Fetch error:', fetchError);
      res.status(500).json({ error: fetchError.message });
      return;
    }

    if (!deliverable) {
      res.status(404).json({ error: 'Deliverable not found' });
      return;
    }

    try {
      const currentVer = parseFloat(deliverable.version || '1.0');
      const nextVersion = (Math.floor(currentVer) + 1).toFixed(1);
      const { change_summary } = req.body;

      const versionData: Record<string, unknown> = {
        deliverable_id: deliverableId,
        version_number: nextVersion,
        drive_url: deliverable.drive_url || null,
        change_summary: change_summary || null,
        created_by: req.user.id,
      };

      const result = await insert<DeliverableVersion[]>(
        'compass_deliverable_versions',
        versionData,
        { select: '*' }
      );

      // Update version on the deliverable
      await update(
        'compass_deliverables',
        { version: nextVersion },
        { deliverable_id: deliverableId }
      );

      res.status(201).json({ version: result[0] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Deliverables] Create version error:', err);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
