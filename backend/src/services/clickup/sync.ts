import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { ClickUpClient, fetchWithRetry } from './client.js';
import { syncConfig, detectListType, mapStatus, shouldSkipList, shouldSkipFolder } from '../../config/sync-config.js';

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
  // Added during processing
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
 * ClickUp Sync Service
 * Handles syncing tasks, time entries, and users from ClickUp
 */
export class ClickUpSyncService {
  private client: ClickUpClient;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    const token = syncConfig.clickup.apiToken;
    if (!token) {
      throw new Error('CLICKUP_API_TOKEN environment variable is required');
    }
    this.client = new ClickUpClient(token);
    this.supabase = supabase;
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
      // Log sync start
      await this.logSyncStart(syncId, mode);

      // 1. Sync users first (needed for FK references)
      if (syncUsers) {
        console.log('[ClickUp Sync] Syncing users...');
        results.usersProcessed = await this.syncUsers();
        console.log(`[ClickUp Sync] Synced ${results.usersProcessed} users`);
      }

      // 2. Sync tasks from contract folders
      if (syncTasks) {
        console.log('[ClickUp Sync] Getting folders to sync...');
        const folders = await this.getFoldersToSync();
        console.log(`[ClickUp Sync] Found ${folders.length} folders to sync`);

        for (const folder of folders) {
          try {
            const tasks = await this.fetchTasksForFolder(folder.clickup_folder_id);
            console.log(`[ClickUp Sync] Processing ${tasks.length} tasks from folder ${folder.clickup_folder_id}`);

            // Process in batches
            const batchSize = syncConfig.clickup.batchSize;
            for (let i = 0; i < tasks.length; i += batchSize) {
              const batch = tasks.slice(i, i + batchSize);
              await Promise.all(batch.map(task =>
                this.transformAndStoreTask(task, folder.contract_id, folder.clickup_folder_id)
              ));
            }

            results.tasksProcessed += tasks.length;
            results.foldersProcessed++;
          } catch (error) {
            if (ClickUpClient.isPermissionError(error)) {
              results.foldersSkipped++;
              console.warn(`[ClickUp Sync] Permission denied for folder ${folder.clickup_folder_id}`);
            } else {
              results.foldersFailed++;
              const message = error instanceof Error ? error.message : 'Unknown error';
              results.errors.push({ context: `folder:${folder.clickup_folder_id}`, error: message });
              console.error(`[ClickUp Sync] Failed to sync folder ${folder.clickup_folder_id}:`, message);
            }
          }
        }

        // Mark deleted tasks
        await this.markDeletedTasks();
      }

      // 3. Sync invoice tasks separately
      if (syncInvoiceTasks && syncConfig.clickup.specialLists.invoices) {
        console.log('[ClickUp Sync] Syncing invoice tasks...');
        try {
          results.invoiceTasksProcessed = await this.syncInvoiceTasks();
          console.log(`[ClickUp Sync] Synced ${results.invoiceTasksProcessed} invoice tasks`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({ context: 'invoice_tasks', error: message });
          console.error('[ClickUp Sync] Failed to sync invoice tasks:', message);
        }
      }

      // 4. Sync time entries
      if (syncTimeEntries) {
        const lookback = mode === 'full'
          ? syncConfig.clickup.timeEntryLookbackDays.full
          : syncConfig.clickup.timeEntryLookbackDays.incremental;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - lookback);

        console.log(`[ClickUp Sync] Syncing time entries from ${startDate.toISOString()}...`);
        try {
          results.timeEntriesProcessed = await this.syncTimeEntries(startDate, new Date());
          console.log(`[ClickUp Sync] Synced ${results.timeEntriesProcessed} time entries`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({ context: 'time_entries', error: message });
          console.error('[ClickUp Sync] Failed to sync time entries:', message);
        }
      }

      // Update results
      results.status = 'completed';
      results.completedAt = new Date();
      results.durationMs = results.completedAt.getTime() - startedAt.getTime();

      // Log sync completion
      await this.logSyncComplete(syncId, 'success', results);

      console.log(`[ClickUp Sync] Completed in ${results.durationMs}ms`);
      console.log(`[ClickUp Sync] Results: ${results.tasksProcessed} tasks, ${results.foldersProcessed} folders, ${results.usersProcessed} users`);

    } catch (error) {
      results.status = 'failed';
      results.completedAt = new Date();
      results.durationMs = results.completedAt.getTime() - startedAt.getTime();

      const message = error instanceof Error ? error.message : 'Unknown error';
      results.errors.push({ context: 'sync', error: message });

      await this.logSyncComplete(syncId, 'failed', results, message);

      console.error('[ClickUp Sync] Fatal error:', message);
    }

