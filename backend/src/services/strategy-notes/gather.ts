/**
 * Strategy Notes — Data Gathering
 *
 * Queries all existing data sources for a contract:
 * - Contract info (name, priority, allotment, managers)
 * - Points summary (materialized view)
 * - Tasks in progress and recently completed
 * - Recent meetings with sentiment
 * - Recent notes for context
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
  total_purchased: number;
  total_credited: number;
  total_delivered: number;
  total_working: number;
  balance: number;
  burden: number;
}

export interface TaskInfo {
  name: string;
  points: number | null;
  status: string;
  date_done: string | null;
  clickup_list_name: string | null;
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
  const lookbackDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  // Run all queries in parallel
  const [contract, points, workingTasks, completedTasks, meetings, recentNotes] = await Promise.all([
    // 1. Contract info
    select<ContractInfo>('contracts', {
      select: 'contract_id, contract_name, priority, monthly_points_allotment, account_manager, team_manager',
      filters: { contract_id: contractId },
      single: true,
    }),

    // 2. Points summary (materialized view)
    select<PointsSummary[]>('contract_points_summary', {
      select: 'contract_id, total_purchased, total_credited, total_delivered, total_working, balance, burden',
      filters: { contract_id: contractId },
      limit: 1,
    }).then((rows) => (rows && rows.length > 0 ? rows[0] : null))
      .catch(() => null),

    // 3. Tasks in progress
    select<TaskInfo[]>('pulse_tasks', {
      select: 'name, points, status, date_done, clickup_list_name',
      filters: {
        contract_id: contractId,
        status: 'working',
      },
      order: [{ column: 'points', ascending: false }],
      limit: 50,
    }).catch(() => []),

    // 4. Recently completed tasks
    select<TaskInfo[]>('pulse_tasks', {
      select: 'name, points, status, date_done, clickup_list_name',
      filters: {
        contract_id: contractId,
        status: 'delivered',
        date_done: { gte: lookbackDate.split('T')[0] },
      },
      order: [{ column: 'date_done', ascending: false }],
      limit: 50,
    }).catch(() => []),

    // 5. Recent meetings
    select<MeetingInfo[]>('compass_meetings', {
      select: 'meeting_id, title, meeting_date, sentiment',
      filters: {
        contract_id: contractId,
        meeting_date: { gte: lookbackDate.split('T')[0] },
      },
      order: [{ column: 'meeting_date', ascending: false }],
      limit: 10,
    }).catch(() => []),

    // 6. Recent notes for context
    select<RecentNote[]>('compass_notes', {
      select: 'note_id, title, note_type, note_date, content_raw',
      filters: {
        contract_id: contractId,
        note_date: { gte: lookbackDate.split('T')[0] },
      },
      order: [{ column: 'note_date', ascending: false }],
      limit: 5,
    }).catch(() => []),
  ]);

  // Truncate note content to avoid sending too much to Claude
  const truncatedNotes = (recentNotes || []).map((n) => ({
    ...n,
    content_raw: n.content_raw ? n.content_raw.substring(0, 500) : null,
  }));

  return {
    contract,
    points,
    tasks_in_progress: workingTasks || [],
    tasks_completed: completedTasks || [],
    meetings: meetings || [],
    recent_notes: truncatedNotes,
  };
}
