import { select, insert, update } from '../../utils/edge-functions.js';
import type {
  ClientReportConfig,
  StatusReportPayload,
  StatusReportTask,
  StatusReportPointsSummary,
} from '../../types/client-reports.js';

// ============================================================================
// Raw DB row interfaces
// ============================================================================

interface ContractRow {
  contract_id: string;
  contract_name: string;
  external_id: string | null;
}

interface PointsSummaryRow {
  contract_id: string;
  points_purchased: number | null;
  points_credited: number | null;
  points_delivered: number | null;
  points_working: number | null;
  points_balance: number | null;
}

interface TaskRow {
  name: string;
  status: string;
  points: number | null;
  due_date: string | null;
  date_done: string | null;
}

// ============================================================================
// Result types
// ============================================================================

interface GenerateResult {
  reportId: string;
  subject: string;
  recipientCount: number;
}

interface ProcessResult {
  processed: number;
  failed: number;
  errors: string[];
}

// ============================================================================
// Service
// ============================================================================

export class ClientStatusReportService {

  /**
   * Generate and send a status report for a given config
   */
  async generateAndSend(configId: string): Promise<GenerateResult> {
    // 1. Fetch config
    const configs = await select<ClientReportConfig[]>(
      'compass_report_configs',
      {
        filters: { config_id: configId },
        limit: 1,
      }
    );

    if (!configs || configs.length === 0) {
      throw new Error(`Report config not found: ${configId}`);
    }

    const config = configs[0];
    console.log(`[StatusReport] Generating for config ${configId}, contract ${config.contract_id}`);

    // 2. Fetch contract details
    const contracts = await select<ContractRow[]>(
      'contracts',
      {
        select: 'contract_id,contract_name,external_id',
        filters: { contract_id: config.contract_id },
        limit: 1,
      }
    );

    if (!contracts || contracts.length === 0) {
      throw new Error(`Contract not found: ${config.contract_id}`);
    }

    const contract = contracts[0];

    // 3. Fetch points summary
    const pointsRows = await select<PointsSummaryRow[]>(
      'contract_points_summary',
      {
        select: 'contract_id,points_purchased,points_credited,points_delivered,points_working,points_balance',
        filters: { contract_id: config.contract_id },
        limit: 1,
      }
    );

    const points = pointsRows?.[0];
    const pointsSummary: StatusReportPointsSummary = {
      purchased: Number(points?.points_purchased) || 0,
      credited: Number(points?.points_credited) || 0,
      delivered: Number(points?.points_delivered) || 0,
      working: Number(points?.points_working) || 0,
      balance: Number(points?.points_balance) || 0,
    };

    // 4. Calculate date boundaries
    const today = new Date();
    const lookbackDate = new Date(today);
    lookbackDate.setDate(lookbackDate.getDate() - config.lookback_days);
    const lookaheadDate = new Date(today);
    lookaheadDate.setDate(lookaheadDate.getDate() + config.lookahead_days);

    // Shared base filters — match Compass client view exactly:
    // non-internal, non-deleted, non-archived, parent tasks only (no subtasks)
    const baseFilters = {
      contract_id: config.contract_id,
      is_internal_only: false,
      is_deleted: false,
      is_archived: false,
      parent_task_id: { is: null },
    };

    // 4a. Completed tasks: delivered within lookback window (any list type)
    const completedTasks = await select<TaskRow[]>(
      'pulse_tasks',
      {
        select: 'name,status,points,due_date,date_done',
        filters: {
          ...baseFilters,
          status: 'delivered',
          date_done: { gte: lookbackDate.toISOString() },
        },
        order: [{ column: 'date_done', ascending: false }],
      }
    );

    // 4b. Working tasks: Deliverables only, due within lookahead window
    const workingTasks = await select<TaskRow[]>(
      'pulse_tasks',
      {
        select: 'name,status,points,due_date,date_done',
        filters: {
          ...baseFilters,
          status: 'working',
          list_type: 'Deliverables',
          due_date: { lte: lookaheadDate.toISOString() },
        },
        order: [{ column: 'due_date', ascending: true }],
      }
    );

    // 4c. Waiting on client: ToDos list with status_raw = 'waiting on client'
    const blockedTasks = await select<TaskRow[]>(
      'pulse_tasks',
      {
        select: 'name,status,points,due_date,date_done',
        filters: {
          ...baseFilters,
          status_raw: 'waiting on client',
          list_type: 'ToDos',
        },
        order: [{ column: 'due_date', ascending: true }],
      }
    );

    // 5. Build payload
    const mapTask = (t: TaskRow): StatusReportTask => ({
      name: t.name,
      due_date: t.due_date,
      date_done: t.date_done,
      points: t.points !== null ? Number(t.points) : null,
    });

    const payload: StatusReportPayload = {
      contract_name: contract.contract_name,
      contract_number: contract.external_id,
      lookback_days: config.lookback_days,
      lookahead_days: config.lookahead_days,
      generated_at: today.toISOString(),
      points_summary: pointsSummary,
      waiting_on_client: (blockedTasks || []).map(mapTask),
      working_on: (workingTasks || []).map(mapTask),
      completed: (completedTasks || []).map(mapTask),
    };

    // 6. Generate email HTML
    const html = renderStatusReportHtml(payload);
    const subject = `Status Report: ${contract.contract_name}${contract.external_id ? ` — ${contract.external_id}` : ''}`;

    // 7. Calculate period boundaries for the report record
    const periodStart = lookbackDate.toISOString().split('T')[0];
    const periodEnd = lookaheadDate.toISOString().split('T')[0];

    // 8. Insert compass_reports row
    const reportRows = await insert<Array<{ report_id: string }>>(
      'compass_reports',
      {
        contract_id: config.contract_id,
        report_type: 'status_report',
        period_start: periodStart,
        period_end: periodEnd,
        subject,
        content_html: html,
        payload,
        recipients: config.recipients,
        send_status: 'queued',
      },
      { select: 'report_id' }
    );

    const reportId = reportRows[0].report_id;
    console.log(`[StatusReport] Created report ${reportId}, sending to ${config.recipients.length} recipients`);

    // 9. Send via n8n webhook
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      await update(
        'compass_reports',
        { send_status: 'failed' },
        { report_id: reportId }
      );
      throw new Error('N8N_WEBHOOK_URL is not configured');
    }

