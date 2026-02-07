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

// Raw row from contract_performance_view
interface PerformanceViewRow {
  contract_id: string;
  contract_name: string;
  contract_number: string | null;
  priority: string | null;
  delivery_status: string | null;
  account_manager_name: string | null;
  team_manager_name: string | null;
  mrr: number | null;
  monthly_points_allotment: number | null;
  points_purchased: number | null;
  points_credited: number | null;
  points_delivered: number | null;
  points_working: number | null;
  points_balance: number | null;
  points_burden: number | null;
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
      // 3. Fetch all active non-hosting contracts from the materialized view
      const contracts = await select<PerformanceViewRow[]>(
        'contract_performance_view',
        {
          select: 'contract_id,contract_name,contract_number:external_id,priority,delivery_status,account_manager_name,team_manager_name,mrr,monthly_points_allotment,points_purchased,points_credited,points_delivered,points_working,points_balance,points_burden',
        }
      );

      console.log(`[Management Report] Found ${contracts.length} active contracts`);

      // 4. Build snapshots for each contract
      const snapshots: ReportContractSnapshot[] = [];

      for (let i = 0; i < contracts.length; i++) {
        const contract = contracts[i];
        console.log(`[Management Report] Processing ${i + 1}/${contracts.length}: ${contract.contract_name}`);

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
        const financials: ContractFinancials = {
          mrr: contract.mrr,
          monthly_points_allotment: contract.monthly_points_allotment,
          points_purchased: contract.points_purchased,
          points_credited: contract.points_credited,
          points_delivered: contract.points_delivered,
          points_working: contract.points_working,
          points_balance: contract.points_balance,
          points_burden: contract.points_burden,
        };

        snapshots.push({
          contract_id: contract.contract_id,
          contract_name: contract.contract_name,
          contract_number: contract.contract_number,
          priority: contract.priority,
          delivery_status: contract.delivery_status,
          account_manager_name: contract.account_manager_name,
          team_manager_name: contract.team_manager_name,
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
