import { Router, Request, Response } from 'express';
import { requireRole } from '../../middleware/auth.js';

const router = Router();

/**
 * GET /api/sync/status
 * Get sync status for all services
 * Returns last sync times, status, and any errors
 */
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.supabase) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Get sync state for all services
    const { data: syncStates, error } = await req.supabase
      .from('pulse_sync_state')
      .select('service, entity_type, status, last_sync_at, last_successful_sync_at, records_processed, error_message')
      .order('service');

    if (error) {
      console.error('Error fetching sync status:', error);
      res.status(500).json({ error: 'Failed to fetch sync status' });
      return;
    }

    // Group by service for easier frontend consumption
    const statusByService: Record<string, {
      status: string;
      last_sync_at: string | null;
      last_successful_sync_at: string | null;
      error_message: string | null;
      entities: Record<string, {
        status: string;
        last_sync_at: string | null;
        records_processed: number | null;
        error_message: string | null;
      }>;
    }> = {};

    // Initialize with default state for known services
    ['clickup', 'quickbooks', 'hubspot'].forEach(service => {
      statusByService[service] = {
        status: 'never_synced',
        last_sync_at: null,
        last_successful_sync_at: null,
        error_message: null,
        entities: {}
      };
    });

    // Populate with actual data
    if (syncStates) {
      for (const state of syncStates) {
        if (!statusByService[state.service]) {
          statusByService[state.service] = {
            status: 'never_synced',
            last_sync_at: null,
            last_successful_sync_at: null,
            error_message: null,
            entities: {}
          };
        }

        // Add entity-level status
        statusByService[state.service].entities[state.entity_type] = {
          status: state.status,
          last_sync_at: state.last_sync_at,
          records_processed: state.records_processed,
          error_message: state.error_message
        };

        // Update service-level status (use most recent sync)
        if (!statusByService[state.service].last_sync_at ||
            (state.last_sync_at && state.last_sync_at > statusByService[state.service].last_sync_at!)) {
          statusByService[state.service].last_sync_at = state.last_sync_at;
          statusByService[state.service].status = state.status;
          statusByService[state.service].error_message = state.error_message;
        }

        if (!statusByService[state.service].last_successful_sync_at ||
            (state.last_successful_sync_at && state.last_successful_sync_at > statusByService[state.service].last_successful_sync_at!)) {
          statusByService[state.service].last_successful_sync_at = state.last_successful_sync_at;
        }
      }
    }

    res.json({ services: statusByService });
  } catch (error) {
    console.error('Error fetching sync status:', error);
    res.status(500).json({ error: 'Failed to fetch sync status' });
  }
});

/**
 * POST /api/sync/clickup
 * Trigger a ClickUp sync (admin/team_member only)
 */
router.post(
  '/clickup',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // TODO: Implement ClickUp sync service
      // const result = await clickUpService.sync();

      res.json({
        success: true,
        message: 'ClickUp sync triggered',
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('ClickUp sync error:', error);
      res.status(500).json({ error: 'Failed to sync with ClickUp' });
    }
  }
);

/**
 * POST /api/sync/quickbooks
 * Trigger a QuickBooks sync (admin/team_member only)
 */
router.post(
  '/quickbooks',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // TODO: Implement QuickBooks sync service
      // const result = await quickBooksService.sync();

      res.json({
        success: true,
        message: 'QuickBooks sync triggered',
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('QuickBooks sync error:', error);
      res.status(500).json({ error: 'Failed to sync with QuickBooks' });
    }
  }
);

/**
 * POST /api/sync/hubspot
 * Trigger a HubSpot sync (admin/team_member only)
 */
router.post(
  '/hubspot',
  requireRole('admin', 'team_member'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // TODO: Implement HubSpot sync service
      // const result = await hubSpotService.sync();

      res.json({
        success: true,
        message: 'HubSpot sync triggered',
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('HubSpot sync error:', error);
      res.status(500).json({ error: 'Failed to sync with HubSpot' });
    }
  }
);

export default router;
