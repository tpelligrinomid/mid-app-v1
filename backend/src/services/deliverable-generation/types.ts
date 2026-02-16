/**
 * Types for the AI deliverable generation system.
 *
 * Flow: user triggers generation -> backend assembles context from
 * contract knowledge base -> submits to Master Marketer with callback_url
 * -> MM calls webhook when done -> webhook writes result back to deliverable.
 */

// ============================================================================
// Submission Payload
// ============================================================================

/** Payload sent to Master Marketer /api/intake/{type} */
export interface DeliverableSubmission {
  deliverable_type: string;
  contract_id: string;
  title: string;
  instructions?: string;
  client?: CompanyProfile;
  competitors?: CompanyProfile[];
  context?: Record<string, unknown>;
  knowledge_base?: DeliverableContext;
  callback_url?: string;
  metadata?: Record<string, unknown>;
  /** Optional prior roadmap output — MM evolves from this instead of cold-starting */
  previous_roadmap?: Record<string, unknown>;
  /** SEO audit: topic seeds for crawl prioritization */
  seed_topics?: string[];
  /** SEO audit: max pages to crawl per domain */
  max_crawl_pages?: number;
  /** SEO audit: prior research report for context */
  research_context?: { full_document_markdown: string; competitive_scores: Record<string, unknown> };
  /** Content plan: full roadmap output as input context */
  roadmap?: Record<string, unknown>;
  /** Content plan: full SEO audit output as input context */
  seo_audit?: Record<string, unknown>;
  /** Content plan: research report context */
  research?: { full_document_markdown: string; competitive_scores: Record<string, unknown> };
  /** Content plan: meeting transcripts */
  transcripts?: string[];
  /** Content plan: prior content plan for quarterly iteration */
  previous_content_plan?: Record<string, unknown>;
  /** Roadmap: process library items (MM expects task/description/stage/points) */
  process_library?: Array<{ task: string; description: string; stage: string; points: number }>;
  /** Roadmap: monthly points budget from contract */
  points_budget?: number;
}

/** Shared shape for client and each competitor */
export interface CompanyProfile {
  company_name: string;
  domain: string;
  linkedin_handle?: string;
  youtube_channel_id?: string;
}

/** Strategist-provided research inputs for the generate request */
export interface ResearchInputs {
  client: CompanyProfile;
  competitors?: CompanyProfile[];
}

export interface DeliverableContext {
  /** Full transcript included — user-selected key meetings */
  primary_meetings: Array<{
    title: string;
    date: string;
    transcript: string;
    participants: string[];
  }>;
  /** Summary only — background context */
  other_meetings: Array<{
    title: string;
    date: string;
    summary?: string;
    key_topics?: string[];
  }>;
  notes: Array<{ title: string; content: string; date: string }>;
  processes: Array<{
    name: string;
    phase: string;
    points: number | null;
    description: string | null;
  }>;
}

// ============================================================================
// Request DTOs
// ============================================================================

/** Request body for POST /deliverables/:id/generate */
export interface GenerateDeliverableRequest {
  instructions?: string;
  primary_meeting_ids?: string[];
  research_inputs?: ResearchInputs;
  /** Explicit prior roadmap ID to evolve from. If omitted, auto-detects the latest completed roadmap for the contract. */
  previous_roadmap_id?: string;
  /** SEO audit: topic seeds for crawl prioritization */
  seed_topics?: string[];
  /** SEO audit: max pages to crawl per domain */
  max_crawl_pages?: number;
}

/** Request body for POST /deliverables/:id/convert */
export interface ConvertDeliverableRequest {
  content?: string;
  file_url?: string;
  context: {
    contract_name: string;
    industry: string;
    additional_notes?: string;
  };
}

/** Payload sent to Master Marketer /api/intake/{type} for reformatting */
export interface DeliverableConvertSubmission {
  content?: string;
  file_url?: string;
  context: {
    contract_name: string;
    industry: string;
    additional_notes?: string;
  };
  callback_url?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// AI Output Shapes
// ============================================================================

/** AI output structure for Research deliverable */
export interface ResearchOutput {
  executive_summary: string;
  sections: Array<{ heading: string; content: string }>;
  recommendations: string[];
  sources_referenced: string[];
}

// ============================================================================
// Generation State (stored in compass_deliverables.metadata)
// ============================================================================

export interface GenerationState {
  generation?: {
    status:
      | 'pending'
      | 'assembling_context'
      | 'submitted'
      | 'completed'
      | 'failed';
    job_id?: string;
    trigger_run_id?: string;
    submitted_at?: string;
    completed_at?: string;
    error?: string;
    context_summary?: {
      meetings_count: number;
      notes_count: number;
      processes_count: number;
    };
  };
}

// ============================================================================
// Webhook Callback Payload (from Master Marketer)
// ============================================================================

/** Body POSTed by Master Marketer to our webhook when a job completes */
export interface WebhookCallbackPayload {
  job_id: string;
  status: 'completed' | 'failed';
  deliverable_id: string;
  contract_id: string;
  title: string;
  output?: {
    content_raw: string;
    content_structured: Record<string, unknown>;
  };
  error?: string;
}
