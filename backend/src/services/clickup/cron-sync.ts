import { v4 as uuidv4 } from 'uuid';
import { ClickUpClient, fetchWithRetry } from './client.js';
import { syncConfig, detectListType, mapStatus, shouldSkipList, shouldSkipFolder } from '../../config/sync-config.js';
import { dbProxy } from '../../utils/db-proxy.js';

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  status?: { status: string };
  priority?: { priority: string; orderindex: number };
  due_date?: string;
  start_date?: string;
  date_created?: string;
  date_updated?: string;
  date_closed?: string;
  date_done?: string;
  time_estimate?: number;
  time_spent?: number;
  archived?: boolean;
  points?: number;
  assignees?: Array<{ id: number; username: string; email: string }>;
  custom_fields?: Array<{
    id: string;
    name: string;
    type: string;
    value?: unknown;
  }>;
  tags?: Array<{ name: string }>;
  parent?: string;
  space?: { id: string };
  list?: { id: string; name: string };
  folder?: { id: string; name: string };
  list_id?: string;
  list_name?: string;
  list_type?: string;
  folder_id?: string;
}

interface ClickUpUser {
  id: number;
  username: string;
  email: string;
  profilePicture?: string;
}

interface ClickUpTimeEntry {
  id: string;
  task?: { id: string };
  user?: { id: number };
  duration: string;
  start: string;
  end?: string;
  description?: string;
  billable?: boolean;
  tags?: Array<{ name: string }>;
}

interface SyncResults {
  syncId: string;
  mode: 'incremental' | 'full';
  status: 'started' | 'running' | 'completed' | 'failed';
  foldersProcessed: number;
  foldersSkipped: number;
  foldersFailed: number;
  tasksProcessed: number;
  timeEntriesProcessed: number;
  usersProcessed: number;
  invoiceTasksProcessed: number;
  errors: Array<{ context: string; error: string }>;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
}

interface FolderToSync {
  contract_id: string | null;
  clickup_folder_id: string;
  contract_name?: string;
}

/**
 * ClickUp Cron Sync Service
 * Uses the backend-proxy Edge Function for database operations (no service role key needed)
 */
export class ClickUpCronSyncService {
  private client: ClickUpClient;

  constructor() {
    const token = syncConfig.clickup.apiToken;
    if (!token) {
      throw new Error('CLICKUP_API_TOKEN environment variable is required');
    }
    this.client = new ClickUpClient(token);
  }

