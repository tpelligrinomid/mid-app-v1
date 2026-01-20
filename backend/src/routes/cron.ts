import { Router, Request, Response } from 'express';
import { ClickUpCronSyncService } from '../services/clickup/cron-sync.js';
import { QuickBooksCronSyncService } from '../services/quickbooks/cron-sync.js';
import { syncConfig } from '../config/sync-config.js';

const router = Router();

/**
 * Cron Secret for authenticating cron job requests
 * Set CRON_SECRET environment variable on Render
 */
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * Middleware to verify cron request authenticity
 * Accepts secret via Authorization header OR query parameter (for Render cron compatibility)
 */
function verifyCronSecret(req: Request, res: Response, next: () => void) {
  // If no secret is configured, allow all (for development)
  if (!CRON_SECRET) {
    console.warn('[Cron] Warning: CRON_SECRET not configured, allowing unauthenticated cron requests');
    next();
    return;
  }

  // Check Authorization header first, then fall back to query parameter
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret as string;

  // Extract secret from header (Bearer token) or use query param directly
  const providedSecret = authHeader?.replace('Bearer ', '') || querySecret;

  if (!providedSecret || providedSecret !== CRON_SECRET) {
    console.error('[Cron] Unauthorized cron request - invalid or missing secret');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  console.log('[Cron] Auth verified via', authHeader ? 'header' : 'query param');
  next();
}

// POST /api/cron/clickup-sync
// Triggered by Render Cron Job
//
// Render Cron Job Configuration:
// - Name: clickup-incremental-sync
// - Schedule: */15 * * * 1-5 (every 15 min on weekdays)
// - Command: curl -X POST https://your-app.onrender.com/api/cron/clickup-sync -H "Authorization: Bearer $CRON_SECRET"
//
// Alternative schedules:
// - Weekend sync: 0 3 * * 0,6 (once daily at 3 AM on weekends)
// - Full sync: 0 20 * * 0 (Sunday 8 PM UTC)
router.post('/clickup-sync', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting ClickUp sync...');

  try {
    // Check if ClickUp API token is configured
    if (!syncConfig.clickup.apiToken) {
      console.error('[Cron] ClickUp API token not configured');
      res.status(503).json({
        error: 'ClickUp integration not configured',
        details: 'CLICKUP_API_TOKEN environment variable is not set'
      });
      return;
    }

    // Check if BACKEND_API_KEY is configured (needed for db-proxy)
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    // Parse mode from query string or body
    const mode = (req.query.mode as string) || (req.body?.mode as string) || 'incremental';
    const validModes = ['incremental', 'full'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: 'Invalid mode. Must be "incremental" or "full"' });
      return;
    }

    // Run sync using the cron-specific service (uses backend-proxy Edge Function)
    const syncService = new ClickUpCronSyncService();
    const results = await syncService.runSync({ mode: mode as 'incremental' | 'full' });

    const duration = Date.now() - startTime;
    console.log(`[Cron] ClickUp sync completed in ${duration}ms`);
    console.log(`[Cron] Results: ${results.tasksProcessed} tasks, ${results.foldersProcessed} folders, ${results.usersProcessed} users`);

    res.json({
      success: true,
      mode,
      syncId: results.syncId,
      status: results.status,
      duration: `${duration}ms`,
      stats: {
        foldersProcessed: results.foldersProcessed,
        foldersSkipped: results.foldersSkipped,
        foldersFailed: results.foldersFailed,
        tasksProcessed: results.tasksProcessed,
        timeEntriesProcessed: results.timeEntriesProcessed,
        usersProcessed: results.usersProcessed,
        invoiceTasksProcessed: results.invoiceTasksProcessed
      },
      errors: results.errors.length > 0 ? results.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] ClickUp sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/clickup-full-sync
// Triggered weekly for a full sync
//
// Render Cron Job Configuration:
// - Name: clickup-full-sync
// - Schedule: 0 20 * * 0 (Sunday 8 PM UTC)
// - Command: curl -X POST https://your-app.onrender.com/api/cron/clickup-full-sync -H "Authorization: Bearer $CRON_SECRET"
router.post('/clickup-full-sync', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting ClickUp FULL sync...');

  try {
    if (!syncConfig.clickup.apiToken) {
      console.error('[Cron] ClickUp API token not configured');
      res.status(503).json({
        error: 'ClickUp integration not configured',
        details: 'CLICKUP_API_TOKEN environment variable is not set'
      });
      return;
    }

    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    const syncService = new ClickUpCronSyncService();
    const results = await syncService.runSync({ mode: 'full' });

    const duration = Date.now() - startTime;
    console.log(`[Cron] ClickUp FULL sync completed in ${duration}ms`);

    res.json({
      success: true,
      mode: 'full',
      syncId: results.syncId,
      status: results.status,
      duration: `${duration}ms`,
      stats: {
        foldersProcessed: results.foldersProcessed,
        foldersSkipped: results.foldersSkipped,
        foldersFailed: results.foldersFailed,
        tasksProcessed: results.tasksProcessed,
        timeEntriesProcessed: results.timeEntriesProcessed,
        usersProcessed: results.usersProcessed,
        invoiceTasksProcessed: results.invoiceTasksProcessed
      },
      errors: results.errors.length > 0 ? results.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] ClickUp FULL sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/quickbooks-sync
// Triggered by Render Cron Job for incremental QuickBooks sync
//
// Render Cron Job Configuration:
// - Name: quickbooks-incremental-sync
// - Schedule: */15 * * * 1-5 (every 15 min on weekdays)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/quickbooks-sync?secret=$CRON_SECRET"
router.post('/quickbooks-sync', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting QuickBooks incremental sync...');

  try {
    // Check if BACKEND_API_KEY is configured (needed for db-proxy)
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    // Parse mode from query string or body (default to incremental)
    const mode = (req.query.mode as string) || (req.body?.mode as string) || 'incremental';
    const validModes = ['incremental', 'full'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: 'Invalid mode. Must be "incremental" or "full"' });
      return;
    }

    // Run sync using the QuickBooks cron-specific service
    const syncService = new QuickBooksCronSyncService();
    const results = await syncService.runSync({ mode: mode as 'incremental' | 'full' });

    const duration = Date.now() - startTime;
    console.log(`[Cron] QuickBooks sync completed in ${duration}ms`);
    console.log(`[Cron] Results: ${results.invoicesProcessed} invoices, ${results.creditMemosProcessed} credit memos, ${results.paymentsProcessed} payments`);

    res.json({
      success: true,
      mode,
      syncId: results.syncId,
      status: results.status,
      duration: `${duration}ms`,
      stats: {
        contractsProcessed: results.contractsProcessed,
        contractsSkipped: results.contractsSkipped,
        invoicesProcessed: results.invoicesProcessed,
        creditMemosProcessed: results.creditMemosProcessed,
        paymentsProcessed: results.paymentsProcessed,
        realmsProcessed: results.realmsProcessed
      },
      errors: results.errors.length > 0 ? results.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] QuickBooks sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/quickbooks-full-sync
// Triggered weekly for a full QuickBooks sync
//
// Render Cron Job Configuration:
// - Name: quickbooks-full-sync
// - Schedule: 0 22 * * 0 (Sunday 10 PM UTC - after ClickUp full sync)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/quickbooks-full-sync?secret=$CRON_SECRET"
router.post('/quickbooks-full-sync', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting QuickBooks FULL sync...');

  try {
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    const syncService = new QuickBooksCronSyncService();
    const results = await syncService.runSync({ mode: 'full' });

    const duration = Date.now() - startTime;
    console.log(`[Cron] QuickBooks FULL sync completed in ${duration}ms`);

    res.json({
      success: true,
      mode: 'full',
      syncId: results.syncId,
      status: results.status,
      duration: `${duration}ms`,
      stats: {
        contractsProcessed: results.contractsProcessed,
        contractsSkipped: results.contractsSkipped,
        invoicesProcessed: results.invoicesProcessed,
        creditMemosProcessed: results.creditMemosProcessed,
        paymentsProcessed: results.paymentsProcessed,
        realmsProcessed: results.realmsProcessed
      },
      errors: results.errors.length > 0 ? results.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] QuickBooks FULL sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

/**
 * GET /api/cron/health
 * Health check endpoint for cron monitoring
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      clickup: {
        configured: !!syncConfig.clickup.apiToken,
        teamId: syncConfig.clickup.teamId
      },
      quickbooks: {
        configured: true, // QuickBooks uses OAuth tokens from database, not env vars
        note: 'OAuth tokens are fetched per-realm from database'
      },
      backendProxy: {
        configured: !!process.env.BACKEND_API_KEY
      },
      hubspot: {
        configured: !!syncConfig.hubspot.apiKey
      }
    }
  });
});

export default router;
