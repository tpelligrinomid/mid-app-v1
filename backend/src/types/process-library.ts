export interface ProcessLibraryItem {
  process_id: string;
  clickup_task_id: string;
  name: string;
  description: string | null;
  points: number | null;
  time_estimate_ms: number | null;
  phase: string | null;
  phase_order: number | null;
  /** ClickUp list name — a grouping ("Templates", "Assets", client names). */
  category: string | null;
  /** ClickUp "Service Category" dropdown label — the delivery taxonomy. */
  service_category: string | null;
  clickup_folder_id: string | null;
  clickup_list_id: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}
