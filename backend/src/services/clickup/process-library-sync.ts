import { v4 as uuidv4 } from 'uuid';
import { ClickUpClient, fetchWithRetry } from './client.js';
import { syncConfig } from '../../config/sync-config.js';
import { dbProxy } from '../../utils/db-proxy.js';
import { ingestContent } from '../rag/ingestion.js';

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  points?: number;
  time_estimate?: number | null;
  parent?: string;
  custom_fields?: Array<{
    id: string;
    name: string;
    type: string;
    value?: unknown;
  }>;
}

interface ProcessSyncResults {
  items_synced: number;
  items_deactivated: number;
  items_embedded: number;
  /** Items whose ClickUp payload carried a non-null time_estimate. */
  time_estimates_present: number;
  /** Items whose estimate had to be recovered via a task-detail call. */
  time_estimates_hydrated: number;
  errors: Array<{ context: string; error: string }>;
}

/**
 * Ceiling on task-detail calls per list when the list response omits time_estimate.
 * ClickUp allows ~100 req/min; this keeps a degraded run bounded instead of stalling
 * the whole sync behind rate-limit backoff.
 */
const HYDRATE_LIMIT_PER_LIST = 100;

/**
 * Phase order mapping.
 * Parses "(N) Name" format; AGE and Analysis have no prefix.
 */
const PHASE_ORDER_MAP: Record<string, number> = {
  age: 0,
  launch: 1,
  research: 2,
  roadmap: 3,
  foundation: 4,
  execution: 5,
  analysis: 6,
};

function parsePhase(folderName: string): { phase: string; phase_order: number } {
  // Match "(N) PhaseName" pattern
  const match = folderName.match(/^\((\d+)\)\s+(.+)$/);
  if (match) {
    const phase = match[2].trim();
    return { phase, phase_order: parseInt(match[1], 10) };
  }
  // No prefix — use known mapping
  const key = folderName.trim().toLowerCase();
  const order = PHASE_ORDER_MAP[key];
  return {
    phase: folderName.trim(),
    phase_order: order !== undefined ? order : 99,
  };
}

export class ProcessLibrarySyncService {
  private client: ClickUpClient;
  private config = syncConfig.processLibrary;

  constructor() {
    const token = syncConfig.clickup.apiToken;
    if (!token) {
      throw new Error('CLICKUP_API_TOKEN environment variable is required');
    }
    this.client = new ClickUpClient(token);
  }

  async runSync(): Promise<ProcessSyncResults> {
    const results: ProcessSyncResults = {
      items_synced: 0,
      items_deactivated: 0,
      items_embedded: 0,
      time_estimates_present: 0,
      time_estimates_hydrated: 0,
      errors: [],
    };

    const seenClickUpIds = new Set<string>();
    const syncId = uuidv4();
    await this.logSyncStart(syncId);

    try {
      // 1. Get all folders in the Process Library space
      console.log(`[Process Library Sync] Fetching folders from space ${this.config.spaceId}...`);
      const folders = await fetchWithRetry(() =>
        this.client.getFolders(this.config.spaceId)
      );
      console.log(`[Process Library Sync] Found ${folders.length} folders`);

      // 2. For each folder, get lists and tasks
      for (const folder of folders) {
        const { phase, phase_order } = parsePhase(folder.name);

        try {
          const lists = await fetchWithRetry(() =>
            this.client.getListsInFolder(folder.id)
          );

          for (const list of lists) {
            try {
              await this.processList(list, folder, phase, phase_order, seenClickUpIds, results);
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              results.errors.push({ context: `list:${list.id}:${list.name}`, error: message });
              console.error(`[Process Library Sync] Error processing list ${list.name}:`, message);
            }
          }
        } catch (error) {
          if (ClickUpClient.isPermissionError(error)) {
            console.warn(`[Process Library Sync] Permission denied for folder ${folder.name}`);
          } else {
            const message = error instanceof Error ? error.message : 'Unknown error';
            results.errors.push({ context: `folder:${folder.id}:${folder.name}`, error: message });
            console.error(`[Process Library Sync] Error processing folder ${folder.name}:`, message);
          }
        }
      }

      // 3. Deactivate items not seen in this sync
      const deactivated = await this.deactivateUnseen(seenClickUpIds);
      results.items_deactivated = deactivated;

      console.log(
        `[Process Library Sync] Complete: ${results.items_synced} synced, ` +
        `${results.items_deactivated} deactivated, ${results.items_embedded} embedded, ` +
        `${results.time_estimates_present}/${results.items_synced} with time estimates ` +
        `(${results.time_estimates_hydrated} hydrated), ${results.errors.length} errors`
      );

      await this.logSyncComplete(syncId, 'success', results);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({ context: 'sync', error: message });
      console.error('[Process Library Sync] Fatal error:', message);
      await this.logSyncComplete(syncId, 'failed', results, message);
    }

    return results;
  }

