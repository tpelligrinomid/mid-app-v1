import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';
import { ClientStatusReportService, computeNextRunAt } from '../../services/reports/client-status-report.js';
import {
  validateReportConfigInput,
  isValidReportCadence,
} from '../../types/client-reports.js';
import type {
  ClientReportConfig,
  ClientReportConfigInput,
  ClientReportConfigUpdate,
  CompassReportListItem,
} from '../../types/client-reports.js';
import { insert, update, select, del } from '../../utils/edge-functions.js';

const router = Router();

// ============================================================================
// Report Config CRUD
// ============================================================================

/**
 * GET /api/compass/status-reports/configs?contract_id=X
 * List report configs for a contract
 */
router.get(
  '/configs',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;

    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    try {
      const { data, error } = await req.supabase
        .from('compass_report_configs')
        .select('*')
        .eq('contract_id', contract_id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[StatusReports] List configs error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({ configs: data || [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] List configs error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * GET /api/compass/status-reports/configs/:id
 * Get single config
 */
router.get(
  '/configs/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const { data, error } = await req.supabase
        .from('compass_report_configs')
        .select('*')
        .eq('config_id', req.params.id)
        .maybeSingle();

      if (error) {
        console.error('[StatusReports] Get config error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      if (!data) {
        res.status(404).json({ error: 'Config not found' });
        return;
      }

      res.json({ config: data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] Get config error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * POST /api/compass/status-reports/configs
 * Create a new report config (uses service role via edge-functions)
 */
router.post(
  '/configs',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const input: ClientReportConfigInput = req.body;

    // Validate
    const errors = validateReportConfigInput(input);
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
      // Build the config data
      const configData: Record<string, unknown> = {
        contract_id: input.contract_id,
        enabled: input.enabled !== undefined ? input.enabled : true,
        cadence: input.cadence,
        day_of_week: input.day_of_week ?? null,
        day_of_month: input.day_of_month ?? null,
        send_time: input.send_time,
        timezone: input.timezone || 'America/New_York',
        lookback_days: input.lookback_days || 14,
        lookahead_days: input.lookahead_days || 30,
        recipients: input.recipients,
        created_by: req.user.auth_id,
      };

      // Compute initial next_run_at
      const tempConfig = {
        ...configData,
        config_id: '',
        next_run_at: null,
        last_run_at: null,
        created_at: '',
        updated_at: '',
      } as unknown as ClientReportConfig;

      configData.next_run_at = computeNextRunAt(tempConfig);

      // Insert via service role (edge-functions proxy)
      const result = await insert<ClientReportConfig[]>(
        'compass_report_configs',
        configData,
        { select: '*' }
      );

      res.status(201).json({ config: result[0] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] Create config error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * PUT /api/compass/status-reports/configs/:id
 * Update a report config
 */
router.put(
  '/configs/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const configId = req.params.id;
    const updates: ClientReportConfigUpdate = req.body;

    // Validate cadence if provided
    if (updates.cadence && !isValidReportCadence(updates.cadence)) {
      res.status(400).json({ error: 'Invalid cadence. Must be "weekly" or "monthly"' });
      return;
    }

    // Verify config exists
    const { data: existing, error: fetchError } = await req.supabase
      .from('compass_report_configs')
      .select('*')
      .eq('config_id', configId)
      .maybeSingle();

    if (fetchError) {
      console.error('[StatusReports] Fetch config error:', fetchError);
      res.status(500).json({ error: fetchError.message });
      return;
    }

    if (!existing) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }

    try {
      // Build update fields
      const updateFields: Record<string, unknown> = {};
      if (updates.enabled !== undefined) updateFields.enabled = updates.enabled;
      if (updates.cadence !== undefined) updateFields.cadence = updates.cadence;
      if (updates.day_of_week !== undefined) updateFields.day_of_week = updates.day_of_week;
      if (updates.day_of_month !== undefined) updateFields.day_of_month = updates.day_of_month;
      if (updates.send_time !== undefined) updateFields.send_time = updates.send_time;
      if (updates.timezone !== undefined) updateFields.timezone = updates.timezone;
      if (updates.lookback_days !== undefined) updateFields.lookback_days = updates.lookback_days;
      if (updates.lookahead_days !== undefined) updateFields.lookahead_days = updates.lookahead_days;
      if (updates.recipients !== undefined) updateFields.recipients = updates.recipients;

      if (Object.keys(updateFields).length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      // Recompute next_run_at if scheduling fields changed
      const scheduleChanged = updates.cadence !== undefined ||
        updates.day_of_week !== undefined ||
        updates.day_of_month !== undefined ||
        updates.send_time !== undefined ||
        updates.timezone !== undefined;

      if (scheduleChanged) {
        const merged = { ...existing, ...updateFields } as ClientReportConfig;
        updateFields.next_run_at = computeNextRunAt(merged);
      }

      // Update via service role
      const result = await update<ClientReportConfig[]>(
        'compass_report_configs',
        updateFields,
        { config_id: configId },
        { select: '*' }
      );

      res.json({ config: result[0] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] Update config error:', err);
      res.status(500).json({ error: message });
    }
  }
);

/**
 * DELETE /api/compass/status-reports/configs/:id
 * Delete a report config
 */
router.delete(
  '/configs/:id',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    try {
      const { error } = await req.supabase
        .from('compass_report_configs')
        .delete()
        .eq('config_id', req.params.id);

      if (error) {
        console.error('[StatusReports] Delete config error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] Delete config error:', err);
      res.status(500).json({ error: message });
    }
  }
);

// ============================================================================
// Test Send
// ============================================================================

/**
 * POST /api/compass/status-reports/configs/:id/send-test
 * Generate and send a report immediately (test/manual trigger)
 */
router.post(
  '/configs/:id/send-test',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const configId = req.params.id;

    // Verify config exists
    const { data: existing, error: fetchError } = await req.supabase
      .from('compass_report_configs')
      .select('config_id')
      .eq('config_id', configId)
      .maybeSingle();

    if (fetchError) {
      console.error('[StatusReports] Fetch config error:', fetchError);
      res.status(500).json({ error: fetchError.message });
      return;
    }

    if (!existing) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }

    try {
      const service = new ClientStatusReportService();
      const result = await service.generateAndSend(configId);

      res.json({
        message: 'Report generated and sent',
        report_id: result.reportId,
        subject: result.subject,
        recipient_count: result.recipientCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] Send test error:', err);
      res.status(500).json({ error: message });
    }
  }
);

// ============================================================================
// Report History
// ============================================================================

/**
 * GET /api/compass/status-reports/history?contract_id=X
 * List sent reports for a contract from compass_reports
 */
router.get(
  '/history',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.supabase || !req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { contract_id } = req.query;

    if (!contract_id || typeof contract_id !== 'string') {
      res.status(400).json({ error: 'contract_id query parameter is required' });
      return;
    }

    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const { data, error, count } = await req.supabase
        .from('compass_reports')
        .select(
          'report_id, contract_id, report_type, period_start, period_end, subject, recipients, send_status, sent_at, created_at',
          { count: 'exact' }
        )
        .eq('contract_id', contract_id)
        .eq('report_type', 'status_report')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error('[StatusReports] History error:', error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.json({
        reports: (data || []) as CompassReportListItem[],
        total: count || 0,
        limit,
        offset,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[StatusReports] History error:', err);
      res.status(500).json({ error: message });
    }
  }
);

export default router;