    try {
      const webhookPayload = {
        email_type: 'status_report',
        to: config.recipients,
        data: {
          subject,
          html,
        },
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Webhook returned ${response.status}: ${errorText.substring(0, 200)}`);
      }

      // 10. Mark as sent
      await update(
        'compass_reports',
        {
          send_status: 'sent',
          sent_at: new Date().toISOString(),
        },
        { report_id: reportId }
      );

      console.log(`[StatusReport] Report ${reportId} sent successfully`);
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unknown send error';
      console.error(`[StatusReport] Failed to send report ${reportId}:`, message);

      await update(
        'compass_reports',
        { send_status: 'failed' },
        { report_id: reportId }
      );

      throw sendError;
    }

    // 11. Update config's last_run_at and next_run_at
    const nextRunAt = computeNextRunAt(config);
    await update(
      'compass_report_configs',
      {
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt,
      },
      { config_id: configId }
    );

    return { reportId, subject, recipientCount: config.recipients.length };
  }

  /**
   * Process all scheduled reports that are due
   */
  async processScheduledReports(): Promise<ProcessResult> {
    const now = new Date().toISOString();

    // Find all enabled configs where next_run_at <= now
    const dueConfigs = await select<ClientReportConfig[]>(
      'compass_report_configs',
      {
        filters: {
          enabled: true,
          next_run_at: { lte: now },
        },
      }
    );

    if (!dueConfigs || dueConfigs.length === 0) {
      console.log('[StatusReport] No scheduled reports due');
      return { processed: 0, failed: 0, errors: [] };
    }

    console.log(`[StatusReport] Found ${dueConfigs.length} scheduled reports to process`);

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const config of dueConfigs) {
      try {
        await this.generateAndSend(config.config_id);
        processed++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Config ${config.config_id}: ${message}`);
        console.error(`[StatusReport] Failed to process config ${config.config_id}:`, message);
      }
    }

    console.log(`[StatusReport] Processing complete: ${processed} sent, ${failed} failed`);
    return { processed, failed, errors };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute the next run time based on cadence, day, send_time, and timezone.
 * Returns an ISO string in UTC.
 */
