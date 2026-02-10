/**
 * Types for the AI deliverable generation system.
 *
 * Flow: user triggers generation -> backend assembles context from
 * contract knowledge base -> submits to Master Marketer -> polls for
 * completion -> writes result back to deliverable content fields.
 */

// ============================================================================
// Submission Payload
// ============================================================================

/** Payload sent to Master Marketer /api/intake/deliverable */
export interface DeliverableSubmission {
  deliverable_type: string;
  contract_id: string;
  title: string;
  instructions?: string;
  context: DeliverableContext;
  metadata?: Record<string, unknown>;
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
      | 'polling'
      | 'completed'
      | 'failed';
    job_id?: string;
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