    return results;
  }

  /**
   * Get folders to sync from active contracts
   */
  private async getFoldersToSync(): Promise<FolderToSync[]> {
    const { data: contractFolders, error } = await this.supabase
      .from('contracts')
      .select('contract_id, clickup_folder_id, contract_name')
      .eq('contract_status', 'active')
      .not('clickup_folder_id', 'is', null);

    if (error) {
      console.error('[ClickUp Sync] Error fetching contract folders:', error);
      throw error;
    }

    // Filter out blacklisted folders
    const validFolders = (contractFolders || []).filter(folder => {
      // Skip blacklisted folder IDs (these are actually list IDs based on user clarification)
      if (syncConfig.clickup.blacklistedLists.byId.includes(folder.clickup_folder_id)) {
        return false;
      }
      // Skip blacklisted folder names
      if (folder.contract_name && shouldSkipFolder(folder.contract_name)) {
        return false;
      }
      return true;
    });

    return validFolders;
  }

  /**
   * Fetch all tasks from a folder (via its lists)
   */
  private async fetchTasksForFolder(folderId: string): Promise<ClickUpTask[]> {
    const lists = await fetchWithRetry(() => this.client.getListsInFolder(folderId));
    const allTasks: ClickUpTask[] = [];

    for (const list of lists) {
      // Skip blacklisted lists
      if (syncConfig.clickup.blacklistedLists.byId.includes(list.id)) {
        console.log(`[ClickUp Sync] Skipping blacklisted list ${list.id}`);
        continue;
      }
      if (shouldSkipList(list.name)) {
        console.log(`[ClickUp Sync] Skipping list by name: ${list.name}`);
        continue;
      }

      // Fetch all pages of tasks
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const tasks = await fetchWithRetry(() =>
          this.client.getTasksFromList(list.id, {
            archived: false,
            includeClosed: true,
            subtasks: true,
            page
          })
        );

        if (tasks.length === 0) {
          hasMore = false;
        } else {
          // Add list metadata to each task
          const tasksWithMeta = tasks.map((task: ClickUpTask) => ({
            ...task,
            list_id: list.id,
            list_name: list.name,
            list_type: detectListType(list.name),
            folder_id: folderId
          }));

          allTasks.push(...tasksWithMeta);
          page++;

          // Safety limit to prevent infinite loops
          if (page > 100) {
            console.warn(`[ClickUp Sync] Hit page limit for list ${list.id}`);
            hasMore = false;
          }
        }
      }
    }

    return allTasks;
  }

  /**
   * Transform and store a task
   */
  private async transformAndStoreTask(
    clickupTask: ClickUpTask,
    contractId: string | null,
    folderId: string
  ): Promise<void> {
    const transformed = {
      clickup_task_id: clickupTask.id,
      contract_id: contractId,
      clickup_folder_id: folderId,
      clickup_list_id: clickupTask.list_id || clickupTask.list?.id,
      clickup_space_id: clickupTask.space?.id,
      name: clickupTask.name,
      description: clickupTask.description || null,
      status: mapStatus(clickupTask.status?.status, clickupTask.list_type || 'ToDos'),
      status_raw: clickupTask.status?.status || null,
      list_type: clickupTask.list_type || detectListType(clickupTask.list_name || ''),
      // Points is a native task field in ClickUp
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

    // Upsert by clickup_task_id
    const { error } = await this.supabase
      .from('pulse_tasks')
      .upsert(transformed, { onConflict: 'clickup_task_id' });

    if (error) {
      console.error(`[ClickUp Sync] Error storing task ${clickupTask.id}:`, error);
      throw error;
    }
  }

  /**
   * Extract points from custom fields (fallback if native points not set)
   */
  private extractPointsFromCustomFields(customFields?: Array<{ id: string; name: string; value?: unknown }>): number | null {
    if (!customFields || !Array.isArray(customFields)) return null;

    // Try to find by custom field ID first
    const pointsFieldById = customFields.find(f => f.id === syncConfig.clickup.customFields.points);
    if (pointsFieldById?.value !== undefined && pointsFieldById.value !== null) {
      const parsed = parseFloat(String(pointsFieldById.value));
      return isNaN(parsed) ? null : parsed;
    }

    // Fallback to name-based search
    const pointsField = customFields.find(f =>
      f.name?.toLowerCase().includes('point') ||
      f.name?.toLowerCase().includes('score')
    );

    if (pointsField?.value !== undefined && pointsField.value !== null) {
      const parsed = parseFloat(String(pointsField.value));
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  }

  /**
   * Check if task is marked as internal only
   */
  private checkInternalOnly(task: ClickUpTask): boolean {
    // Check custom field
    const internalField = task.custom_fields?.find(
      f => f.id === syncConfig.clickup.customFields.internalOnly
    );
    if (internalField?.value === true || internalField?.value === 'true') {
      return true;
    }

    // Check tags
    if (task.tags?.some(t => t.name?.toLowerCase().includes('internal'))) {
      return true;
    }

    return false;
  }

  /**
   * Check if task is marked as growth task
   */
  private checkGrowthTask(task: ClickUpTask): boolean {
    const growthField = task.custom_fields?.find(
      f => f.id === syncConfig.clickup.customFields.growthTask
    );
    return growthField?.value === true || growthField?.value === 'true';
  }

  /**
   * Convert ClickUp timestamp (milliseconds string) to ISO date
   */
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

    const allUsers = new Map<string, {
      id: string;
      username: string | null;
      email: string | null;
      full_name: string | null;
      profile_picture: string | null;
      initials: string;
      user_type: string;
      is_assignable: boolean;
      raw_data: string;
      last_synced_at: string;
    }>();

    for (const team of teams) {
      // Only sync users from our team
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

    // Upsert all users
    for (const user of allUsers.values()) {
      const { error } = await this.supabase
        .from('pulse_clickup_users')
        .upsert(user, { onConflict: 'id' });

      if (error) {
        console.error(`[ClickUp Sync] Error storing user ${user.id}:`, error);
      }
    }

    return allUsers.size;
  }

  /**
   * Extract name from email
   */
  private extractNameFromEmail(email?: string): string | null {
    if (!email) return null;
    const localPart = email.split('@')[0];
    return localPart
      .replace(/[._-]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Generate initials from name
   */
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

  /**
   * Store a time entry
   */
  private async storeTimeEntry(entry: ClickUpTimeEntry): Promise<void> {
    // Find the internal task_id from clickup_task_id
    let taskId: string | null = null;
    if (entry.task?.id) {
      const { data: taskData } = await this.supabase
        .from('pulse_tasks')
        .select('task_id')
        .eq('clickup_task_id', entry.task.id)
        .maybeSingle();

      taskId = taskData?.task_id || null;
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

    const { error } = await this.supabase
      .from('pulse_time_entries')
      .upsert(transformed, { onConflict: 'clickup_entry_id' });

    if (error) {
      console.error(`[ClickUp Sync] Error storing time entry ${entry.id}:`, error);
    }
  }

  /**
   * Sync invoice tasks from special list
   */
  async syncInvoiceTasks(): Promise<number> {
    const invoiceListId = syncConfig.clickup.specialLists.invoices;
    if (!invoiceListId) return 0;

    // Fetch tasks directly from the invoice list
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

    // Process each invoice task
    for (const task of allTasks) {
      await this.storeInvoiceTask(task);
    }

    // Update contracts.next_invoice_date
    await this.updateContractNextInvoiceDates();

    return allTasks.length;
  }

  /**
   * Store an invoice task
   */
  private async storeInvoiceTask(task: ClickUpTask): Promise<void> {
    // Extract contract number from task name or custom field
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

    const { error } = await this.supabase
      .from('pulse_invoice_tasks')
      .upsert(transformed, { onConflict: 'clickup_task_id' });

    if (error) {
      console.error(`[ClickUp Sync] Error storing invoice task ${task.id}:`, error);
    }
  }

  /**
   * Extract contract number from task
   */
  private extractContractNumber(task: ClickUpTask): string | null {
    // Try custom field first
    const contractIdField = task.custom_fields?.find(
      f => f.id === syncConfig.clickup.customFields.contractId
    );
    if (contractIdField?.value) {
      return String(contractIdField.value);
    }

    // Try to extract from task name (e.g., "Invoice - MID20231234 - Client Name")
    const match = task.name.match(/MID\d+/i);
    return match ? match[0].toUpperCase() : null;
  }

  /**
   * Extract hours from task
   */
  private extractHours(task: ClickUpTask): number | null {
    // Calculate from time_spent (which is in milliseconds)
    if (task.time_spent) {
      return Math.round((task.time_spent / 3600000) * 100) / 100; // ms to hours, 2 decimal places
    }
    return null;
  }

  /**
   * Extract invoice amount from custom fields
   */
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

  /**
   * Update contracts.next_invoice_date based on invoice tasks
   */
  private async updateContractNextInvoiceDates(): Promise<void> {
    // This uses a raw SQL query via Supabase RPC or direct update
    // Find the minimum due_date for each contract where status is open/working
    const { data: invoiceDates, error: fetchError } = await this.supabase
      .from('pulse_invoice_tasks')
      .select('contract_external_id, due_date')
      .in('status', ['working', 'in progress', 'to do', 'open'])
      .eq('is_deleted', false)
      .gte('due_date', new Date().toISOString().split('T')[0]);

    if (fetchError || !invoiceDates) {
      console.error('[ClickUp Sync] Error fetching invoice dates:', fetchError);
      return;
    }

    // Group by contract and find minimum
    const minDatesByContract = new Map<string, string>();
    for (const row of invoiceDates) {
      if (!row.contract_external_id || !row.due_date) continue;

      const existing = minDatesByContract.get(row.contract_external_id);
      if (!existing || row.due_date < existing) {
        minDatesByContract.set(row.contract_external_id, row.due_date);
      }
    }

    // Update each contract
    for (const [externalId, minDate] of minDatesByContract) {
      const { error: updateError } = await this.supabase
        .from('contracts')
        .update({ next_invoice_date: minDate, updated_at: new Date().toISOString() })
        .eq('external_id', externalId);

      if (updateError) {
        console.error(`[ClickUp Sync] Error updating next_invoice_date for ${externalId}:`, updateError);
      }
    }
  }

  /**
   * Mark tasks as deleted if not seen in threshold days
   */
  async markDeletedTasks(): Promise<number> {
    const thresholdDays = syncConfig.clickup.deletedTaskThresholdDays;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - thresholdDays);

    const { data, error } = await this.supabase
      .from('pulse_tasks')
      .update({
        is_deleted: true,
        deletion_detected_at: new Date().toISOString()
      })
      .lt('last_seen_at', cutoffDate.toISOString())
      .eq('is_deleted', false)
      .select('task_id');

    if (error) {
      console.error('[ClickUp Sync] Error marking deleted tasks:', error);
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(`[ClickUp Sync] Marked ${count} tasks as deleted`);
    }

    return count;
  }

  /**
   * Log sync start
   */
  private async logSyncStart(syncId: string, mode: string): Promise<void> {
    // Create sync log entry
    await this.supabase
      .from('pulse_sync_logs')
      .insert({
        id: syncId,
        service: 'clickup',
        entity_type: 'tasks',
        sync_mode: mode,
        status: 'started',
        started_at: new Date().toISOString()
      });

    // Update sync state
    await this.supabase
      .from('pulse_sync_state')
      .upsert({
        service: 'clickup',
        entity_type: 'tasks',
        status: 'running',
        updated_at: new Date().toISOString()
      }, { onConflict: 'service,entity_type' });
  }

  /**
   * Log sync completion
   */
  private async logSyncComplete(
    syncId: string,
    status: 'success' | 'failed',
    results: SyncResults,
    errorMessage?: string
  ): Promise<void> {
    // Update sync log
    await this.supabase
      .from('pulse_sync_logs')
      .update({
        status,
        records_processed: results.tasksProcessed,
        error_message: errorMessage || null,
        completed_at: new Date().toISOString()
      })
      .eq('id', syncId);

    // Update sync state
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

    await this.supabase
      .from('pulse_sync_state')
      .upsert(stateUpdate, { onConflict: 'service,entity_type' });
  }
}

export default ClickUpSyncService;