export function computeNextRunAt(config: ClientReportConfig): string {
  const now = new Date();

  // Parse send_time (HH:MM:SS)
  const [hours, minutes] = config.send_time.split(':').map(Number);

  // We compute in UTC and offset by the timezone.
  // For simplicity, handle common US timezone offsets.
  const tzOffsetHours = getTimezoneOffsetHours(config.timezone);

  // Convert send_time from local to UTC
  const utcHours = hours + tzOffsetHours;

  if (config.cadence === 'weekly' && config.day_of_week !== null) {
    // Find the next occurrence of the target day of week
    const targetDay = config.day_of_week; // 0=Sunday
    let next = new Date(now);
    next.setUTCHours(utcHours, minutes, 0, 0);

    // Calculate days until next target day
    const currentDay = next.getUTCDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= now) daysUntil = 7;

    next.setUTCDate(next.getUTCDate() + daysUntil);
    return next.toISOString();
  }

  if (config.cadence === 'monthly' && config.day_of_month !== null) {
    const targetDay = config.day_of_month;
    let next = new Date(now);
    next.setUTCHours(utcHours, minutes, 0, 0);
    next.setUTCDate(targetDay);

    // If we're past the target day this month, move to next month
    if (next <= now) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(targetDay);
    }

    return next.toISOString();
  }

  // Fallback: 1 hour from now
  const fallback = new Date(now.getTime() + 60 * 60 * 1000);
  return fallback.toISOString();
}

/**
 * Get approximate UTC offset for common IANA timezones.
 * Returns positive number = hours to ADD to local to get UTC.
 * (e.g. America/New_York = +5 in EST, +4 in EDT)
 */
function getTimezoneOffsetHours(timezone: string): number {
  // Use a reference date to compute the actual offset
  try {
    const now = new Date();
    const localStr = now.toLocaleString('en-US', { timeZone: timezone });
    const localDate = new Date(localStr);
    const diffMs = now.getTime() - localDate.getTime();
    return Math.round(diffMs / (1000 * 60 * 60));
  } catch {
    // Fallback to EST offset
    return 5;
  }
}

// ============================================================================
// HTML Renderer
// ============================================================================

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Render the status report as email-safe HTML
 */
