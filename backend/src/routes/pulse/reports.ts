import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { ManagementReportService } from '../../services/reports/management-report.js';
import type { ManagementReportListItem, ManagementReport } from '../../types/reports.js';

const router = Router();

// GET /api/pulse/reports
// List management reports (paginated, excludes contracts JSONB)
router.get(
  '/',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const { data, error, count } = await req.supabase
        .from('pulse_management_reports')
        .select(
          'report_id, report_type, generated_at, period_start, period_end, triggered_by, triggered_by_user_id, summary, status, error_message, created_at, updated_at',
          { count: 'exact' }
        )
        .order('generated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('[Reports] List error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({
        reports: (data || []) as ManagementReportListItem[],
        total: count || 0,
        limit,
        offset,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reports] List error:', err);
      res.status(500).json({ error: message });
    }
  }
);

// GET /api/pulse/reports/:id
// Get single report with full payload (including contracts JSONB)
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
        .from('pulse_management_reports')
        .select('*')
        .eq('report_id', req.params.id)
        .maybeSingle();

      if (error) {
        console.error('[Reports] Get error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      if (!data) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      res.json({ report: data as ManagementReport });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reports] Get error:', err);
      res.status(500).json({ error: message });
    }
  }
);

// POST /api/pulse/reports/generate
// Manual trigger — returns 202 with report_id immediately
router.post(
  '/generate',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const service = new ManagementReportService();

      // Fire off generation in the background
      const generatePromise = service.generateReport({
        triggeredBy: 'manual',
        userId: req.user.auth_id,
      });

      // Wait just long enough to get the report_id from the placeholder row
      // The service inserts the row first, then does the heavy work
      const result = await generatePromise;

      res.status(202).json({
        message: 'Report generation completed',
        report_id: result.reportId,
        summary: result.summary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reports] Generate error:', err);
      res.status(500).json({ error: message });
    }
  }
);

// DELETE /api/pulse/reports/:id
// Admin only — delete old reports
router.delete(
  '/:id',
  requireRole('admin'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const { error } = await req.supabase
        .from('pulse_management_reports')
        .delete()
        .eq('report_id', req.params.id);

      if (error) {
        console.error('[Reports] Delete error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Reports] Delete error:', err);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