  private async processList(
    list: { id: string; name: string },
    folder: { id: string; name: string },
    phase: string,
    phase_order: number,
    seenClickUpIds: Set<string>,
    results: ProcessSyncResults
  ): Promise<void> {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const tasks: ClickUpTask[] = await fetchWithRetry(() =>
        this.client.getTasksFromList(list.id, {
          archived: false,
          includeClosed: false,
          subtasks: false,
          page,
        })
      );

      if (tasks.length === 0) {
        hasMore = false;
        continue;
      }

      // Filter to tasks with MiD Points Menu = true and no parent (parent tasks only)
      const filteredTasks = tasks.filter(task => {
        if (task.parent) return false;
        return this.hasMidPointsMenu(task);
      });

      // Batch upsert
      if (filteredTasks.length > 0) {
        await this.hydrateTimeEstimates(filteredTasks, results);

        const records = filteredTasks.map(task =>
          this.transformTask(task, folder, list, phase, phase_order)
        );

        const batchSize = 50;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          const { error } = await dbProxy.upsert('compass_process_library', batch, {
            onConflict: 'clickup_task_id',
          });

          if (error) {
            console.error('[Process Library Sync] Batch upsert error:', error);
            results.errors.push({ context: `upsert:${list.name}`, error: error.message });
          }
        }

        // Track seen IDs
        for (const task of filteredTasks) {
          seenClickUpIds.add(task.id);
        }

        results.items_synced += filteredTasks.length;

        // Embed each item
        for (const task of filteredTasks) {
          try {
            await this.embedProcess(task, phase, list.name);
            results.items_embedded++;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            results.errors.push({ context: `embed:${task.id}`, error: message });
            console.error(`[Process Library Sync] Embed error for ${task.name}:`, message);
          }
        }
      }

