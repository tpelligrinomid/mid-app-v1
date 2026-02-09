import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';

const router = Router();

/**
 * GET /api/compass/process-library
 * List all active process library items
 * Query params: phase, category (optional filters)
 */
router.get(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { phase, category } = req.query;

    let query = req.supabase
      .from('compass_process_library')
      .select('*')
      .eq('is_active', true)
      .order('phase_order', { ascending: true })
      .order('name', { ascending: true });

    if (phase && typeof phase === 'string') {
      query = query.eq('phase', phase);
    }

    if (category && typeof category === 'string') {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching process library:', error);
      res.status(500).json({ error: 'Failed to fetch process library' });
      return;
    }

    res.json({ processes: data || [] });
  }
);

/**
 * GET /api/compass/process-library/:id
 * Get a single process library item
 */
router.get(
  '/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;

    const { data, error } = await req.supabase
      .from('compass_process_library')
      .select('*')
      .eq('process_id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.status(404).json({ error: 'Process not found' });
        return;
      }
      console.error('Error fetching process:', error);
      res.status(500).json({ error: 'Failed to fetch process' });
      return;
    }

    res.json({ process: data });
  }
);

export default router;
