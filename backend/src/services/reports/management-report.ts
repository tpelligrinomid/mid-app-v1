import { insert, update, select } from '../../utils/edge-functions.js';
import type {
  ReportTrigger,
  ReportSummary,
  ContractFinancials,
  ReportMeetingEntry,
  PointProductionWeek,
  ReportContractSnapshot,
  ManagementReport,
} from '../../types/reports.js';

// Raw row from contracts table
interface ContractRow {
  contract_id: string;
  contract_name: string;
  external_id: string | null;
  priority: string | null;
  amount: number | null;
  monthly_points_allotment: number | null;
  account_manager: string | null;
  team_manager: string | null;
}

// Raw row from contract_points_summary materialized view
interface PointsSummaryRow {
  contract_id: string;
  points_purchased: number | null;
  points_credited: number | null;
  points_delivered: number | null;
  points_working: number | null;
  points_balance: number | null;
  points_burden: number | null;
}

// Raw row from pulse_clickup_users
interface ClickUpUserRow {
  id: string;
  full_name: string | null;
}

// Raw meeting row
interface MeetingRow {
  meeting_id: string;
  meeting_date: string;
  title: string | null;
  sentiment: {
    label: 'positive' | 'neutral' | 'negative';
    confidence: number;
    bullets: string[];
  } | null;
}

// Raw task row
interface TaskRow {
  points: number | null;
  date_done: string | null;
  updated_at: string;
}

interface GenerateOptions {
  triggeredBy: ReportTrigger;
  userId?: string;
  reportType?: 'weekly' | 'monthly' | 'quarterly';
}

interface GenerateResult {
  reportId: string;
  summary: ReportSummary;
}

export class ManagementReportService {

  async generateReport(options: GenerateOptions): Promise<GenerateResult> {
    const { triggeredBy, userId, reportType = 'weekly' } = options;

    // 1. Calculate period: 90 days back from today
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 90);

    const periodEndStr = periodEnd.toISOString().split('T')[0];
    const periodStartStr = periodStart.toISOString().split('T')[0];

    console.log(`[Management Report] Starting generation (${triggeredBy}), period ${periodStartStr} to ${periodEndStr}`);

    // 2. Insert placeholder row
    const placeholderData: Record<string, unknown> = {
      report_type: reportType,
      generated_at: new Date().toISOString(),
      period_start: periodStartStr,
      period_end: periodEndStr,
      triggered_by: triggeredBy,
      status: 'generating',
    };
    if (userId) {
      placeholderData.triggered_by_user_id = userId;
    }

    const inserted = await insert<ManagementReport[]>(
      'pulse_management_reports',
      placeholderData,
      { select: 'report_id' }
    );

    const reportId = inserted[0].report_id;
    console.log(`[Management Report] Created placeholder row: ${reportId}`);

