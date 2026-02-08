// Client status report types for compass_report_configs and compass_reports tables

// ============================================================================
// Cadence
// ============================================================================

export type ReportCadence = 'weekly' | 'monthly';

export const REPORT_CADENCE_VALUES: ReportCadence[] = ['weekly', 'monthly'];

export function isValidReportCadence(value: string): value is ReportCadence {
  return REPORT_CADENCE_VALUES.includes(value as ReportCadence);
}

// ============================================================================
// Report Config (compass_report_configs table)
// ============================================================================

export interface ClientReportConfig {
  config_id: string;
  contract_id: string;
  enabled: boolean;
  cadence: ReportCadence;
  day_of_week: number | null;
  day_of_month: number | null;
  send_time: string;        // HH:MM:SS
  timezone: string;
  lookback_days: number;
  lookahead_days: number;
  recipients: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Config Input DTOs
// ============================================================================

export interface ClientReportConfigInput {
  contract_id: string;
  enabled?: boolean;
  cadence: ReportCadence;
  day_of_week?: number | null;
  day_of_month?: number | null;
  send_time: string;
  timezone?: string;
  lookback_days?: number;
  lookahead_days?: number;
  recipients: string[];
}

export interface ClientReportConfigUpdate {
  enabled?: boolean;
  cadence?: ReportCadence;
  day_of_week?: number | null;
  day_of_month?: number | null;
  send_time?: string;
  timezone?: string;
  lookback_days?: number;
  lookahead_days?: number;
  recipients?: string[];
}

// ============================================================================
// Status Report Payload (stored in compass_reports.payload)
// ============================================================================

export interface StatusReportTask {
  name: string;
  due_date: string | null;
  date_done: string | null;
  points: number | null;
}

export interface StatusReportPointsSummary {
  purchased: number;
  credited: number;
  delivered: number;
  working: number;
  balance: number;
}

export interface StatusReportPayload {
  contract_name: string;
  contract_number: string | null;
  lookback_days: number;
  lookahead_days: number;
  generated_at: string;
  points_summary: StatusReportPointsSummary;
  waiting_on_client: StatusReportTask[];
  working_on: StatusReportTask[];
  completed: StatusReportTask[];
}

// ============================================================================
// Compass Report Record (compass_reports table row)
// ============================================================================

export interface CompassReport {
  report_id: string;
  contract_id: string;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  subject: string | null;
  content_html: string | null;
  content_text: string | null;
  payload: StatusReportPayload | null;
  recipients: string[] | null;
  send_status: string;
  sent_at: string | null;
  created_at: string;
}

export interface CompassReportListItem {
  report_id: string;
  contract_id: string;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  subject: string | null;
  recipients: string[] | null;
  send_status: string;
  sent_at: string | null;
  created_at: string;
}

// ============================================================================
// Validation
// ============================================================================

export function validateReportConfigInput(input: ClientReportConfigInput): string[] {
  const errors: string[] = [];

  if (!input.contract_id) {
    errors.push('contract_id is required');
  }

  if (!input.cadence || !isValidReportCadence(input.cadence)) {
    errors.push(`cadence must be one of: ${REPORT_CADENCE_VALUES.join(', ')}`);
  }

  if (input.cadence === 'weekly') {
    if (input.day_of_week === undefined || input.day_of_week === null) {
      errors.push('day_of_week is required for weekly cadence');
    } else if (input.day_of_week < 0 || input.day_of_week > 6) {
      errors.push('day_of_week must be 0-6 (0=Sunday)');
    }
  }

  if (input.cadence === 'monthly') {
    if (input.day_of_month === undefined || input.day_of_month === null) {
      errors.push('day_of_month is required for monthly cadence');
    } else if (input.day_of_month < 1 || input.day_of_month > 28) {
      errors.push('day_of_month must be 1-28');
    }
  }

  if (!input.send_time) {
    errors.push('send_time is required');
  }

  if (!input.recipients || !Array.isArray(input.recipients) || input.recipients.length === 0) {
    errors.push('recipients must be a non-empty array of email addresses');
  }

  if (input.lookback_days !== undefined && (input.lookback_days < 1 || input.lookback_days > 365)) {
    errors.push('lookback_days must be between 1 and 365');
  }

  if (input.lookahead_days !== undefined && (input.lookahead_days < 1 || input.lookahead_days > 365)) {
    errors.push('lookahead_days must be between 1 and 365');
  }

  return errors;
}
