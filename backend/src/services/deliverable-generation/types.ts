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
  knowledge_base: DeliverableContext;
  callback_url?: string;
  metadata?: Record<string, unknown>;
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
