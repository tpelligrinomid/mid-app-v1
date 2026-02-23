/**
 * Types for Content Ingestion Pipelines
 *
 * Blog URL bulk ingestion, file upload extraction, and shared batch tracking.
 */

export interface IngestionBatch {
  batch_id: string;
  contract_id: string;
  total: number;
  completed: number;
  failed: number;
  status: 'in_progress' | 'completed' | 'completed_with_errors';
  options: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface IngestionItem {
  item_id: string;
  batch_id: string;
  contract_id: string;
  url: string;
  status: 'submitted' | 'scraped' | 'asset_created' | 'categorized' | 'failed';
  job_id: string | null;
  trigger_run_id: string | null;
  asset_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogScrapeSubmission {
  url: string;
  callback_url?: string;
  metadata: {
    batch_id: string;
    item_id: string;
    contract_id: string;
  };
}

export interface BlogScrapeCallbackPayload {
  job_id: string;
  status: 'completed' | 'failed';
  metadata: {
    batch_id: string;
    item_id: string;
    contract_id: string;
  };
  output?: {
    url: string;
    title: string;
    content_markdown: string;
    published_date?: string;
    author?: string;
    meta_description?: string;
    word_count?: number;
  };
  error?: string;
}

// ============================================================================
// File Upload Extraction Types
// ============================================================================

export interface FileExtractSubmission {
  file_url: string;
  file_name: string;
  mime_type: string;
  callback_url?: string;
  metadata: {
    asset_id: string;
    contract_id: string;
    content_type_slug?: string;
  };
}

export interface FileExtractCallbackPayload {
  job_id: string;
  status: 'completed' | 'failed';
  metadata: {
    asset_id: string;
    contract_id: string;
    content_type_slug?: string;
  };
  output?: {
    content_markdown: string;
    title?: string;
    word_count?: number;
    page_count?: number;
    extraction_method?: string;
  };
  error?: string;
}
