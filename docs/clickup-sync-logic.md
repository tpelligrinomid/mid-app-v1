# ClickUp Sync Logic

**MiD Platform - Developer Documentation**

*Last Updated: January 2025*

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [What Gets Synced](#2-what-gets-synced)
3. [Database Schema](#3-database-schema)
4. [Task Sync Logic](#4-task-sync-logic)
5. [Time Entries Sync Logic](#5-time-entries-sync-logic)
6. [User Sync Logic](#6-user-sync-logic)
7. [Invoice Tasks Sync (Special Handling)](#7-invoice-tasks-sync-special-handling)
8. [Deleted Task Detection](#8-deleted-task-detection)
9. [Sync Orchestration](#9-sync-orchestration)
10. [Sync State Management](#10-sync-state-management)
11. [API Endpoints](#11-api-endpoints)
12. [Scheduled Jobs (Cron)](#12-scheduled-jobs-cron)
13. [Configuration](#13-configuration)
14. [Authentication](#14-authentication)
15. [Error Handling](#15-error-handling)
16. [Testing Checklist](#16-testing-checklist)

---

## 1. Architecture Overview

```
ClickUp API
    ↓
clickupService (API client)
    ↓
syncService (orchestration & transformation)
    ↓
Database (Supabase PostgreSQL)
```

**Key Principles:**
- Pull-based only (no webhooks)
- Scheduled syncs via cron jobs
- Manual sync trigger via API endpoint
- Detached execution pattern (return immediately, process in background)
- Incremental (delta) and full sync modes

---

## 2. What Gets Synced

### 2.1 Contract Tasks (Primary)
Tasks from ClickUp folders linked to active contracts.

### 2.2 Special Folders (Additional)
- **Invoice Tasks** - From a dedicated invoicing folder/list
- **Operations Tasks** - Internal operations tracking
- These are configured separately, not linked to contracts

### 2.3 Time Entries
Time tracking data for billable hours calculation.

### 2.4 Users
ClickUp team members for assignment dropdowns and reporting.

---

## 3. Database Schema

### Sync State Tracking

```sql
CREATE TABLE pulse_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,                    -- 'clickup', 'quickbooks', 'hubspot'
    entity_type text NOT NULL,                -- 'tasks', 'time_entries', 'users'
    sync_mode text NOT NULL DEFAULT 'incremental',
    status text DEFAULT 'idle',               -- 'idle', 'running', 'failed', 'completed'
    last_sync_at timestamptz,
    last_successful_sync_at timestamptz,
    last_full_sync_at timestamptz,
    last_modified_cursor timestamptz,         -- For incremental: "changes since"
    next_full_sync_at timestamptz,
    records_processed integer,
    error_message text,
    retry_count integer DEFAULT 0,
    config jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, entity_type)
);
```

### Sync Logs (Audit Trail)

```sql
CREATE TABLE pulse_sync_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,
    entity_type text NOT NULL,
    sync_mode text,
    status text NOT NULL,                     -- 'started', 'success', 'failed'
    records_processed integer,
    error_message text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz DEFAULT now()
);
```

### ClickUp Users

```sql
CREATE TABLE pulse_clickup_users (
    id text PRIMARY KEY,                      -- ClickUp user ID (their ID, not UUID)
    username text,
    email text,
    full_name text,
    profile_picture text,
    initials text,                            -- Generated from name
    user_type text,                           -- 'member', 'owner', 'guest'
    is_assignable boolean DEFAULT true,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### Tasks

```sql
CREATE TABLE pulse_tasks (
    task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid REFERENCES contracts(contract_id),
    clickup_task_id text UNIQUE NOT NULL,
    clickup_folder_id text,
    clickup_list_id text,
    clickup_space_id text,
    parent_task_id uuid REFERENCES pulse_tasks(task_id),
    name text NOT NULL,
    description text,
    status text,                              -- Mapped status
    status_raw text,                          -- Original ClickUp status
    list_type text,                           -- 'Deliverables', 'ToDos', 'Goals', etc.
    points numeric,
    priority text,
    priority_order integer,
    due_date timestamptz,
    start_date timestamptz,
    date_created timestamptz,
    date_updated timestamptz,
    date_done timestamptz,
    time_estimate integer,                    -- In milliseconds
    time_spent integer,                       -- In milliseconds
    -- Flags
    is_internal_only boolean DEFAULT false,
    is_growth_task boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    deletion_detected_at timestamptz,
    -- Metadata
    assignees jsonb,                          -- Array of user objects
    custom_fields jsonb,                      -- All custom fields
    tags jsonb,
    raw_data jsonb,                           -- Full ClickUp response
    -- Sync tracking
    last_seen_at timestamptz,                 -- Updated every sync
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### Time Entries

```sql
CREATE TABLE pulse_time_entries (
    entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES pulse_tasks(task_id),
    clickup_entry_id text UNIQUE NOT NULL,
    clickup_task_id text,                     -- Denormalized for easier queries
    clickup_user_id text REFERENCES pulse_clickup_users(id),
    duration_ms integer NOT NULL,
    start_date timestamptz NOT NULL,
    end_date timestamptz,
    description text,
    billable boolean DEFAULT true,
    tags jsonb,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now()
);
```

### Task Status History (Audit Trail)

```sql
CREATE TABLE pulse_task_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES pulse_tasks(task_id),
    clickup_task_id text,
    status_from text,
    status_to text,
    changed_at timestamptz,
    changed_by text,                          -- ClickUp user ID
    raw_data jsonb,
    created_at timestamptz DEFAULT now()
);
```

### Invoice Tasks (Special Handling)

```sql
CREATE TABLE pulse_invoice_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clickup_task_id text UNIQUE NOT NULL,
    contract_external_id text,                -- Links to contracts.external_id
    name text,
    status text,
    due_date date,
    points numeric,
    hours numeric,
    invoice_amount numeric,
    is_deleted boolean DEFAULT false,
    raw_data jsonb,
    last_synced_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

---

## 4. Task Sync Logic

### Step 1: Determine What to Sync

```javascript
async function getFoldersToSync() {
  // Get contract folders
  const contractFolders = await db.query(`
    SELECT contract_id, clickup_folder_id, contract_name
    FROM contracts
    WHERE contract_status = 'active'
      AND clickup_folder_id IS NOT NULL
  `);

  // Get special folders from config
  const specialFolders = config.clickup.specialFolders || [];

  // Combine and filter
  const allFolders = [...contractFolders, ...specialFolders];

  // Apply blacklist
  return allFolders.filter(folder => {
    // Skip blacklisted IDs
    if (config.clickup.blacklistedFolders.byId.includes(folder.clickup_folder_id)) {
      return false;
    }
    // Skip blacklisted names (partial match, case-insensitive)
    const name = folder.folder_name?.toLowerCase() || '';
    return !config.clickup.blacklistedFolders.byName.some(
      blacklisted => name.includes(blacklisted.toLowerCase())
    );
  });
}
```

### Step 2: Fetch Tasks from ClickUp

```javascript
async function fetchTasksForFolder(folderId) {
  // Get all lists in the folder
  const listsResponse = await clickupApi.get(`/folder/${folderId}/list`);
  const lists = listsResponse.data.lists;

  const allTasks = [];

  for (const list of lists) {
    // Skip blacklisted lists
    if (shouldSkipList(list.name)) continue;

    // Fetch tasks with subtasks and custom fields
    const tasksResponse = await clickupApi.get(`/list/${list.id}/task`, {
      params: {
        archived: false,
        include_closed: true,
        subtasks: true,
        custom_fields: true
      }
    });

    // Add list metadata to each task
    const tasksWithMeta = tasksResponse.data.tasks.map(task => ({
      ...task,
      list_id: list.id,
      list_name: list.name,
      list_type: detectListType(list.name),
      folder_id: folderId
    }));

    allTasks.push(...tasksWithMeta);
  }

  return allTasks;
}

function shouldSkipList(listName) {
  const blacklisted = ['Financials', 'Legal', 'Finance', 'Confidential', 'Hidden', 'Private'];
  return blacklisted.some(b => listName.toLowerCase().includes(b.toLowerCase()));
}

function detectListType(listName) {
  const name = listName.toLowerCase();
  if (name.includes('deliverable')) return 'Deliverables';
  if (name.includes('todo')) return 'ToDos';
  if (name.includes('goal')) return 'Goals';
  return 'ToDos'; // Default
}
```

### Step 3: Transform and Store Tasks

```javascript
async function transformAndStoreTask(clickupTask, contractId, folderId) {
  const transformed = {
    clickup_task_id: clickupTask.id,
    contract_id: contractId,
    clickup_folder_id: folderId,
    clickup_list_id: clickupTask.list_id,
    clickup_space_id: clickupTask.space?.id,
    name: clickupTask.name,
    description: clickupTask.description || null,
    status: mapStatus(clickupTask.status?.status, clickupTask.list_type),
    status_raw: clickupTask.status?.status,
    list_type: clickupTask.list_type,
    points: extractPoints(clickupTask.custom_fields),
    priority: clickupTask.priority?.priority,
    priority_order: clickupTask.priority?.orderindex,
    due_date: convertClickUpTimestamp(clickupTask.due_date),
    start_date: convertClickUpTimestamp(clickupTask.start_date),
    date_created: convertClickUpTimestamp(clickupTask.date_created),
    date_updated: convertClickUpTimestamp(clickupTask.date_updated),
    date_done: convertClickUpTimestamp(clickupTask.date_closed),
    time_estimate: clickupTask.time_estimate,
    time_spent: clickupTask.time_spent,
    is_archived: clickupTask.archived || false,
    assignees: JSON.stringify(clickupTask.assignees || []),
    custom_fields: JSON.stringify(clickupTask.custom_fields || []),
    tags: JSON.stringify(clickupTask.tags || []),
    raw_data: JSON.stringify(clickupTask),
    last_seen_at: new Date(),
    last_synced_at: new Date()
  };

  // Check for internal-only flag (custom field or tag)
  transformed.is_internal_only = checkInternalOnly(clickupTask);

  // Upsert by clickup_task_id
  await db.query(`
    INSERT INTO pulse_tasks (${Object.keys(transformed).join(', ')})
    VALUES (${Object.keys(transformed).map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (clickup_task_id) DO UPDATE SET
      ${Object.keys(transformed).filter(k => k !== 'clickup_task_id').map(k => `${k} = EXCLUDED.${k}`).join(', ')}
  `, Object.values(transformed));
}

function convertClickUpTimestamp(timestamp) {
  if (!timestamp) return null;
  // ClickUp timestamps are in milliseconds
  return new Date(parseInt(timestamp));
}

function extractPoints(customFields) {
  if (!customFields || !Array.isArray(customFields)) return null;
  const pointsField = customFields.find(f =>
    f.name?.toLowerCase().includes('point') ||
    f.name?.toLowerCase().includes('score')
  );
  return pointsField?.value ? parseFloat(pointsField.value) : null;
}
```

### Step 4: Status Mapping

```javascript
const STATUS_MAPPINGS = {
  Deliverables: {
    'planned': 'not_started',
    'not started': 'not_started',
    'working': 'working',
    'in progress': 'working',
    'waiting on client': 'blocked',
    'on hold': 'blocked',
    'delivered': 'delivered',
    'complete': 'delivered',
    'closed': 'delivered',
    'archived': 'archived'
  },
  ToDos: {
    'to do': 'not_started',
    'open': 'not_started',
    'in progress': 'working',
    'working': 'working',
    'review': 'working',
    'done': 'delivered',
    'complete': 'delivered',
    'closed': 'delivered'
  },
  Goals: {
    'proposed': 'not_started',
    'on track': 'working',
    'needs attention': 'at_risk',
    'off track': 'blocked',
    'closed': 'delivered',
    'achieved': 'delivered'
  }
};

function mapStatus(rawStatus, listType) {
  if (!rawStatus) return 'not_started';
  const mapping = STATUS_MAPPINGS[listType] || STATUS_MAPPINGS.ToDos;
  const normalized = rawStatus.toLowerCase().trim();
  return mapping[normalized] || 'not_started';
}
```

---

## 5. Time Entries Sync Logic

### Approach A: Team-Level Fetch (Recommended for Full Sync)

```javascript
async function syncTimeEntriesForTeam(teamId, startDate, endDate) {
  // Fetch time entries at team level
  const response = await clickupApi.get(`/team/${teamId}/time_entries`, {
    params: {
      start_date: startDate.getTime(),  // Milliseconds
      end_date: endDate.getTime()
    }
  });

  const timeEntries = response.data.data || [];

  for (const entry of timeEntries) {
    await storeTimeEntry(entry);
  }

  return timeEntries.length;
}
```

### Approach B: Task-Level Fetch (For Specific Tasks)

```javascript
async function syncTimeEntriesForTask(taskId) {
  const response = await clickupApi.get(`/task/${taskId}/time`);
  const timeEntries = response.data.data || [];

  for (const entry of timeEntries) {
    await storeTimeEntry(entry);
  }

  return timeEntries.length;
}
```

### Store Time Entry

```javascript
async function storeTimeEntry(entry) {
  // Find the internal task_id from clickup_task_id
  const taskResult = await db.query(
    'SELECT task_id FROM pulse_tasks WHERE clickup_task_id = $1',
    [entry.task?.id]
  );

  const transformed = {
    clickup_entry_id: entry.id,
    task_id: taskResult.rows[0]?.task_id || null,
    clickup_task_id: entry.task?.id,
    clickup_user_id: entry.user?.id,
    duration_ms: parseInt(entry.duration),
    start_date: new Date(parseInt(entry.start)),
    end_date: entry.end ? new Date(parseInt(entry.end)) : null,
    description: entry.description,
    billable: entry.billable !== false,
    tags: JSON.stringify(entry.tags || []),
    raw_data: JSON.stringify(entry),
    last_synced_at: new Date()
  };

  await db.query(`
    INSERT INTO pulse_time_entries (${Object.keys(transformed).join(', ')})
    VALUES (${Object.keys(transformed).map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (clickup_entry_id) DO UPDATE SET
      duration_ms = EXCLUDED.duration_ms,
      description = EXCLUDED.description,
      billable = EXCLUDED.billable,
      last_synced_at = EXCLUDED.last_synced_at
  `, Object.values(transformed));
}
```

---

## 6. User Sync Logic

```javascript
async function syncClickUpUsers() {
  // Get all teams the token has access to
  const teamsResponse = await clickupApi.get('/team');
  const teams = teamsResponse.data.teams || [];

  const allUsers = new Map(); // Dedupe by user ID

  for (const team of teams) {
    const members = team.members || [];
    for (const member of members) {
      const user = member.user;
      if (!allUsers.has(user.id)) {
        allUsers.set(user.id, {
          id: user.id.toString(),
          username: user.username,
          email: user.email,
          full_name: user.username || extractNameFromEmail(user.email),
          profile_picture: user.profilePicture,
          initials: generateInitials(user.username || user.email),
          user_type: member.role?.name || 'member',
          is_assignable: ['member', 'owner', 'admin'].includes(member.role?.name?.toLowerCase()),
          raw_data: JSON.stringify(user),
          last_synced_at: new Date()
        });
      }
    }
  }

  // Upsert all users
  for (const user of allUsers.values()) {
    await db.query(`
      INSERT INTO pulse_clickup_users (id, username, email, full_name, profile_picture, initials, user_type, is_assignable, raw_data, last_synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        profile_picture = EXCLUDED.profile_picture,
        user_type = EXCLUDED.user_type,
        is_assignable = EXCLUDED.is_assignable,
        raw_data = EXCLUDED.raw_data,
        last_synced_at = EXCLUDED.last_synced_at
    `, [user.id, user.username, user.email, user.full_name, user.profile_picture, user.initials, user.user_type, user.is_assignable, user.raw_data, user.last_synced_at]);
  }

  return allUsers.size;
}

function generateInitials(name) {
  if (!name) return '??';
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}
```

---

## 7. Invoice Tasks Sync (Special Handling)

Invoice tasks live in a specific folder/list and link to contracts via the `external_id` (contract number).

```javascript
async function syncInvoiceTasks(invoiceFolderId) {
  const tasks = await fetchTasksForFolder(invoiceFolderId);

  for (const task of tasks) {
    // Extract contract number from task name or custom field
    const contractNumber = extractContractNumber(task);

    const transformed = {
      clickup_task_id: task.id,
      contract_external_id: contractNumber,
      name: task.name,
      status: task.status?.status?.toLowerCase(),
      due_date: convertClickUpTimestamp(task.due_date),
      points: extractPoints(task.custom_fields),
      hours: extractHours(task.custom_fields),
      invoice_amount: extractInvoiceAmount(task.custom_fields),
      is_deleted: false,
      raw_data: JSON.stringify(task),
      last_synced_at: new Date()
    };

    await db.query(`
      INSERT INTO pulse_invoice_tasks (...)
      VALUES (...)
      ON CONFLICT (clickup_task_id) DO UPDATE SET ...
    `, Object.values(transformed));
  }

  // After sync, update contracts.next_invoice_date
  await updateContractNextInvoiceDates();
}

async function updateContractNextInvoiceDates() {
  await db.query(`
    UPDATE contracts c
    SET next_invoice_date = subq.min_due_date
    FROM (
      SELECT
        contract_external_id,
        MIN(due_date) as min_due_date
      FROM pulse_invoice_tasks
      WHERE status IN ('working', 'in progress', 'to do', 'open')
        AND is_deleted = false
        AND due_date >= CURRENT_DATE
      GROUP BY contract_external_id
    ) subq
    WHERE c.external_id = subq.contract_external_id
  `);
}
```

---

## 8. Deleted Task Detection

Tasks not seen in 7 days are marked as deleted (soft delete):

```javascript
async function markDeletedTasks() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  await db.query(`
    UPDATE pulse_tasks
    SET
      is_deleted = true,
      deletion_detected_at = NOW()
    WHERE last_seen_at < $1
      AND is_deleted = false
  `, [sevenDaysAgo]);
}
```

---

## 9. Sync Orchestration

### Main Sync Function

```javascript
async function runSync(options = {}) {
  const {
    mode = 'incremental',  // 'incremental' or 'full'
    syncTasks = true,
    syncTimeEntries = true,
    syncUsers = true
  } = options;

  const syncId = generateSyncId();
  const startedAt = new Date();

  // Log sync start
  await logSyncStart(syncId, 'clickup', mode);

  const results = {
    syncId,
    mode,
    foldersProcessed: 0,
    foldersSkipped: 0,
    foldersFailed: 0,
    tasksProcessed: 0,
    timeEntriesProcessed: 0,
    usersProcessed: 0,
    errors: []
  };

  try {
    // 1. Sync users first (needed for FK references)
    if (syncUsers) {
      results.usersProcessed = await syncClickUpUsers();
    }

    // 2. Sync tasks
    if (syncTasks) {
      const folders = await getFoldersToSync();

      for (const folder of folders) {
        try {
          const tasks = await fetchTasksForFolder(folder.clickup_folder_id);

          // Process in batches of 50
          for (let i = 0; i < tasks.length; i += 50) {
            const batch = tasks.slice(i, i + 50);
            await Promise.all(batch.map(task =>
              transformAndStoreTask(task, folder.contract_id, folder.clickup_folder_id)
            ));
          }

          results.tasksProcessed += tasks.length;
          results.foldersProcessed++;
        } catch (error) {
          if (isPermissionError(error)) {
            results.foldersSkipped++;
            console.warn(`Permission denied for folder ${folder.clickup_folder_id}`);
          } else {
            results.foldersFailed++;
            results.errors.push({ folder: folder.clickup_folder_id, error: error.message });
          }
        }
      }

      // Sync special folders (invoices, etc.)
      await syncInvoiceTasks(config.clickup.invoiceFolderId);

      // Mark deleted tasks
      await markDeletedTasks();
    }

    // 3. Sync time entries
    if (syncTimeEntries) {
      const lookback = mode === 'full' ? 90 : 7; // days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - lookback);

      results.timeEntriesProcessed = await syncTimeEntriesForTeam(
        config.clickup.teamId,
        startDate,
        new Date()
      );
    }

    // Log success
    await logSyncComplete(syncId, 'clickup', 'success', results);

  } catch (error) {
    await logSyncComplete(syncId, 'clickup', 'failed', results, error.message);
    throw error;
  }

  return results;
}

function isPermissionError(error) {
  return error.response?.data?.err === 'Team not authorized' ||
         error.response?.data?.ECODE === 'OAUTH_027' ||
         error.response?.status === 403;
}
```

---

## 10. Sync State Management

```javascript
async function logSyncStart(syncId, service, mode) {
  await db.query(`
    INSERT INTO pulse_sync_logs (id, service, entity_type, sync_mode, status, started_at)
    VALUES ($1, $2, 'tasks', $3, 'started', NOW())
  `, [syncId, service, mode]);

  await db.query(`
    UPDATE pulse_sync_state
    SET status = 'running', updated_at = NOW()
    WHERE service = $1 AND entity_type = 'tasks'
  `, [service]);
}

async function logSyncComplete(syncId, service, status, results, errorMessage = null) {
  await db.query(`
    UPDATE pulse_sync_logs
    SET status = $1, records_processed = $2, error_message = $3, completed_at = NOW()
    WHERE id = $4
  `, [status, results.tasksProcessed, errorMessage, syncId]);

  await db.query(`
    UPDATE pulse_sync_state
    SET
      status = $1,
      last_sync_at = NOW(),
      last_successful_sync_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE last_successful_sync_at END,
      last_full_sync_at = CASE WHEN $2 = 'full' AND $1 = 'completed' THEN NOW() ELSE last_full_sync_at END,
      records_processed = $3,
      error_message = $4,
      updated_at = NOW()
    WHERE service = $5 AND entity_type = 'tasks'
  `, [status === 'success' ? 'completed' : 'failed', results.mode, results.tasksProcessed, errorMessage, service]);
}
```

---

## 11. API Endpoints

### Trigger Sync (Returns Immediately)

```javascript
router.post('/api/sync/clickup', async (req, res) => {
  const { mode = 'incremental' } = req.body;
  const syncId = generateSyncId();

  // Return immediately
  res.json({ syncId, status: 'started', message: 'Sync started in background' });

  // Run sync detached
  setImmediate(async () => {
    try {
      await runSync({ mode, syncId });
    } catch (error) {
      console.error('Sync failed:', error);
    }
  });
});
```

### Check Sync Status

```javascript
router.get('/api/sync/clickup/status', async (req, res) => {
  const status = await db.query(`
    SELECT * FROM pulse_sync_state
    WHERE service = 'clickup' AND entity_type = 'tasks'
  `);
  res.json(status.rows[0] || { status: 'never_run' });
});
```

### Check Specific Sync

```javascript
router.get('/api/sync/clickup/status/:syncId', async (req, res) => {
  const log = await db.query(
    'SELECT * FROM pulse_sync_logs WHERE id = $1',
    [req.params.syncId]
  );
  res.json(log.rows[0] || { error: 'Sync not found' });
});
```

### Get Recent Sync Logs

```javascript
router.get('/api/sync/clickup/logs', async (req, res) => {
  const logs = await db.query(`
    SELECT * FROM pulse_sync_logs
    WHERE service = 'clickup'
    ORDER BY started_at DESC
    LIMIT 20
  `);
  res.json(logs.rows);
});
```

---

## 12. Scheduled Jobs (Cron)

```javascript
// Using node-cron or similar

// Delta sync every 15 minutes on weekdays
cron.schedule('*/15 * * * 1-5', async () => {
  console.log('Running ClickUp delta sync...');
  await runSync({ mode: 'incremental' });
});

// Light sync on weekends (once daily at 3 AM)
cron.schedule('0 3 * * 0,6', async () => {
  console.log('Running ClickUp weekend sync...');
  await runSync({ mode: 'incremental' });
});

// Full sync weekly (Sunday 8 PM UTC)
cron.schedule('0 20 * * 0', async () => {
  console.log('Running ClickUp full sync...');
  await runSync({ mode: 'full' });
});
```

---

## 13. Configuration

```javascript
// config/sync-config.js
export default {
  clickup: {
    teamId: process.env.CLICKUP_TEAM_ID,

    // Auto-sync all active contract folders
    includeContractFolders: true,

    // Special folders to sync (not linked to contracts)
    specialFolders: {
      invoices: process.env.CLICKUP_INVOICE_FOLDER_ID,
      operations: process.env.CLICKUP_OPERATIONS_FOLDER_ID
    },

    // Folders to never sync
    blacklistedFolders: {
      byId: ['90030224427', '115210586', '90171958783'],
      byName: ['Archive', 'Internal', 'Draft', 'Test', 'Template']
    },

    // Lists to skip within synced folders
    blacklistedLists: {
      byName: ['Financials', 'Legal', 'Finance', 'Confidential', 'Hidden', 'Private']
    },

    // Performance settings
    batchSize: 50,
    concurrency: 5,
    requestTimeout: 30000,  // 30 seconds per request
    syncTimeout: 300000,    // 5 minutes total

    // Incremental sync lookback
    incrementalLookbackMinutes: 30,

    // Time entry sync
    timeEntryLookbackDays: {
      incremental: 7,
      full: 90
    },

    // Deleted task detection
    deletedTaskThresholdDays: 7
  }
};
```

---

## 14. Authentication

**Two token types supported:**

| Type | Format | Header |
|------|--------|--------|
| Personal | `pk_12345...` | `Authorization: pk_12345...` (NO Bearer) |
| OAuth | `eyJhbGc...` | `Authorization: Bearer eyJhbGc...` |

```javascript
class ClickUpClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.isPersonalToken = accessToken?.startsWith('pk_');

    this.client = axios.create({
      baseURL: 'https://api.clickup.com/api/v2',
      timeout: 30000,
      headers: {
        // Personal tokens: NO Bearer prefix
        // OAuth tokens: WITH Bearer prefix
        'Authorization': this.isPersonalToken
          ? accessToken
          : `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    // Add response interceptor for 401 handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status === 401) {
          this.handleAuthError();
        }
        throw error;
      }
    );
  }
}
```

**Token Storage Table:** `pulse_sync_tokens`

```sql
CREATE TABLE pulse_sync_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,                -- 'clickup', 'quickbooks', 'hubspot'
    identifier text NOT NULL,             -- realm_id, workspace_id, etc.
    access_token text NOT NULL,
    refresh_token text,
    token_type text,                      -- 'personal' or 'oauth'
    expires_at timestamptz,
    is_active boolean DEFAULT true,
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(service, identifier)
);
```

---

## 15. Error Handling

### Error Types to Handle

| Error | Status | Action |
|-------|--------|--------|
| 401 Unauthorized | Token expired/invalid | Mark token inactive, stop sync |
| 403 Forbidden | No folder access | Skip folder, continue |
| 429 Rate Limited | Too many requests | Back off, retry with delay |
| OAUTH_027 | Team not authorized | Skip folder, continue |
| Network timeout | Connection issue | Retry with exponential backoff |

### Error Handling Pattern

```javascript
async function fetchWithRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable =
        error.response?.status === 429 ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT';

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const delay = Math.pow(2, attempt) * 1000;
      await sleep(delay);
    }
  }
}
```

### Sync Result Summary

```javascript
{
  syncId: 'uuid',
  mode: 'incremental',
  status: 'completed',
  foldersProcessed: 45,
  foldersSkipped: 2,      // Permission errors
  foldersFailed: 1,       // Other errors
  tasksProcessed: 1234,
  timeEntriesProcessed: 567,
  usersProcessed: 23,
  errors: [
    { folder: '12345', error: 'Network timeout' }
  ],
  startedAt: '2025-01-19T10:00:00Z',
  completedAt: '2025-01-19T10:02:30Z',
  durationMs: 150000
}
```

---

## 16. Testing Checklist

### Task Sync
- [ ] Sync creates new tasks correctly
- [ ] Sync updates existing tasks (upsert works)
- [ ] Status mapping works for all list types (Deliverables, ToDos, Goals)
- [ ] Points extraction works from custom fields
- [ ] Parent/child task relationships preserved
- [ ] Assignees stored correctly as JSON
- [ ] Custom fields preserved
- [ ] Blacklisted folders are skipped
- [ ] Blacklisted lists are skipped

### Time Entries
- [ ] Time entries link to correct tasks
- [ ] Duration stored in milliseconds
- [ ] User references resolved correctly
- [ ] Billable flag preserved

### Users
- [ ] User sync populates pulse_clickup_users
- [ ] Initials generated correctly
- [ ] User type (member/owner/guest) captured
- [ ] Duplicate users deduplicated

### Invoice Tasks
- [ ] Invoice tasks sync to separate table
- [ ] Contract number extracted correctly
- [ ] `contracts.next_invoice_date` updated after sync

### Deleted Detection
- [ ] `last_seen_at` updated on every sync
- [ ] Tasks not seen in 7 days marked `is_deleted = true`
- [ ] `deletion_detected_at` timestamp set

### Error Handling
- [ ] Permission errors don't stop entire sync
- [ ] Failed folders logged but sync continues
- [ ] 401 errors mark token inactive
- [ ] Rate limiting handled with backoff

### State Tracking
- [ ] Sync state tracked in `pulse_sync_state`
- [ ] Sync logs created in `pulse_sync_logs`
- [ ] `last_successful_sync_at` only updated on success
- [ ] `last_full_sync_at` only updated on full sync success

### API Endpoints
- [ ] POST `/api/sync/clickup` returns immediately with syncId
- [ ] GET `/api/sync/clickup/status` returns current state
- [ ] GET `/api/sync/clickup/status/:syncId` returns specific sync
- [ ] GET `/api/sync/clickup/logs` returns recent logs

---

## Summary

The key concepts of this sync system are:

1. **Pull-based** - No webhooks, scheduled polling via cron
2. **Detached execution** - API returns immediately, sync runs in background
3. **Soft deletes** - Track `last_seen_at`, mark deleted after 7 days
4. **Status mapping** - Different mappings per list type
5. **Batch processing** - 50 tasks at a time to avoid overwhelming DB
6. **Error resilience** - Skip failed folders, continue with rest
7. **State tracking** - Full audit trail of sync operations

---

*Generated from Pulse v1 codebase analysis - January 2025*
