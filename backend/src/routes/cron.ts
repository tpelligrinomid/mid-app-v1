import { Router, Request, Response } from 'express';
import { ClickUpCronSyncService } from '../services/clickup/cron-sync.js';
import { ProcessLibrarySyncService } from '../services/clickup/process-library-sync.js';
import { QuickBooksCronSyncService } from '../services/quickbooks/cron-sync.js';
import { ManagementReportService } from '../services/reports/management-report.js';
import { ClientStatusReportService } from '../services/reports/client-status-report.js';
import { backfillEmbeddings } from '../services/rag/backfill.js';
import { processScheduledNotes } from '../services/strategy-notes/scheduler.js';
import { recoverStuckDeliverables, diagnoseDeliverables, recoverDeliverable } from '../services/deliverable-generation/recover.js';
import { syncConfig } from '../config/sync-config.js';
import { backfillServiceCategories } from '../services/clickup/service-category.js';

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

// POST /api/cron/generate-management-report
// Triggered by Render Cron Job for weekly management report
//
// Render Cron Job Configuration:
// - Name: management-report-weekly
// - Schedule: 0 12 * * 1 (Monday 12:00 UTC / 7 AM ET)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/generate-management-report?secret=$CRON_SECRET"
router.post('/generate-management-report', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting management report generation...');

  try {
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    const service = new ManagementReportService();
    const result = await service.generateReport({ triggeredBy: 'scheduled' });

    const duration = Date.now() - startTime;
    console.log(`[Cron] Management report completed in ${duration}ms`);

    res.json({
      success: true,
      report_id: result.reportId,
      summary: result.summary,
      duration: `${duration}ms`
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] Management report failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/process-status-reports
// Triggered by Render Cron Job for processing scheduled client status reports
//
// Render Cron Job Configuration:
// - Name: status-report-processor
// - Schedule: 0 * * * * (every hour)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/process-status-reports?secret=$CRON_SECRET"
router.post('/process-status-reports', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting status report processing...');

  try {
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    const service = new ClientStatusReportService();
    const result = await service.processScheduledReports();

    const duration = Date.now() - startTime;
    console.log(`[Cron] Status report processing completed in ${duration}ms`);

    res.json({
      success: true,
      duration: `${duration}ms`,
      stats: {
        processed: result.processed,
        failed: result.failed,
      },
      errors: result.errors.length > 0 ? result.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] Status report processing failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/backfill-embeddings
// Backfill existing notes, meetings, and deliverables into compass_knowledge
//
// Render Cron Job Configuration:
// - Name: backfill-embeddings
// - Schedule: 0 4 * * 0 (Sunday 4 AM UTC — one-time or weekly catch-up)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/backfill-embeddings?secret=$CRON_SECRET"
router.post('/backfill-embeddings', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting embedding backfill...');

  try {
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('[Cron] OPENAI_API_KEY not configured');
      res.status(503).json({
        error: 'OpenAI API not configured',
        details: 'OPENAI_API_KEY environment variable is not set'
      });
      return;
    }

    const batchSize = parseInt(req.query.batch_size as string) || 10;
    const stats = await backfillEmbeddings({ batch_size: batchSize });

    const duration = Date.now() - startTime;
    console.log(`[Cron] Embedding backfill completed in ${duration}ms`);

    res.json({
      success: true,
      duration: `${duration}ms`,
      stats: {
        processed: stats.processed,
        skipped_already_embedded: stats.skipped_already_embedded,
        skipped_no_content: stats.skipped_no_content,
        failed: stats.failed,
      },
      breakdown: stats.breakdown,
      errors: stats.errors.length > 0 ? stats.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] Embedding backfill failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/sync-process-library
// Sync Process Library from ClickUp space into compass_process_library + RAG embeddings
//
// Render Cron Job Configuration:
// - Name: sync-process-library
// - Schedule: 0 6 * * 1 (Monday 6 AM UTC)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/sync-process-library?secret=$CRON_SECRET"
router.post('/sync-process-library', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting Process Library sync...');

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

    const syncService = new ProcessLibrarySyncService();
    const results = await syncService.runSync();

    const duration = Date.now() - startTime;
    console.log(`[Cron] Process Library sync completed in ${duration}ms`);

    res.json({
      success: true,
      duration: `${duration}ms`,
      stats: {
        items_synced: results.items_synced,
        items_deactivated: results.items_deactivated,
        items_embedded: results.items_embedded,
      },
      errors: results.errors.length > 0 ? results.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] Process Library sync failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/generate-strategy-notes
// Triggered by Render Cron Job to generate automated strategy notes
//
// Render Cron Job Configuration:
// - Name: generate-strategy-notes
// - Schedule: 30 * * * * (every hour at :30)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/generate-strategy-notes?secret=$CRON_SECRET"
router.post('/generate-strategy-notes', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  console.log('[Cron] Starting strategy note generation...');

  try {
    if (!process.env.BACKEND_API_KEY) {
      console.error('[Cron] BACKEND_API_KEY not configured');
      res.status(503).json({
        error: 'Database proxy not configured',
        details: 'BACKEND_API_KEY environment variable is not set'
      });
      return;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[Cron] ANTHROPIC_API_KEY not configured');
      res.status(503).json({
        error: 'Claude API not configured',
        details: 'ANTHROPIC_API_KEY environment variable is not set'
      });
      return;
    }

    const result = await processScheduledNotes();

    const duration = Date.now() - startTime;
    console.log(`[Cron] Strategy note generation completed in ${duration}ms`);

    res.json({
      success: true,
      duration: `${duration}ms`,
      stats: {
        generated: result.generated,
        failed: result.failed,
        skipped: result.skipped,
      },
      errors: result.errors.length > 0 ? result.errors : undefined
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';

    console.error(`[Cron] Strategy note generation failed after ${duration}ms:`, error);

    res.status(500).json({
      success: false,
      error: message,
      duration: `${duration}ms`
    });
  }
});

// POST /api/cron/clickup-service-category
// Triggered by Render Cron Job
//
// Classifies parent tasks in Deliverables lists of ACTIVE contracts and writes
// the "Service Category" dropdown custom field back to ClickUp.
//
// THIS WRITES TO CLICKUP — the only cron here that does. There is no undo.
// Tasks that already have a value are never touched.
//
// ALWAYS DRY-RUN FIRST, and scope the first live run to one contract:
//   ?dryRun=1&folderId=<folder>   review proposed categories
//   ?folderId=<folder>            live, single contract
//   ?maxWrites=N                  per-run write cap (default 400)
//
// Runs are bounded on purpose: the first backfill is thousands of tasks and
// ClickUp allows ~100 req/min. Already-classified tasks are skipped, so
// successive runs resume with no cursor state.
//
// Render Cron Job Configuration:
// - Name: clickup-service-category
// - Schedule: 20 7 * * *  and  20 19 * * *  (twice daily, off-minutes so it
//   never overlaps the */15 sync or the 0 9 archived sweep)
// - Command: curl -fsS -X POST "https://your-app.onrender.com/api/cron/clickup-service-category?secret=$CRON_SECRET"
router.post('/clickup-service-category', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  try {
    if (!syncConfig.clickup.apiToken) {
      res.status(503).json({ error: 'ClickUp integration not configured' });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
      return;
    }
    if (!process.env.BACKEND_API_KEY) {
      res.status(503).json({ error: 'Database proxy not configured' });
      return;
    }

    const folderId = (req.query.folderId as string) || undefined;
    const maxWrites = req.query.maxWrites ? Number(req.query.maxWrites) : undefined;
    const limitLists = req.query.limitLists ? Number(req.query.limitLists) : undefined;
    const audit = req.query.audit === '1' || req.query.audit === 'true';
    const folderOffset = req.query.folderOffset ? Number(req.query.folderOffset) : undefined;
    const folderLimit = req.query.folderLimit ? Number(req.query.folderLimit) : undefined;

    console.log(`[Cron] Service category backfill starting (dryRun=${dryRun})`);

    const result = await backfillServiceCategories({
      dryRun, folderId, maxWrites, limitLists, folderOffset, folderLimit, audit,
    });
    const durationMs = Date.now() - startTime;

    console.log(
      `[Cron] Service category backfill ${dryRun ? '(DRY RUN) ' : ''}complete: ` +
      `${result.lists_scanned} lists, ${result.parent_tasks_seen} parent tasks, ` +
      `${result.candidates} candidates, ${result.classified} classified, ` +
      `${result.written} written, ${result.unclassified} unclassified, ` +
      `${result.remaining} remaining ` +
      `| errors=${result.errors.length} lists_skipped=${result.lists_skipped} (${durationMs}ms)`
    );

    if (result.errors.length) {
      console.warn(
        `[Cron] Service category backfill had ${result.errors.length} error(s):`,
        JSON.stringify(result.errors.slice(0, 20))
      );
    }

    res.json({ success: true, ...result, duration_ms: durationMs, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[Cron] Service category backfill failed:', error);
    res.status(500).json({
      success: false,
      dry_run: dryRun,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/cron/clickup-archived-sync
// Triggered by Render Cron Job
//
// ClickUp omits archived tasks from list responses unless asked for explicitly,
// so the incremental and full passes never see a task once it's archived and its
// pulse_tasks row keeps is_archived=false indefinitely. This pass fetches them
// deliberately. It is additive — it does not touch the 15-minute or weekly syncs.
//
// Covers both mechanisms, which are independent and can both apply to one task
// (deliverables commonly carry both): ClickUp's `archived` flag, and a list
// status named "Archived".
//
// ALWAYS DRY-RUN FIRST: ?dryRun=1 reports exactly which rows would change and
// writes nothing.
//
// Render Cron Job Configuration:
// - Name: clickup-archived-sync
// - Schedule: 0 9 * * * (daily 09:00 UTC — after the weekly full sync window)
// - Command: curl -fsS -X POST "https://your-app.onrender.com/api/cron/clickup-archived-sync?secret=$CRON_SECRET"
router.post('/clickup-archived-sync', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  try {
    if (!syncConfig.clickup.apiToken) {
      res.status(503).json({ error: 'ClickUp integration not configured' });
      return;
    }
    if (!process.env.BACKEND_API_KEY) {
      res.status(503).json({ error: 'Database proxy not configured' });
      return;
    }

    console.log(`[Cron] ClickUp archived sync starting (dryRun=${dryRun})`);

    // ?limitLists=N / ?folderId= bound the scan for interactive review; a full
    // run is too slow for an HTTP client to wait on (it's sized for the cron).
    const limitLists = req.query.limitLists ? Number(req.query.limitLists) : undefined;
    const folderId = (req.query.folderId as string) || undefined;

    // Inserts are opt-in only. Default behaviour never creates rows for tasks
    // that aren't already tracked.
    const allowInserts = req.query.allowInserts === '1';

    const syncService = new ClickUpCronSyncService();
    const result = await syncService.syncArchivedTasks({ dryRun, limitLists, folderId, allowInserts });

    const durationMs = Date.now() - startTime;
    // Include the shortfall explicitly. A partially-skipped run previously read
    // identically to a clean one — the only clue was that the counts didn't
    // sum to archived_tasks_found.
    const accounted =
      result.would_change + result.already_correct + result.not_in_db + result.tasks_unevaluated;

    console.log(
      `[Cron] ClickUp archived sync ${dryRun ? '(DRY RUN) ' : ''}complete: ` +
      `${result.archived_tasks_found} archived tasks across ${result.lists_scanned} lists, ` +
      `${result.would_change} would change, ${result.already_correct} already correct, ` +
      `${result.not_in_db} not in DB, ${result.updated} written ` +
      `| errors=${result.errors.length} lists_skipped=${result.lists_skipped} ` +
      `unevaluated=${result.tasks_unevaluated} ` +
      `| accounted=${accounted}/${result.archived_tasks_found}` +
      `${accounted === result.archived_tasks_found ? '' : ' <-- SHORTFALL'} (${durationMs}ms)`
    );

    if (result.errors.length) {
      console.warn(
        `[Cron] ClickUp archived sync had ${result.errors.length} error(s):`,
        JSON.stringify(result.errors.slice(0, 20))
      );
    }

    res.json({ success: true, ...result, duration_ms: durationMs, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[Cron] ClickUp archived sync failed:', error);
    res.status(500).json({
      success: false,
      dry_run: dryRun,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });
  }
});

// POST /api/cron/recover-deliverables
// Triggered by Render Cron Job
//
// Sweeps for deliverables that Master Marketer finished but never delivered —
// the callback POST can be rejected before it reaches us (a Render WAF 403 at
// the edge leaves nothing in our logs), and a restart or network blip during
// delivery strands one the same way. MM keeps the output, so we pull it back.
//
// Render Cron Job Configuration:
// - Name: recover-stuck-deliverables
// - Schedule: */15 * * * * (every 15 minutes)
// - Command: curl -X POST "https://your-app.onrender.com/api/cron/recover-deliverables?secret=$CRON_SECRET"
router.post('/recover-deliverables', verifyCronSecret, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    // ?debug=1 dumps the generation state of every deliverable that has any,
    // with no status filter, so a stranded one that isn't matching is visible.
    // Read-only — recovers nothing.
    if (req.query.debug) {
      const rows = await diagnoseDeliverables();
      res.json({
        success: true,
        debug: true,
        with_generation_metadata: rows.length,
        would_match: rows.filter((r) => r.would_match).length,
        rows,
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // ?deliverableId= recovers one specific deliverable, bypassing the sweep's
    // matching entirely. For unblocking a known-stranded deliverable when the
    // sweep's criteria aren't matching it.
    const targetId = req.query.deliverableId as string | undefined;
    if (targetId) {
      // Optional &runId= bypasses stored metadata, which is not reliably
      // persisted. Trigger.dev retains runs for 14 days, so the run ID from the
      // Trigger dashboard is enough to recover a deliverable on its own.
      const explicitRunId = req.query.runId as string | undefined;
      const result = await recoverDeliverable(targetId, explicitRunId);
      console.log(`[Cron] Targeted recovery of ${targetId}: ${result.outcome}`);
      res.json({
        success: true,
        targeted: true,
        result,
        duration_ms: Date.now() - startTime,
      });
      return;
    }

    // Default 60 min clears the SEO audit's 45-minute maxDuration, so a job
    // that's merely slow is never mistaken for a stranded one. Override with
    // ?stuckAfterMinutes= when testing.
    const stuckAfterMinutes = Number(req.query.stuckAfterMinutes) || 60;

    const { rowsExamined, scanned, results } = await recoverStuckDeliverables({ stuckAfterMinutes });

    const recovered = results.filter(
      (r) => r.outcome === 'recovered' || r.outcome === 'recovered_failed'
    );
    const stillRunning = results.filter((r) => r.outcome === 'still_running');
    const errored = results.filter((r) => r.outcome === 'error');

    const durationMs = Date.now() - startTime;

    if (scanned > 0) {
      console.log(
        `[Cron] Deliverable recovery: examined ${rowsExamined}, ${scanned} stuck, ` +
        `${recovered.length} recovered, ${stillRunning.length} still running, ` +
        `${errored.length} errored (${durationMs}ms)`
      );
    } else if (rowsExamined === 0) {
      // Nothing to reject means nothing was inspected — the lookback filter
      // returned no rows at all, which is worth surfacing rather than reading
      // as a clean sweep.
      console.warn('[Cron] Deliverable recovery examined 0 rows — no deliverables in working status');
    }

    res.json({
      success: true,
      rows_examined: rowsExamined,
      scanned,
      recovered: recovered.length,
      still_running: stillRunning.length,
      errored: errored.length,
      stuck_after_minutes: stuckAfterMinutes,
      results,
      duration_ms: durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Deliverable recovery failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
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
