import { ClickUpClient, fetchWithRetry } from './client.js';
import { syncConfig } from '../../config/sync-config.js';
import { dbProxy } from '../../utils/db-proxy.js';
import { ingestContent } from '../rag/ingestion.js';

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  time_estimate?: number;
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
  errors: Array<{ context: string; error: string }>;
}

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
      errors: [],
    };

    const seenClickUpIds = new Set<string>();

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

      console.log(`[Process Library Sync] Complete: ${results.items_synced} synced, ${results.items_deactivated} deactivated, ${results.items_embedded} embedded, ${results.errors.length} errors`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({ context: 'sync', error: message });
      console.error('[Process Library Sync] Fatal error:', message);
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
        const passes = this.hasMidPointsMenu(task);
        if (passes) {
          const field = task.custom_fields?.find(f => f.id === this.config.customFields.midPointsMenu);
          console.log(`[Process Library Sync] Task ${task.id} "${task.name}" passes filter, MiD Points Menu value: ${JSON.stringify(field?.value)}`);
        }
        return passes;
      });

      // Batch upsert
      if (filteredTasks.length > 0) {
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