    try {
      // 3. Fetch data from three separate tables and join in TypeScript

      // 3a. Active non-hosting contracts
      const contractRows = await select<ContractRow[]>(
        'contracts',
        {
          select: 'contract_id,contract_name,external_id,priority,amount,monthly_points_allotment,account_manager,team_manager',
          filters: {
            contract_status: 'active',
            hosting: false,
          },
        }
      );

      console.log(`[Management Report] Found ${contractRows.length} active contracts`);

      // 3b. Points summaries for all contracts (materialized view)
      const pointsRows = await select<PointsSummaryRow[]>(
        'contract_points_summary',
        {
          select: 'contract_id,points_purchased,points_credited,points_delivered,points_working,points_balance,points_burden',
        }
      );
      const pointsMap = new Map(pointsRows.map((p) => [p.contract_id, p]));

      // 3c. ClickUp users for manager name lookups
      const managerIds = new Set<string>();
      for (const c of contractRows) {
        if (c.account_manager) managerIds.add(c.account_manager);
        if (c.team_manager) managerIds.add(c.team_manager);
      }
      const usersMap = new Map<string, string>();
      if (managerIds.size > 0) {
        const userRows = await select<ClickUpUserRow[]>(
          'pulse_clickup_users',
          {
            select: 'id,full_name',
            filters: { id: { in: Array.from(managerIds) } },
          }
        );
        for (const u of userRows) {
          if (u.full_name) usersMap.set(u.id, u.full_name);
        }
      }

      // 4. Build snapshots for each contract
      const snapshots: ReportContractSnapshot[] = [];

      for (let i = 0; i < contractRows.length; i++) {
        const contract = contractRows[i];
        const points = pointsMap.get(contract.contract_id);
        console.log(`[Management Report] Processing ${i + 1}/${contractRows.length}: ${contract.contract_name}`);

        // 4a. Fetch meetings with sentiment in the 90-day window
        const meetings = await select<MeetingRow[]>(
          'compass_meetings',
          {
            select: 'meeting_id,meeting_date,title,sentiment',
            filters: {
              contract_id: contract.contract_id,
              meeting_date: { gte: periodStart.toISOString() },
              sentiment: { neq: null },
            },
            order: [{ column: 'meeting_date', ascending: true }],
          }
        );

        const meetingEntries: ReportMeetingEntry[] = meetings.map((m) => ({
          meeting_id: m.meeting_id,
          meeting_date: m.meeting_date,
          title: m.title,
          sentiment_label: m.sentiment!.label,
          sentiment_confidence: m.sentiment!.confidence,
          bullets: m.sentiment!.bullets || [],
        }));

        // 4b. Fetch delivered tasks in the 90-day window
        const tasks = await select<TaskRow[]>(
          'pulse_tasks',
          {
            select: 'points,date_done,updated_at',
            filters: {
              contract_id: contract.contract_id,
              status: 'delivered',
              date_done: { gte: periodStart.toISOString() },
            },
          }
        );

        // 4c. Bucket tasks into 13 weekly Monday-Sunday buckets
        const weeklyBuckets = buildWeeklyBuckets(periodStart, periodEnd, tasks);

        // 4d. Assemble snapshot
        const burden = Number(points?.points_burden) || 0;
        const deliveryStatus = burden <= 0 ? 'on-track' : 'off-track';

        const financials: ContractFinancials = {
          mrr: contract.amount,
          monthly_points_allotment: contract.monthly_points_allotment,
          points_purchased: points?.points_purchased ?? null,
          points_credited: points?.points_credited ?? null,
          points_delivered: points?.points_delivered ?? null,
          points_working: points?.points_working ?? null,
          points_balance: points?.points_balance ?? null,
          points_burden: points?.points_burden ?? null,
        };

        snapshots.push({
          contract_id: contract.contract_id,
          contract_name: contract.contract_name,
          contract_number: contract.external_id,
          priority: contract.priority,
          delivery_status: deliveryStatus,
          account_manager_name: contract.account_manager ? (usersMap.get(contract.account_manager) ?? null) : null,
          team_manager_name: contract.team_manager ? (usersMap.get(contract.team_manager) ?? null) : null,
          financials,
          meetings_90d: meetingEntries,
          point_production_90d: weeklyBuckets,
        });
      }

      // 5. Compute summary counts
      const onTrack = snapshots.filter((s) => s.delivery_status === 'on-track').length;
      const offTrack = snapshots.filter((s) => s.delivery_status !== 'on-track').length;
      const summary: ReportSummary = {
        total_contracts: snapshots.length,
        on_track: onTrack,
        off_track: offTrack,
      };

      // 6. Update report row with completed data
      await update(
        'pulse_management_reports',
        {
          status: 'completed',
          summary,
          contracts: snapshots,
        },
        { report_id: reportId }
      );

      console.log(`[Management Report] Completed: ${summary.total_contracts} contracts (${summary.on_track} on-track, ${summary.off_track} off-track)`);

      return { reportId, summary };

    } catch (error) {
      // 7. On error: mark as failed
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Management Report] Failed:`, error);

      await update(
        'pulse_management_reports',
        {
          status: 'failed',
          error_message: message,
        },
        { report_id: reportId }
      );

      throw error;
    }
  }
}

/**
 * Build 13 weekly Monday-Sunday buckets and sum delivered points per week.
 */
function buildWeeklyBuckets(
  periodStart: Date,
  periodEnd: Date,
  tasks: TaskRow[]
): PointProductionWeek[] {
  const buckets: PointProductionWeek[] = [];

  // Find the first Monday on or after periodStart
  const start = new Date(periodStart);
  const dayOfWeek = start.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysUntilMonday = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
  start.setUTCDate(start.getUTCDate() + daysUntilMonday);
  start.setUTCHours(0, 0, 0, 0);

  // Generate up to 13 weekly buckets
  for (let i = 0; i < 13; i++) {
    const weekStart = new Date(start);
    weekStart.setUTCDate(start.getUTCDate() + i * 7);

    if (weekStart > periodEnd) break;

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    buckets.push({
      week_start: weekStart.toISOString().split('T')[0],
      week_end: weekEnd.toISOString().split('T')[0],
      points_delivered: 0,
    });
  }

  // Sum points into buckets
  for (const task of tasks) {
    const taskDate = task.date_done ? new Date(task.date_done) : new Date(task.updated_at);
    const taskDateStr = taskDate.toISOString().split('T')[0];
    const points = Number(task.points) || 0;

    for (const bucket of buckets) {
      if (taskDateStr >= bucket.week_start && taskDateStr <= bucket.week_end) {
        bucket.points_delivered += points;
        break;
      }
    }
  }

  return buckets;
}
