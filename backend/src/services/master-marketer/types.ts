/**
 * Types for the Master Marketer API
 *
 * Master Marketer is the AI analysis service that processes meeting transcripts
 * and returns structured insights (summary, action items, sentiment, etc.)
 *
 * Endpoint: POST /api/intake/meeting-notes
 */

// Request body for POST /api/intake/meeting-notes
export interface MeetingNotesSubmission {
  title: string;
  date: string; // ISO timestamp
  participants: string[];
  transcript: string; // Full transcript text
  metadata?: {
    source?: string;
    meeting_id?: string;
    contract_id?: string;
    duration_seconds?: number;
  };
}

// Immediate response from submission
export interface SubmitJobResponse {
  jobId: string;
  status: 'queued' | 'processing';
}

// AI analysis output
export interface JobOutput {
  summary: string;
  action_items: string[];
  decisions: string[];
  key_topics: string[];
  sentiment: {
    label: 'positive' | 'neutral' | 'negative';
    confidence: number;
    reasoning?: string;
  };
}

// Poll response from GET /api/jobs/:jobId
export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'complete' | 'completed' | 'failed' | 'fail';
  output?: JobOutput;
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

// Processing state stored in compass_meetings.raw_metadata
export interface ProcessingState {
  master_marketer?: {
    status: 'pending' | 'submitted' | 'polling' | 'completed' | 'failed';
    job_id?: string;
    submitted_at?: string;
    completed_at?: string;
    error?: string;
  };
}
