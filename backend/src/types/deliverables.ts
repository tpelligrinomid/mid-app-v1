// Deliverable types for compass_deliverables and compass_deliverable_versions tables

// ============================================================================
// Enums
// ============================================================================

export type DeliverableType = 'research' | 'roadmap' | 'seo_audit' | 'content_plan' | 'abm_plan' | 'plan' | 'brief' | 'presentation' | 'other';
export type DeliverableStatus = 'planned' | 'working' | 'waiting_on_client' | 'delivered';

export const DELIVERABLE_TYPE_VALUES: DeliverableType[] = [
  'research', 'roadmap', 'seo_audit', 'content_plan', 'abm_plan', 'plan', 'brief', 'presentation', 'other',
];
export const DELIVERABLE_STATUS_VALUES: DeliverableStatus[] = [
  'planned', 'working', 'waiting_on_client', 'delivered',
];

export function isValidDeliverableType(value: string): value is DeliverableType {
  return DELIVERABLE_TYPE_VALUES.includes(value as DeliverableType);
}

export function isValidDeliverableStatus(value: string): value is DeliverableStatus {
  return DELIVERABLE_STATUS_VALUES.includes(value as DeliverableStatus);
}

// ============================================================================
// Database record (compass_deliverables)
// ============================================================================

export interface Deliverable {
  deliverable_id: string;
  contract_id: string;
  title: string;
  deliverable_type: DeliverableType;
  status: DeliverableStatus;
  description: string | null;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
  clickup_task_id: string | null;
  drive_url: string | null;
  due_date: string | null;
  delivered_date: string | null;
  tags: string[] | null;
  metadata: Record<string, unknown> | null;
  version: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// DTOs
// ============================================================================

export interface DeliverableInput {
  contract_id: string;
  title: string;
  deliverable_type: DeliverableType;
  status?: DeliverableStatus;
  description?: string;
  content_raw?: string;
  content_structured?: Record<string, unknown>;
  clickup_task_id?: string;
  due_date?: string;
  delivered_date?: string;
}

export interface DeliverableUpdate {
  title?: string;
  deliverable_type?: DeliverableType;
  status?: DeliverableStatus;
  description?: string;
  content_raw?: string;
  content_structured?: Record<string, unknown>;
  clickup_task_id?: string | null;
  due_date?: string;
  delivered_date?: string;
}

// ============================================================================
// Version record (compass_deliverable_versions)
// ============================================================================

export interface DeliverableVersion {
  version_id: string;
  deliverable_id: string;
  version_number: string;
  drive_url: string | null;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

// ============================================================================
// List projection (no content fields for performance)
// ============================================================================

export interface DeliverableListItem {
  deliverable_id: string;
  contract_id: string;
  title: string;
  deliverable_type: DeliverableType;
  status: DeliverableStatus;
  description: string | null;
  clickup_task_id: string | null;
  due_date: string | null;
  delivered_date: string | null;
  version: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Validation
// ============================================================================

export function validateDeliverableInput(data: Partial<DeliverableInput> | DeliverableUpdate): string[] {
  const errors: string[] = [];

  if (data.deliverable_type && !isValidDeliverableType(data.deliverable_type)) {
    errors.push(`Invalid deliverable_type: ${data.deliverable_type}. Valid values: ${DELIVERABLE_TYPE_VALUES.join(', ')}`);
  }

  if (data.status && !isValidDeliverableStatus(data.status)) {
    errors.push(`Invalid status: ${data.status}. Valid values: ${DELIVERABLE_STATUS_VALUES.join(', ')}`);
  }

  if (data.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.due_date)) {
    errors.push('Invalid due_date format. Expected YYYY-MM-DD');
  }

  if (data.delivered_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.delivered_date)) {
    errors.push('Invalid delivered_date format. Expected YYYY-MM-DD');
  }

  return errors;
}
