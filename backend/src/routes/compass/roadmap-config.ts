import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { roadmapModelConfig } from '../../config/roadmap-model.js';

const router = Router();

/**
 * GET /api/compass/roadmap-config
 *
 * The program roadmap model as data: tier bands, eligibility matrix, category rollup,
 * measured constants, the commitment ladder, and the closed flag vocabulary.
 *
 * Exists so the generation form validates against the same definition the backend
 * enforces. A second hardcoded copy in the frontend drifts silently, and the first symptom
 * is a roadmap that passes the form and is refused on submit.
 *
 * Static — served from a constants module, no database read. Cached for an hour; the
 * values only change with a deploy.
 */
router.get(
  '/',
  requireRole('admin', 'team_member'),
  async (_req: Request, res: Response): Promise<void> => {
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ success: true, ...roadmapModelConfig() });
  }
);

export default router;
