// Management report types for pulse_management_reports table

export type ReportType = 'weekly' | 'monthly' | 'quarterly';
export type ReportStatus = 'generating' | 'completed' | 'failed';
export type ReportTrigger = 'manual' | 'scheduled';

export const REPORT_TYPE_VALUES: ReportType[] = ['weekly', 'monthly', 'quarterly'];
export const REPORT_STATUS_VALUES: ReportStatus[] = ['generating', 'completed', 'failed'];
export const REPORT_TRIGGER_VALUES: ReportTrigger[] = ['manual', 'scheduled'];

export function isValidReportType(value: string): value is ReportType {
  return REPORT_TYPE_VALUES.includes(value as ReportType);
}

export function isValidReportStatus(value: string): value is ReportStatus {
  return REPORT_STATUS_VALUES.includes(value as ReportStatus);
}

export function isValidReportTrigger(value: string): value is ReportTrigger {
  return REPORT_TRIGGER_VALUES.includes(value as ReportTrigger);
}

// Summary counts for the whole report
export interface ReportSummary {
  total_contracts: number;
  on_track: number;
  off_track: number;
}

// Financial snapshot from contract_performance_view
export interface ContractFinancials {
  mrr: number | null;
  monthly_points_allotment: number | null;
  points_purchased: number | null;
  points_credited: number | null;
  points_delivered: number | null;
  points_working: number | null;
  points_balance: number | null;
  points_burden: number | null;
}

// Single meeting entry within 90-day window
export interface ReportMeetingEntry {
  meeting_id: string;
  meeting_date: string;
  title: string | null;
  sentiment_label: 'positive' | 'neutral' | 'negative';
  sentiment_confidence: number;
  bullets: string[];
}

// Weekly point production bucket (13 weeks over 90 days)
export interface PointProductionWeek {
  week_start: string; // YYYY-MM-DD
  week_end: string;   // YYYY-MM-DD
  points_delivered: number;
}

// Full per-contract snapshot stored in the contracts JSONB array
export interface ReportContractSnapshot {
  contract_id: string;
  contract_name: string;
  contract_number: string | null;
  priority: string | null;
  delivery_status: string | null;
  account_manager_name: string | null;
  team_manager_name: string | null;
  financials: ContractFinancials;
  meetings_90d: ReportMeetingEntry[];
  point_production_90d: PointProductionWeek[];
}

// Full database record
export interface ManagementReport {
  report_id: string;
  report_type: ReportType;
  generated_at: string;
  period_start: string;
  period_end: string;
  triggered_by: ReportTrigger;
  triggered_by_user_id: string | null;
  summary: ReportSummary | null;
  contracts: ReportContractSnapshot[] | null;
  status: ReportStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// Lightweight list version (excludes the large contracts JSONB)
export interface ManagementReportListItem {
  report_id: string;
  report_type: ReportType;
  generated_at: string;
  period_start: string;
  period_end: string;
  triggered_by: ReportTrigger;
  triggered_by_user_id: string | null;
  summary: ReportSummary | null;
  status: ReportStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
