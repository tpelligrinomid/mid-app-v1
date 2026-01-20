import { Router, Request, Response } from 'express';
import { ClickUpSyncService } from '../services/clickup/sync.js';
import { syncConfig } from '../config/sync-config.js';
import { createUserClient } from '../utils/supabase.js';

const router = Router();

/**
 * Cron Secret for authenticating cron job requests
 * Set CRON_SECRET environment variable on Render
 */
const CRON_SECRET = process.env.CRON_SECRET;

/**
 * System user token for cron jobs
 * This should be a valid JWT for an admin user in your system
 * Set SYSTEM_USER_TOKEN environment variable on Render
 */
const SYSTEM_USER_TOKEN = process.env.SYSTEM_USER_TOKEN;

/**
 * Middleware to verify cron request authenticity
 */
function verifyCronSecret(req: Request, res: Response, next: () => void) {
  // If no secret is configured, allow all (for development)
  if (!CRON_SECRET) {
    console.warn('[Cron] Warning: CRON_SECRET not configured, allowing unauthenticated cron requests');
    next();
    return;
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    console.error('[Cron] Unauthorized cron request - invalid or missing secret');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * Create a Supabase client for cron jobs using system user token
 * This uses the same auth pattern as the rest of the app (no service role key needed)
 */
function createCronClient() {
  if (!SYSTEM_USER_TOKEN) {
    throw new Error('SYSTEM_USER_TOKEN is required for cron jobs. Create an admin user and set their JWT as this env var.');
  }

  return createUserClient(SYSTEM_USER_TOKEN);
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

    // Parse mode from query string or body
    const mode = (req.query.mode as string) || (req.body?.mode as string) || 'incremental';
    const validModes = ['incremental', 'full'];
    if (!validModes.includes(mode)) {
      res.status(400).json({ error: 'Invalid mode. Must be "incremental" or "full"' });
      return;
    }

    // Create Supabase client with service role
    const supabase = createCronClient();

    // Run sync
    const syncService = new ClickUpSyncService(supabase);
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

/**
 * POST /api/cron/clickup-full-sync
 * Triggered weekly for a full sync
 *
 * Render Cron Job Configuration:
 * - Name: clickup-full-sync
 * - Schedule: 0 20 * * 0 (Sunday 8 PM UTC)
 * - Command: curl -X POST https://your-app.onrender.com/api/cron/clickup-full-sync -H "Authorization: Bearer $CRON_SECRET"
 */
router.post('/clickup-full-sync', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  // Just forward to the main endpoint with mode=full
  req.body = { ...req.body, mode: 'full' };
  req.query = { ...req.query, mode: 'full' };

  // Call the main sync endpoint handler
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

    const supabase = createCronClient();
    const syncService = new ClickUpSyncService(supabase);
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
      hubspot: {
        configured: !!syncConfig.hubspot.apiKey
      }
    }
  });
});

export default router;
