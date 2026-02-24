/**
 * Strategy Notes — Data Gathering
 *
 * Queries all existing data sources for a contract.
 * Column names and filter patterns match the working report services
 * (management-report.ts and client-status-report.ts).
 */

import { select } from '../../utils/edge-functions.js';

// ============================================================================
// Types
// ============================================================================

export interface ContractInfo {
  contract_id: string;
  contract_name: string;
  priority: string | null;
  monthly_points_allotment: number | null;
  account_manager: string | null;
  team_manager: string | null;
}

export interface PointsSummary {
  contract_id: string;
  points_purchased: number;
  points_credited: number;
  points_delivered: number;
  points_working: number;
  points_balance: number;
  points_burden: number;
}

export interface TaskInfo {
  name: string;
  points: number | null;
  status: string;
  due_date: string | null;
  date_done: string | null;
}

export interface MeetingInfo {
  meeting_id: string;
  title: string | null;
  meeting_date: string;
  sentiment: {
    label?: string;
    confidence?: number;
    bullets?: string[];
    highlights?: string[];
    topics?: string[];
  } | null;
}

export interface RecentNote {
  note_id: string;
  title: string;
  note_type: string;
  note_date: string;
  content_raw: string | null;
}

export interface StrategyNoteData {
  contract: ContractInfo;
  points: PointsSummary | null;
  tasks_in_progress: TaskInfo[];
  tasks_completed: TaskInfo[];
  tasks_blocked: TaskInfo[];
  meetings: MeetingInfo[];
  recent_notes: RecentNote[];
}

// ============================================================================
// Data Gathering
// ============================================================================

export async function gatherStrategyNoteData(
  contractId: string,
  lookbackDays: number,
  lookaheadDays: number
): Promise<StrategyNoteData> {
  const now = new Date();
  const lookbackDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const lookaheadDate = new Date(now.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

  // Base task filters — match client-status-report.ts pattern
  const baseTaskFilters = {
    contract_id: contractId,
    is_internal_only: false,
    is_deleted: false,
    is_archived: false,
    parent_task_id: { is: null }, // Parent tasks only, no subtasks
  };

  // Run all queries in parallel
  const [contract, points, workingTasks, completedTasks, blockedTasks, meetings, recentNotes] = await Promise.all([
    // 1. Contract info
    select<ContractInfo>('contracts', {
      select: 'contract_id, contract_name, priority, monthly_points_allotment, account_manager, team_manager',
      filters: { contract_id: contractId },
      single: true,
    }),

    // 2. Points summary (materialized view) — column names match management-report.ts
    select<PointsSummary[]>('contract_points_summary', {
      select: 'contract_id, points_purchased, points_credited, points_delivered, points_working, points_balance, points_burden',
      filters: { contract_id: contractId },
      limit: 1,
    }).then((rows) => {
      if (rows && rows.length > 0) return rows[0];
      console.warn(`[StrategyNotes] No points summary found for contract ${contractId}`);
      return null;
    }).catch((err) => {
      console.error(`[StrategyNotes] Points query failed:`, err);
      return null;
    }),

    // 3. Tasks in progress — match client-status-report.ts pattern
    select<TaskInfo[]>('pulse_tasks', {
      select: 'name, points, status, due_date, date_done',
      filters: {
        ...baseTaskFilters,
        status: 'working',
        list_type: 'Deliverables',
      },
      order: [{ column: 'due_date', ascending: true }],
      limit: 50,
    }).catch((err) => {
      console.error(`[StrategyNotes] Working tasks query failed:`, err);
      return [] as TaskInfo[];
    }),

    // 4. Recently completed tasks
    select<TaskInfo[]>('pulse_tasks', {
      select: 'name, points, status, due_date, date_done',
      filters: {
        ...baseTaskFilters,
        status: 'delivered',
        date_done: { gte: lookbackDate.toISOString() },
      },
      order: [{ column: 'date_done', ascending: false }],
      limit: 50,
    }).catch((err) => {
      console.error(`[StrategyNotes] Completed tasks query failed:`, err);
      return [] as TaskInfo[];
    }),

    // 5. Blocked / waiting on client tasks
    select<TaskInfo[]>('pulse_tasks', {
      select: 'name, points, status, due_date, date_done',
      filters: {
        ...baseTaskFilters,
        status_raw: 'waiting on client',
        list_type: 'ToDos',
      },
      order: [{ column: 'due_date', ascending: true }],
      limit: 20,
    }).catch((err) => {
      console.error(`[StrategyNotes] Blocked tasks query failed:`, err);
      return [] as TaskInfo[];
    }),

    // 6. Recent meetings with sentiment
    select<MeetingInfo[]>('compass_meetings', {
      select: 'meeting_id, title, meeting_date, sentiment',
      filters: {
        contract_id: contractId,
        meeting_date: { gte: lookbackDate.toISOString().split('T')[0] },
      },
      order: [{ column: 'meeting_date', ascending: false }],
      limit: 10,
    }).catch((err) => {
      console.error(`[StrategyNotes] Meetings query failed:`, err);
      return [] as MeetingInfo[];
    }),

    // 7. Recent notes for context (exclude auto-generated strategy notes)
    select<RecentNote[]>('compass_notes', {
      select: 'note_id, title, note_type, note_date, content_raw',
      filters: {
        contract_id: contractId,
        note_date: { gte: lookbackDate.toISOString().split('T')[0] },
        note_type: { neq: 'strategy' },
      },
      order: [{ column: 'note_date', ascending: false }],
      limit: 10,
    }).catch((err) => {
      console.error(`[StrategyNotes] Notes query failed:`, err);
      return [] as RecentNote[];
    }),
  ]);

  // Truncate note content to avoid sending too much to Claude
  const truncatedNotes = (recentNotes || []).map((n) => ({
    ...n,
    content_raw: n.content_raw ? n.content_raw.substring(0, 1500) : null,
  }));

  console.log(`[StrategyNotes] Data gathered for ${contract.contract_name}: points=${points ? 'yes' : 'no'}, working=${workingTasks?.length || 0}, completed=${completedTasks?.length || 0}, blocked=${blockedTasks?.length || 0}, meetings=${meetings?.length || 0}`);

  return {
    contract,
    points,
    tasks_in_progress: workingTasks || [],
    tasks_completed: completedTasks || [],
    tasks_blocked: blockedTasks || [],
    meetings: meetings || [],
    recent_notes: truncatedNotes,
  };
}