  /**
   * Run the full sync process
   */
  async runSync(options: {
    mode?: 'incremental' | 'full';
    syncTasks?: boolean;
    syncTimeEntries?: boolean;
    syncUsers?: boolean;
    syncInvoiceTasks?: boolean;
  } = {}): Promise<SyncResults> {
    const {
      mode = 'incremental',
      syncTasks = true,
      syncTimeEntries = true,
      syncUsers = true,
      syncInvoiceTasks = true
    } = options;

    const syncId = uuidv4();
    const startedAt = new Date();

    const results: SyncResults = {
      syncId,
      mode,
      status: 'running',
      foldersProcessed: 0,
      foldersSkipped: 0,
      foldersFailed: 0,
      tasksProcessed: 0,
      timeEntriesProcessed: 0,
      usersProcessed: 0,
      invoiceTasksProcessed: 0,
      errors: [],
      startedAt
    };

    try {
      // Check if a sync is already running
      const existingSync = await this.checkForRunningSync();
      if (existingSync.isRunning) {
        console.log(`[ClickUp Cron Sync] Skipping - sync already in progress (started ${existingSync.startedAt})`);
        results.status = 'completed';
        results.errors.push({
          context: 'startup',
          error: `Sync skipped - another sync already in progress since ${existingSync.startedAt}`
        });
        return results;
      }

      await this.logSyncStart(syncId, mode);

      // 1. Sync users first
      if (syncUsers) {
        console.log('[ClickUp Cron Sync] Syncing users...');
        results.usersProcessed = await this.syncUsers();
        console.log(`[ClickUp Cron Sync] Synced ${results.usersProcessed} users`);
      }

      // 2. Sync tasks from contract folders
      if (syncTasks) {
        console.log('[ClickUp Cron Sync] Getting folders to sync...');
        const folders = await this.getFoldersToSync();
        console.log(`[ClickUp Cron Sync] Found ${folders.length} folders to sync`);

        // For incremental mode, only fetch tasks updated in the last 30 minutes
        // (buffer of 2x the 15-min cron interval to avoid missing updates)
        let dateUpdatedGt: number | undefined;
        if (mode === 'incremental') {
          const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
          dateUpdatedGt = thirtyMinutesAgo;
          console.log(`[ClickUp Cron Sync] Incremental mode: only fetching tasks updated since ${new Date(thirtyMinutesAgo).toISOString()}`);
        }

        for (const folder of folders) {
          try {
            const tasks = await this.fetchTasksForFolder(folder.clickup_folder_id, dateUpdatedGt);

            // Skip logging for folders with no updated tasks in incremental mode
            if (tasks.length === 0 && mode === 'incremental') {
              continue;
            }

            console.log(`[ClickUp Cron Sync] Processing ${tasks.length} tasks from folder ${folder.clickup_folder_id}`);

            // Batch upsert tasks (50 at a time to avoid overwhelming Edge Function)
            const upsertBatchSize = 50;
            for (let i = 0; i < tasks.length; i += upsertBatchSize) {
              const batch = tasks.slice(i, i + upsertBatchSize);

              // Transform all tasks in this batch
              const transformedBatch = batch.map(task =>
                this.transformTask(task, folder.contract_id, folder.clickup_folder_id)
              );

              // Upsert the entire batch in one request
              const { error } = await dbProxy.upsert('pulse_tasks', transformedBatch, {
                onConflict: 'clickup_task_id'
              });

              if (error) {
                console.error(`[ClickUp Cron Sync] Batch upsert error:`, error);
                // Continue with next batch rather than failing entire folder
              }

              // Small delay between batches to avoid overwhelming the Edge Function
              if (i + upsertBatchSize < tasks.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }

            results.tasksProcessed += tasks.length;
            results.foldersProcessed++;
          } catch (error) {
            if (ClickUpClient.isPermissionError(error)) {
              results.foldersSkipped++;
              console.warn(`[ClickUp Cron Sync] Permission denied for folder ${folder.clickup_folder_id}`);
            } else {
              results.foldersFailed++;
              const message = error instanceof Error ? error.message : 'Unknown error';
              results.errors.push({ context: `folder:${folder.clickup_folder_id}`, error: message });
              console.error(`[ClickUp Cron Sync] Failed to sync folder ${folder.clickup_folder_id}:`, message);
            }
          }
        }

        // Only mark deleted tasks in full sync mode (incremental doesn't see all tasks)
        if (mode === 'full') {
          await this.markDeletedTasks();
        }

        // Resolve parent/subtask relationships
        console.log('[ClickUp Cron Sync] Resolving parent task relationships...');
        const resolvedCount = await this.resolveParentRelationships();
        console.log(`[ClickUp Cron Sync] Resolved ${resolvedCount} parent relationships`);
      }

      // 3. Sync invoice tasks
      if (syncInvoiceTasks && syncConfig.clickup.specialLists.invoices) {
        console.log('[ClickUp Cron Sync] Syncing invoice tasks...');
        try {
          results.invoiceTasksProcessed = await this.syncInvoiceTasks();
          console.log(`[ClickUp Cron Sync] Synced ${results.invoiceTasksProcessed} invoice tasks`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({ context: 'invoice_tasks', error: message });
          console.error('[ClickUp Cron Sync] Failed to sync invoice tasks:', message);
        }
      }

      // 4. Sync time entries
      if (syncTimeEntries) {
        const lookback = mode === 'full'
          ? syncConfig.clickup.timeEntryLookbackDays.full
          : syncConfig.clickup.timeEntryLookbackDays.incremental;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - lookback);

        console.log(`[ClickUp Cron Sync] Syncing time entries from ${startDate.toISOString()}...`);
        try {
          results.timeEntriesProcessed = await this.syncTimeEntries(startDate, new Date());
          console.log(`[ClickUp Cron Sync] Synced ${results.timeEntriesProcessed} time entries`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({ context: 'time_entries', error: message });
          console.error('[ClickUp Cron Sync] Failed to sync time entries:', message);
        }
      }

      results.status = 'completed';
      results.completedAt = new Date();
      results.durationMs = results.completedAt.getTime() - startedAt.getTime();

      await this.logSyncComplete(syncId, 'success', results);

      // Refresh materialized views for contract points
      console.log('[ClickUp Cron Sync] Refreshing contract views...');
      try {
        await this.refreshContractViews();
        console.log('[ClickUp Cron Sync] Contract views refreshed');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[ClickUp Cron Sync] Failed to refresh contract views:', message);
        // Don't fail the sync for this - views can be refreshed manually
      }

      console.log(`[ClickUp Cron Sync] Completed in ${results.durationMs}ms`);

    } catch (error) {
      results.status = 'failed';
      results.completedAt = new Date();
      results.durationMs = results.completedAt.getTime() - startedAt.getTime();

      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({ context: 'sync', error: message });

      await this.logSyncComplete(syncId, 'failed', results, message);

      console.error('[ClickUp Cron Sync] Fatal error:', message);
    }

    return results;
  }

  /**
   * Check if a sync is already running
   * Returns true if running and started less than 1 hour ago (to handle crashed syncs)
   */
  private async checkForRunningSync(): Promise<{ isRunning: boolean; startedAt?: string }> {
    const { data, error } = await dbProxy.select<Array<{ status: string; updated_at: string }>>('pulse_sync_state', {
      columns: 'status, updated_at',
      filters: { service: 'clickup', entity_type: 'tasks' },
      single: true
    });

    if (error || !data || data.length === 0) {
      return { isRunning: false };
    }

    const state = data[0];
    if (state.status !== 'running') {
      return { isRunning: false };
    }

    // Check if the sync has been running for more than 1 hour (likely crashed)
    const updatedAt = new Date(state.updated_at);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    if (updatedAt < oneHourAgo) {
      console.log('[ClickUp Cron Sync] Previous sync appears stale (>1 hour), allowing new sync');
      return { isRunning: false };
    }

    return { isRunning: true, startedAt: state.updated_at };
  }

  /**
   * Get folders to sync from active contracts
   */
  private async getFoldersToSync(): Promise<FolderToSync[]> {
    const { data, error } = await dbProxy.select<FolderToSync[]>('contracts', {
      columns: 'contract_id, clickup_folder_id, contract_name',
      filters: { contract_status: 'active' }
    });

    if (error) {
      console.error('[ClickUp Cron Sync] Error fetching contract folders:', error);
      throw new Error(error.message);
    }

    // Filter out nulls and blacklisted
    const validFolders = (data || []).filter(folder => {
      if (!folder.clickup_folder_id) return false;
      if (syncConfig.clickup.blacklistedLists.byId.includes(folder.clickup_folder_id)) {
        return false;
      }
      if (folder.contract_name && shouldSkipFolder(folder.contract_name)) {
        return false;
      }
      return true;
    });

    return validFolders;
  }

  /**
   * Fetch tasks from a folder
   * @param folderId - The folder ID to fetch tasks from
   * @param dateUpdatedGt - Only fetch tasks updated after this timestamp (for incremental sync)
   */
  private async fetchTasksForFolder(folderId: string, dateUpdatedGt?: number): Promise<ClickUpTask[]> {
    const lists = await fetchWithRetry(() => this.client.getListsInFolder(folderId));
    const allTasks: ClickUpTask[] = [];

    for (const list of lists) {
      if (syncConfig.clickup.blacklistedLists.byId.includes(list.id)) {
        continue;
      }
      if (shouldSkipList(list.name)) {
        continue;
      }

      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const tasks = await fetchWithRetry(() =>
          this.client.getTasksFromList(list.id, {
            archived: false,
            includeClosed: true,
            subtasks: true,
            page,
            dateUpdatedGt
          })
        );

        if (tasks.length === 0) {
          hasMore = false;
        } else {
          const tasksWithMeta = tasks.map((task: ClickUpTask) => ({
            ...task,
            list_id: list.id,
            list_name: list.name,
            list_type: detectListType(list.name),
            folder_id: folderId
          }));

          allTasks.push(...tasksWithMeta);
          page++;

          if (page > 100) {
            hasMore = false;
          }
        }
      }
    }

    return allTasks;
  }

  /**
   * Transform a ClickUp task to database format (without storing)
   */
  private transformTask(
    clickupTask: ClickUpTask,
    contractId: string | null,
    folderId: string
  ): Record<string, unknown> {
    return {
      clickup_task_id: clickupTask.id,
      clickup_parent_id: clickupTask.parent || null,
      contract_id: contractId,
      clickup_folder_id: folderId,
      clickup_list_id: clickupTask.list_id || clickupTask.list?.id,
      clickup_space_id: clickupTask.space?.id,
      name: clickupTask.name,
      description: clickupTask.description || null,
      status: mapStatus(clickupTask.status?.status, clickupTask.list_type || 'ToDos'),
      status_raw: clickupTask.status?.status || null,
      list_type: clickupTask.list_type || detectListType(clickupTask.list_name || ''),
      points: clickupTask.points ?? this.extractPointsFromCustomFields(clickupTask.custom_fields),
      priority: clickupTask.priority?.priority || null,
      priority_order: clickupTask.priority?.orderindex ?? null,
      due_date: this.convertClickUpTimestamp(clickupTask.due_date),
      start_date: this.convertClickUpTimestamp(clickupTask.start_date),
      date_created: this.convertClickUpTimestamp(clickupTask.date_created),
      date_updated: this.convertClickUpTimestamp(clickupTask.date_updated),
      date_done: this.convertClickUpTimestamp(clickupTask.date_done || clickupTask.date_closed),
      time_estimate: clickupTask.time_estimate || null,
      time_spent: clickupTask.time_spent || null,
      is_internal_only: this.checkInternalOnly(clickupTask),
      is_growth_task: this.checkGrowthTask(clickupTask),
      is_archived: clickupTask.archived || false,
      assignees: JSON.stringify(clickupTask.assignees || []),
      custom_fields: JSON.stringify(clickupTask.custom_fields || []),
      tags: JSON.stringify(clickupTask.tags || []),
      raw_data: JSON.stringify(clickupTask),
      last_seen_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  private extractPointsFromCustomFields(customFields?: Array<{ id: string; name: string; value?: unknown }>): number | null {
    if (!customFields || !Array.isArray(customFields)) return null;

    // Only check the specific custom field ID if configured
    // Do NOT fuzzy match on field names - this caused incorrect values from fields like "Progress Score"
    const pointsFieldId = syncConfig.clickup.customFields.points;
    if (!pointsFieldId) return null;

    const pointsField = customFields.find(f => f.id === pointsFieldId);
    if (pointsField?.value !== undefined && pointsField.value !== null) {
      const parsed = parseFloat(String(pointsField.value));
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  }

  private checkInternalOnly(task: ClickUpTask): boolean {
    const internalField = task.custom_fields?.find(
      f => f.id === syncConfig.clickup.customFields.internalOnly
    );
    if (internalField?.value === true || internalField?.value === 'true') {
      return true;
    }

    if (task.tags?.some(t => t.name?.toLowerCase().includes('internal'))) {
      return true;
    }

    return false;
  }

  private checkGrowthTask(task: ClickUpTask): boolean {
    const growthField = task.custom_fields?.find(
      f => f.id === syncConfig.clickup.customFields.growthTask
    );
    return growthField?.value === true || growthField?.value === 'true';
  }

  private convertClickUpTimestamp(timestamp?: string | number): string | null {
    if (!timestamp) return null;
    try {
      const ms = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
      if (isNaN(ms)) return null;
      return new Date(ms).toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Sync ClickUp users
   */
  async syncUsers(): Promise<number> {
    const teamId = syncConfig.clickup.teamId;
    const teams = await fetchWithRetry(() => this.client.getTeams());

    const allUsers = new Map<string, Record<string, unknown>>();

    for (const team of teams) {
      if (team.id.toString() !== teamId) continue;

      const members = team.members || [];
      for (const member of members) {
        const user: ClickUpUser = member.user;
        const userId = user.id.toString();

        if (!allUsers.has(userId)) {
          allUsers.set(userId, {
            id: userId,
            username: user.username || null,
            email: user.email || null,
            full_name: user.username || this.extractNameFromEmail(user.email),
            profile_picture: user.profilePicture || null,
            initials: this.generateInitials(user.username || user.email || ''),
            user_type: member.role?.name || 'member',
            is_assignable: ['member', 'owner', 'admin'].includes(member.role?.name?.toLowerCase() || ''),
            raw_data: JSON.stringify(user),
            last_synced_at: new Date().toISOString()
          });
        }
      }
    }

    for (const user of allUsers.values()) {
      const { error } = await dbProxy.upsert('pulse_clickup_users', user, {
        onConflict: 'id'
      });

      if (error) {
        console.error(`[ClickUp Cron Sync] Error storing user ${user.id}:`, error);
      }
    }

    return allUsers.size;
  }

  private extractNameFromEmail(email?: string): string | null {
    if (!email) return null;
    const localPart = email.split('@')[0];
    return localPart
      .replace(/[._-]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private generateInitials(name: string): string {
    if (!name) return '??';
    const parts = name.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  /**
   * Sync time entries
   */
  async syncTimeEntries(startDate: Date, endDate: Date): Promise<number> {
    const teamId = syncConfig.clickup.teamId;

    const entries = await fetchWithRetry(() =>
      this.client.getTeamTimeEntries(teamId, startDate, endDate)
    );

    for (const entry of entries as ClickUpTimeEntry[]) {
      await this.storeTimeEntry(entry);
    }

    return entries.length;
  }

  private async storeTimeEntry(entry: ClickUpTimeEntry): Promise<void> {
    let taskId: string | null = null;
    if (entry.task?.id) {
      const { data } = await dbProxy.select<Array<{ task_id: string }>>('pulse_tasks', {
        columns: 'task_id',
        filters: { clickup_task_id: entry.task.id },
        single: true
      });

      taskId = data?.[0]?.task_id || null;
    }

    const transformed = {
      clickup_entry_id: entry.id,
      task_id: taskId,
      clickup_task_id: entry.task?.id || null,
      clickup_user_id: entry.user?.id?.toString() || null,
      duration_ms: parseInt(entry.duration, 10),
      start_date: this.convertClickUpTimestamp(entry.start),
      end_date: entry.end ? this.convertClickUpTimestamp(entry.end) : null,
      description: entry.description || null,
      billable: entry.billable !== false,
      tags: JSON.stringify(entry.tags || []),
      raw_data: JSON.stringify(entry),
      last_synced_at: new Date().toISOString()
    };

    const { error } = await dbProxy.upsert('pulse_time_entries', transformed, {
      onConflict: 'clickup_entry_id'
    });

    if (error) {
      console.error(`[ClickUp Cron Sync] Error storing time entry ${entry.id}:`, error);
    }
  }

  /**
   * Sync invoice tasks
   */
  async syncInvoiceTasks(): Promise<number> {
    const invoiceListId = syncConfig.clickup.specialLists.invoices;
    if (!invoiceListId) return 0;

    let allTasks: ClickUpTask[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const tasks = await fetchWithRetry(() =>
        this.client.getTasksFromList(invoiceListId, {
          archived: false,
          includeClosed: true,
          subtasks: false,
          page
        })
      );

      if (tasks.length === 0) {
        hasMore = false;
      } else {
        allTasks.push(...tasks);
        page++;

        if (page > 50) {
          hasMore = false;
        }
      }
    }

    for (const task of allTasks) {
      await this.storeInvoiceTask(task);
    }

    await this.updateContractNextInvoiceDates();

    return allTasks.length;
  }

  private async storeInvoiceTask(task: ClickUpTask): Promise<void> {
    const contractExternalId = this.extractContractNumber(task);

    const transformed = {
      clickup_task_id: task.id,
      contract_external_id: contractExternalId,
      name: task.name,
      status: task.status?.status?.toLowerCase() || null,
      due_date: this.convertClickUpTimestamp(task.due_date)?.split('T')[0] || null,
      points: task.points ?? this.extractPointsFromCustomFields(task.custom_fields),
      hours: this.extractHours(task),
      invoice_amount: this.extractInvoiceAmount(task.custom_fields),
      is_deleted: false,
      raw_data: JSON.stringify(task),
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error } = await dbProxy.upsert('pulse_invoice_tasks', transformed, {
      onConflict: 'clickup_task_id'
    });

    if (error) {
      console.error(`[ClickUp Cron Sync] Error storing invoice task ${task.id}:`, error);
    }
  }

  private extractContractNumber(task: ClickUpTask): string | null {
    const contractIdField = task.custom_fields?.find(
      f => f.id === syncConfig.clickup.customFields.contractId
    );
    if (contractIdField?.value) {
      return String(contractIdField.value);
    }

    const match = task.name.match(/MID\d+/i);
    return match ? match[0].toUpperCase() : null;
  }

  private extractHours(task: ClickUpTask): number | null {
    if (task.time_spent) {
      return Math.round((task.time_spent / 3600000) * 100) / 100;
    }
    return null;
  }

  private extractInvoiceAmount(customFields?: Array<{ id: string; value?: unknown }>): number | null {
    if (!customFields) return null;

    const amountField = customFields.find(
      f => f.id === syncConfig.clickup.customFields.invoiceAmount
    );

    if (amountField?.value !== undefined && amountField.value !== null) {
      const parsed = parseFloat(String(amountField.value));
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  }

  private async updateContractNextInvoiceDates(): Promise<void> {
    // This is simplified - the backend-proxy may not support complex queries
    // For now, skip this step in cron sync
    console.log('[ClickUp Cron Sync] Skipping next_invoice_date update (requires complex query)');
  }

  async markDeletedTasks(): Promise<number> {
    const thresholdDays = syncConfig.clickup.deletedTaskThresholdDays;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);

    // Note: This requires the backend-proxy to support lt (less than) filters
    // For now, log and skip
    console.log('[ClickUp Cron Sync] Note: Deleted task marking may require manual cleanup');
    return 0;
  }

  /**
   * Refresh materialized views for contract points calculations
   */
  async refreshContractViews(): Promise<void> {
    const { error } = await dbProxy.rpc('refresh_contract_views');
    if (error) {
      throw new Error(`Failed to refresh contract views: ${error.message}`);
    }
  }

  /**
   * Resolve parent/subtask relationships
   * Sets parent_task_id based on clickup_parent_id
   */
  async resolveParentRelationships(): Promise<number> {
    // Get all tasks that have no parent_task_id set yet
    // We filter for clickup_parent_id in application code since db-proxy doesn't support NOT NULL filters
    const { data: orphanedTasks, error: selectError } = await dbProxy.select<Array<{
      task_id: string;
      clickup_parent_id: string | null;
    }>>('pulse_tasks', {
      columns: 'task_id, clickup_parent_id',
      filters: {
        parent_task_id: null
      }
    });

    if (selectError) {
      console.error('[ClickUp Cron Sync] Error fetching orphaned tasks:', selectError);
      return 0;
    }

    if (!orphanedTasks || orphanedTasks.length === 0) {
      return 0;
    }

    // Filter to only tasks that have a clickup_parent_id (subtasks)
    const tasksToResolve = orphanedTasks.filter(t => t.clickup_parent_id);

    let resolvedCount = 0;

    for (const task of tasksToResolve) {
      // Look up the parent task by its clickup_task_id
      const { data: parentData } = await dbProxy.select<Array<{ task_id: string }>>('pulse_tasks', {
        columns: 'task_id',
        filters: { clickup_task_id: task.clickup_parent_id },
        single: true
      });

      if (parentData && parentData.length > 0) {
        const parentTaskId = parentData[0].task_id;

        // Update the child task with the parent's task_id
        const { error: updateError } = await dbProxy.update('pulse_tasks', {
          parent_task_id: parentTaskId
        }, { task_id: task.task_id });

        if (!updateError) {
          resolvedCount++;
        }
      }
    }

    return resolvedCount;
  }

  private async logSyncStart(syncId: string, mode: string): Promise<void> {
    await dbProxy.insert('pulse_sync_logs', {
      id: syncId,
      service: 'clickup',
      entity_type: 'tasks',
      sync_mode: mode,
      status: 'started',
      started_at: new Date().toISOString()
    });

    await dbProxy.upsert('pulse_sync_state', {
      service: 'clickup',
      entity_type: 'tasks',
      status: 'running',
      updated_at: new Date().toISOString()
    }, { onConflict: 'service,entity_type' });
  }

  private async logSyncComplete(
    syncId: string,
    status: 'success' | 'failed',
    results: SyncResults,
    errorMessage?: string
  ): Promise<void> {
    await dbProxy.update('pulse_sync_logs', {
      status,
      records_processed: results.tasksProcessed,
      error_message: errorMessage || null,
      completed_at: new Date().toISOString()
    }, { id: syncId });

    const stateUpdate: Record<string, unknown> = {
      service: 'clickup',
      entity_type: 'tasks',
      status: status === 'success' ? 'completed' : 'failed',
      last_sync_at: new Date().toISOString(),
      records_processed: results.tasksProcessed,
      error_message: errorMessage || null,
      updated_at: new Date().toISOString()
    };

    if (status === 'success') {
      stateUpdate.last_successful_sync_at = new Date().toISOString();
      if (results.mode === 'full') {
        stateUpdate.last_full_sync_at = new Date().toISOString();
      }
    }

    await dbProxy.upsert('pulse_sync_state', stateUpdate, { onConflict: 'service,entity_type' });
  }
}

export default ClickUpCronSyncService;