      page++;
      if (page > 100) hasMore = false;
    }
  }

  /**
   * Recover time estimates the list endpoint did not return.
   *
   * ClickUp distinguishes two things this sync must not confuse. `time_estimate: null`
   * is a real answer -- the process has no estimate set -- and writing NULL for it is
   * correct. An absent key means the list response simply did not carry the field, and
   * that is the only case worth spending a task-detail call on.
   *
   * Written this way the fallback is self-disabling: when the list payload includes the
   * field (the normal case) it issues no extra requests at all, so a daily sync of ~140
   * processes stays a handful of calls rather than one per row.
   */
  private async hydrateTimeEstimates(
    tasks: ClickUpTask[],
    results: ProcessSyncResults
  ): Promise<void> {
    const missing = tasks.filter(task => task.time_estimate === undefined);

    if (missing.length > HYDRATE_LIMIT_PER_LIST) {
      console.warn(
        `[Process Library Sync] ${missing.length} tasks missing time_estimate, ` +
        `hydrating only the first ${HYDRATE_LIMIT_PER_LIST} this run`
      );
    }

    for (const task of missing.slice(0, HYDRATE_LIMIT_PER_LIST)) {
      try {
        const detail = await fetchWithRetry(
          () => this.client.getTask(task.id)
        ) as { time_estimate?: number | null };

        task.time_estimate = detail?.time_estimate ?? null;
        if (task.time_estimate) results.time_estimates_hydrated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push({ context: `time_estimate:${task.id}`, error: message });
        console.warn(`[Process Library Sync] Could not hydrate estimate for ${task.name}:`, message);
      }
    }

    results.time_estimates_present += tasks.filter(task => task.time_estimate != null).length;
  }

  private hasMidPointsMenu(task: ClickUpTask): boolean {
    if (!task.custom_fields || !Array.isArray(task.custom_fields)) return false;
    const field = task.custom_fields.find(
      f => f.id === this.config.customFields.midPointsMenu
    );
    return field?.value === true || field?.value === 'true';
  }

  private extractExternalDescription(task: ClickUpTask): string | null {
    if (!task.custom_fields || !Array.isArray(task.custom_fields)) return null;
    const field = task.custom_fields.find(
      f => f.id === this.config.customFields.externalDescription
    );
    if (field?.value !== undefined && field.value !== null && String(field.value).trim() !== '') {
      return String(field.value);
    }
    return null;
  }

  private extractPoints(task: ClickUpTask): number | null {
    // Check native ClickUp points field first
    if (task.points !== undefined && task.points !== null) {
      return task.points;
    }
    // Fall back to custom field
    if (!task.custom_fields || !Array.isArray(task.custom_fields)) return null;
    const field = task.custom_fields.find(
      f => f.id === this.config.customFields.points
    );
    if (field?.value !== undefined && field.value !== null) {
      const parsed = parseFloat(String(field.value));
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  }

  private transformTask(
    task: ClickUpTask,
    folder: { id: string; name: string },
    list: { id: string; name: string },
    phase: string,
    phase_order: number
  ): Record<string, unknown> {
    return {
      clickup_task_id: task.id,
      name: task.name,
      description: this.extractExternalDescription(task),
      points: this.extractPoints(task),
      time_estimate_ms: task.time_estimate || null,
      phase,
      phase_order,
      category: list.name,
      clickup_folder_id: folder.id,
      clickup_list_id: list.id,
      is_active: true,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private async embedProcess(
    task: ClickUpTask,
    phase: string,
    category: string
  ): Promise<void> {
    const description = this.extractExternalDescription(task);
    const points = this.extractPoints(task);

    const parts = [task.name];
    if (phase) parts.push(`Phase: ${phase}`);
    if (category) parts.push(`Category: ${category}`);
    if (points !== null) parts.push(`Points: ${points}`);
    if (description) parts.push(description);

    const content = parts.join('\n');

    // We need the process_id from the DB for source_id.
    // Look it up by clickup_task_id.
    const { data, error } = await dbProxy.select<Array<{ process_id: string }>>(
      'compass_process_library',
      {
        columns: 'process_id',
        filters: { clickup_task_id: task.id },
        single: true,
      }
    );

    if (error || !data || data.length === 0) {
      console.warn(`[Process Library Sync] Could not find process_id for task ${task.id}, skipping embed`);
      return;
    }

    const processId = data[0].process_id;

    await ingestContent({
      contract_id: null,
      source_type: 'process',
      source_id: processId,
      title: task.name,
      content,
    });
  }

  /**
   * Register the run in pulse_sync_state / pulse_sync_logs.
   *
   * The tasks and invoice syncs have always done this; the process library never did,
   * which is why it could quietly stop running for six months with nothing to show a
   * stale last_sync_at. Entity type mirrors the folder it syncs so the existing
   * /api/pulse/sync views pick it up without change.
   */
  private async logSyncStart(syncId: string): Promise<void> {
    await dbProxy.insert('pulse_sync_logs', {
      id: syncId,
      service: 'clickup',
      entity_type: 'process_library',
      sync_mode: 'full',
      status: 'started',
      started_at: new Date().toISOString(),
    });

    await dbProxy.upsert('pulse_sync_state', {
      service: 'clickup',
      entity_type: 'process_library',
      sync_mode: 'full',
      status: 'running',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'service,entity_type' });
  }

  private async logSyncComplete(
    syncId: string,
    status: 'success' | 'failed',
    results: ProcessSyncResults,
    errorMessage?: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await dbProxy.update('pulse_sync_logs', {
      status,
      records_processed: results.items_synced,
      error_message: errorMessage || null,
      completed_at: now,
    }, { id: syncId });

    const stateUpdate: Record<string, unknown> = {
      service: 'clickup',
      entity_type: 'process_library',
      sync_mode: 'full',
      status: status === 'success' ? 'completed' : 'failed',
      last_sync_at: now,
      records_processed: results.items_synced,
      error_message: errorMessage || null,
      updated_at: now,
    };

    if (status === 'success') {
      stateUpdate.last_successful_sync_at = now;
      stateUpdate.last_full_sync_at = now;
    }

    await dbProxy.upsert('pulse_sync_state', stateUpdate, { onConflict: 'service,entity_type' });
  }

  /**
   * Deactivate process library items not seen during this sync.
   */
  private async deactivateUnseen(seenIds: Set<string>): Promise<number> {
    if (seenIds.size === 0) return 0;

    // Fetch all active items
    const { data, error } = await dbProxy.select<Array<{ clickup_task_id: string }>>(
      'compass_process_library',
      {
        columns: 'clickup_task_id',
        filters: { is_active: true },
      }
    );

    if (error || !data) return 0;

    const toDeactivate = data.filter(item => !seenIds.has(item.clickup_task_id));
    let deactivated = 0;

    for (const item of toDeactivate) {
      const { error: updateErr } = await dbProxy.update(
        'compass_process_library',
        { is_active: false, updated_at: new Date().toISOString() },
        { clickup_task_id: item.clickup_task_id }
      );
      if (!updateErr) deactivated++;
    }

    return deactivated;
  }
}

export default ProcessLibrarySyncService;
