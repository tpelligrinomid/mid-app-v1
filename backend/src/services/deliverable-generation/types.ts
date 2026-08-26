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
  /** Program roadmap: contract blended rate, one value across every option */
  hourly_rate?: number;
  /** Program roadmap: the priced options to generate. 1-3, ascending tier order. */
  roadmap_options?: Array<{
    option_id: string;
    label: string;
    tier: string;
    programs: string[];
    program_allocation: Record<string, string>;
    monthly_budget: number;
    technology_monthly: number;
    technology_one_time: number;
    total_monthly: number;
    hours_available: number;
    overhead_hours: number;
    program_hours: number;
    term_months?: number;
    commitment?: string;
    notes?: string;
    recommended?: boolean;
  }>;
  /** Program roadmap: the strategist's recommended option; MM writes its rationale */
  recommended_option_id?: string;
  /** Program roadmap: category eligibility per program, enforced per option by MM */
  program_matrix?: Record<string, string[]>;
  /** Program roadmap: library items, union of all options' eligible categories */
  process_library_hours?: Array<{
    /** Echoed onto generated rows as process_id; the baseline flags need it. */
    process_id: string;
    task: string;
    description: string;
    /** Enum, not free text -- a bad value should fail at the boundary rather than produce
     *  a row the viewer cannot group. */
    stage: 'Foundation' | 'Execution' | 'Analysis';
    service_category: string;
    baseline_hours: number;
  }>;
  /** ABM plan: target account segments */
  target_segments?: Array<{ segment_name: string; description: string; estimated_account_count: number; tier: string }>;
  /** ABM plan: offers mapped to funnel stages */
  offers?: Array<{ offer_name: string; offer_type: string; funnel_stage: string; description?: string }>;
  /** ABM plan: channel configuration */
  channels?: Record<string, unknown>;
  /** ABM plan: marketing/sales tech stack */
  tech_stack?: Record<string, unknown>;
  /** ABM plan: monthly advertising budget */
  monthly_ad_budget?: number;
  /** ABM plan: sales follow-up SLA in hours */
  sales_follow_up_sla_hours?: number;
  /** ABM plan: launch timeline description */
  launch_timeline?: string;
  /** Brief: reference deliverables with full content */
  reference_deliverables?: Array<{ title: string; deliverable_type: string; content: string }>;
  /** Brief: reference images as publicly fetchable URLs */
  reference_images?: Array<{ url: string; caption?: string }>;
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
export interface ProgramRoadmapOptionInput {
  option_id?: string;
  /** `name` is the frontend spelling of `label`. */
  label?: string;
  name?: string;
  tier: 'execute' | 'perform' | 'grow';
  programs: Array<'authority' | 'reach' | 'pursuit'>;
  /** Capacity hours. Preferred over monthly_budget now that tier bands are hours. */
  monthly_hours?: number;
  monthly_budget?: number;
  /** technologies.technology_id values, pre-filtered to active + client-billable. */
  technology_ids?: string[];
  /** Proposed contract length. Narrative only. */
  term_months?: number;
  /** Contract commitment term from COMMITMENT_TERMS -- NOT the goal commitment ladder. */
  commitment?: string;
  notes?: string;
}

export interface GenerateDeliverableRequest {
  instructions?: string;
  primary_meeting_ids?: string[];
  research_inputs?: ResearchInputs;
  /** Explicit prior roadmap ID to evolve from. If omitted, auto-detects the latest completed roadmap for the contract. */
  previous_roadmap_id?: string;
  /** Roadmap: monthly points budget (overrides contract default) */
  points_budget?: number;
  /**
   * Program roadmap: 1-3 priced options the client chooses between. Each is a complete
   * scenario; they are alternatives and are never summed.
   *
   * The frontend posts these at the top level as `options`, alongside
   * `hours_model.hourly_rate` and `recommended_option_index`; `roadmap_options` is the
   * older spelling. Both are accepted and normalised. The posted rate is ignored --
   * contracts.dollar_per_hour is the authority.
   */
  options?: Array<ProgramRoadmapOptionInput>;
  roadmap_options?: Array<ProgramRoadmapOptionInput>;
  hours_model?: { hourly_rate?: number };
  /** 0-based index into `options`, resolved to recommended_option_id by the backend. */
  recommended_option_index?: number;
  /** SEO audit: topic seeds for crawl prioritization */
  seed_topics?: string[];
  /** SEO audit: max pages to crawl per domain */
  max_crawl_pages?: number;
  /** ABM plan: target account segments */
  target_segments?: Array<{ segment_name: string; description: string; estimated_account_count: number; tier: string }>;
  /** ABM plan: offers mapped to funnel stages */
  offers?: Array<{ offer_name: string; offer_type: string; funnel_stage: string; description?: string }>;
  /** ABM plan: channel configuration */
  channels?: Record<string, unknown>;
  /** ABM plan: marketing/sales tech stack */
  tech_stack?: Record<string, unknown>;
  /** ABM plan: monthly advertising budget */
  monthly_ad_budget?: number;
  /** ABM plan: sales follow-up SLA in hours */
  sales_follow_up_sla_hours?: number;
  /** ABM plan: launch timeline description */
  launch_timeline?: string;
  /** Brief: IDs of existing deliverables to include as authoritative reference material */
  reference_deliverable_ids?: string[];
  /** Brief: reference images (storage paths in Supabase, signed URLs generated before submission) */
  reference_images?: Array<{ storage_path: string; caption?: string }>;
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
      /**
       * Program roadmap only: technology resolved per option, kept for display.
       * Never sent to the generator -- it becomes no rows and consumes no hours.
       */
      technology?: Record<string, unknown>;
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
