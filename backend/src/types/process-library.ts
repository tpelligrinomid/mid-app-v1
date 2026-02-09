export interface ProcessLibraryItem {
  process_id: string;
  clickup_task_id: string;
  name: string;
  description: string | null;
  points: number | null;
  time_estimate_ms: number | null;
  phase: string | null;
  phase_order: number | null;
  category: string | null;
  clickup_folder_id: string | null;
  clickup_list_id: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}