function renderStatusReportHtml(payload: StatusReportPayload): string {
  const { contract_name, contract_number, lookback_days, lookahead_days, points_summary } = payload;

  const contractLabel = contract_number
    ? `${contract_name} &mdash; ${contract_number}`
    : contract_name;

  const generatedDate = formatDate(payload.generated_at);

  // Metric rows
  const metricsHtml = [
    ['Points Purchased', formatNumber(points_summary.purchased)],
    ['Points Credited', formatNumber(points_summary.credited)],
    ['Points Delivered', formatNumber(points_summary.delivered)],
    ['Points in Working', formatNumber(points_summary.working)],
    ['Points Balance', formatNumber(points_summary.balance)],
  ]
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding: 8px 16px; font-size: 14px; color: #374151; font-family: Poppins, sans-serif;">${label}</td>
          <td style="padding: 8px 16px; font-size: 14px; color: #030712; font-weight: 600; text-align: right; font-family: Poppins, sans-serif;">${value}</td>
        </tr>`
    )
    .join('');

  // Waiting on Client rows
  const waitingHtml =
    payload.waiting_on_client.length === 0
      ? `<tr><td colspan="2" style="padding: 12px 16px; font-size: 14px; color: #6b7280; font-style: italic; font-family: Poppins, sans-serif;">No items waiting on client</td></tr>`
      : payload.waiting_on_client
          .map(
            (t) =>
              `<tr>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; font-family: Poppins, sans-serif;">${escapeHtml(t.name)}</td>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; text-align: right; font-family: Poppins, sans-serif;">${formatDate(t.due_date)}</td>
              </tr>`
          )
          .join('');

  // Working On rows
  const workingHtml =
    payload.working_on.length === 0
      ? `<tr><td colspan="3" style="padding: 12px 16px; font-size: 14px; color: #6b7280; font-style: italic; font-family: Poppins, sans-serif;">No items currently in progress</td></tr>`
      : payload.working_on
          .map(
            (t) =>
              `<tr>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; font-family: Poppins, sans-serif;">${escapeHtml(t.name)}</td>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; text-align: center; font-family: Poppins, sans-serif;">${formatDate(t.due_date)}</td>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; text-align: right; font-family: Poppins, sans-serif;">${t.points !== null ? t.points : '—'}</td>
              </tr>`
          )
          .join('');

  // Completed rows
  const completedHtml =
    payload.completed.length === 0
      ? `<tr><td colspan="3" style="padding: 12px 16px; font-size: 14px; color: #6b7280; font-style: italic; font-family: Poppins, sans-serif;">No items completed in this period</td></tr>`
      : payload.completed
          .map(
            (t) =>
              `<tr>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; font-family: Poppins, sans-serif;">${escapeHtml(t.name)}</td>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; text-align: center; font-family: Poppins, sans-serif;">${formatDate(t.date_done)}</td>
                <td style="padding: 8px 16px; font-size: 14px; color: #374151; text-align: right; font-family: Poppins, sans-serif;">${t.points !== null ? t.points : '—'}</td>
              </tr>`
          )
          .join('');

  // Section header helper
  const sectionHeader = (emoji: string, title: string) =>
    `<tr>
      <td colspan="3" style="background-color: #ec4899; padding: 10px 16px; border-radius: 4px;">
        <span style="font-size: 16px; font-weight: 600; color: #ffffff; font-family: Poppins, sans-serif;">${emoji} ${title}</span>
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: Poppins, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 20px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(3,7,18,0.1), 0 2px 4px -2px rgba(3,7,18,0.1);">

          <!-- Header -->
          <tr>
            <td style="background-color: #1e293b; padding: 30px 40px; border-radius: 8px 8px 0 0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <img src="https://marketersindemand.com/wp-content/uploads/2025/11/mid-logo-scaled.png" alt="MiD - Marketers in Demand" style="height: 40px; width: auto;" />
                  </td>
                  <td style="text-align: right; vertical-align: middle;">
                    <span style="font-size: 14px; color: #94a3b8; font-family: Poppins, sans-serif;">Status Report</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Contract Info -->
          <tr>
            <td style="padding: 30px 40px 20px 40px;">
              <h1 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #030712; font-family: Poppins, sans-serif;">${contractLabel}</h1>
              <p style="margin: 0 0 4px 0; font-size: 13px; color: #6b7280; font-family: Poppins, sans-serif;">Lookback: ${lookback_days} days &nbsp;/&nbsp; Lookahead: ${lookahead_days} days</p>
              <p style="margin: 0; font-size: 13px; color: #6b7280; font-family: Poppins, sans-serif;">Generated: ${generatedDate}</p>
            </td>
          </tr>

          <!-- Summary Metrics -->
          <tr>
            <td style="padding: 0 40px 20px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${sectionHeader('&#x1F4CA;', 'Summary Metrics')}
                ${metricsHtml}
              </table>
            </td>
          </tr>

          <!-- Waiting on Client -->
          <tr>
            <td style="padding: 0 40px 20px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${sectionHeader('&#x23F3;', 'Waiting on Client')}
                <tr>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; font-family: Poppins, sans-serif;">Task</td>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; text-align: right; font-family: Poppins, sans-serif;">Due</td>
                </tr>
                ${waitingHtml}
              </table>
            </td>
          </tr>

          <!-- Working On -->
          <tr>
            <td style="padding: 0 40px 20px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${sectionHeader('&#x1F386;', "What We're Working On")}
                <tr>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; font-family: Poppins, sans-serif;">Task</td>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; text-align: center; font-family: Poppins, sans-serif;">Due</td>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; text-align: right; font-family: Poppins, sans-serif;">Points</td>
                </tr>
                ${workingHtml}
              </table>
            </td>
          </tr>

          <!-- Completed -->
          <tr>
            <td style="padding: 0 40px 20px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${sectionHeader('&#x2705;', 'Completed')}
                <tr>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; font-family: Poppins, sans-serif;">Task</td>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; text-align: center; font-family: Poppins, sans-serif;">Completed</td>
                  <td style="padding: 6px 16px; font-size: 12px; font-weight: 600; color: #9ca3af; text-transform: uppercase; text-align: right; font-family: Poppins, sans-serif;">Points</td>
                </tr>
                ${completedHtml}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8fafc; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 13px; color: #6b7280; font-family: Poppins, sans-serif;">This report was generated automatically from Pulse by Marketers in Demand.</p>
            </td>
          </tr>

        </table>
        <p style="margin: 30px 0 0 0; font-size: 12px; color: #9ca3af; font-family: Poppins, sans-serif;">&copy; ${new Date().getFullYear()} Marketers in Demand. All rights reserved.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
