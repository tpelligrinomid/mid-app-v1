// Meeting types for compass_meetings table

export type MeetingSource = 'fireflies' | 'manual' | 'otter' | 'zoom' | 'other';

export const MEETING_SOURCE_VALUES: MeetingSource[] = ['fireflies', 'manual', 'otter', 'zoom', 'other'];

export function isValidMeetingSource(value: string): value is MeetingSource {
  return MEETING_SOURCE_VALUES.includes(value as MeetingSource);
}

// Transcript can be stored in multiple formats
// - Simple string (plain text transcript)
// - Structured with speakers and timestamps
export interface TranscriptSegment {
  speaker?: string;
  text: string;
  start_time?: number; // seconds from start
  end_time?: number;
}

export type TranscriptContent = string | TranscriptSegment[] | Record<string, unknown>;

// Database record
export interface Meeting {
  meeting_id: string;
  contract_id: string;
  meeting_date: string; // ISO timestamp
  source: MeetingSource;
  external_id: string | null; // Fireflies ID, Zoom ID, etc.
  title: string | null;
  participants: string[] | null;
  duration_seconds: number | null;
  recording_url: string | null;
  transcript: TranscriptContent | null;
  raw_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// For creating a new meeting
export interface CreateMeetingDTO {
  contract_id: string;
  meeting_date: string; // ISO timestamp
  source?: MeetingSource; // defaults to 'manual'
  external_id?: string;
  title?: string;
  participants?: string[];
  duration_seconds?: number;
  recording_url?: string;
  transcript?: TranscriptContent;
  raw_metadata?: Record<string, unknown>;
}

// For creating from Fireflies URL
export interface CreateMeetingFromFirefliesDTO {
  contract_id: string;
  fireflies_url?: string; // URL to Fireflies transcript
  fireflies_id?: string; // Direct Fireflies meeting ID
}

// For updating an existing meeting
export interface UpdateMeetingDTO {
  meeting_date?: string;
  source?: MeetingSource;
  external_id?: string;
  title?: string;
  participants?: string[];
  duration_seconds?: number;
  recording_url?: string;
  transcript?: TranscriptContent;
  raw_metadata?: Record<string, unknown>;
}

// Meeting with linked note (for list views showing if note was generated)
export interface MeetingWithNote extends Meeting {
  note: {
    note_id: string;
    title: string;
    status: string;
  } | null;
}

// List item (lighter weight for list views)
export interface MeetingListItem {
  meeting_id: string;
  contract_id: string;
  meeting_date: string;
  source: MeetingSource;
  title: string | null;
  participants: string[] | null;
  duration_seconds: number | null;
  has_transcript: boolean;
  has_recording: boolean;
  has_note: boolean;
  created_at: string;
}

// Query parameters for listing meetings
export interface ListMeetingsQuery {
  contract_id: string;
  source?: MeetingSource;
  limit?: number;
  offset?: number;
}

// Fireflies API response structure (subset of what we need)
export interface FirefliesTranscript {
  id: string;
  title: string;
  date: string;
  duration: number; // minutes
  participants: string[];
  transcript_url?: string;
  video_url?: string;
  audio_url?: string;
  sentences?: {
    speaker_name: string;
    text: string;
    start_time: number;
    end_time: number;
  }[];
  summary?: {
    short_summary?: string;
    action_items?: string[];
    outline?: string[];
  };
}

// Validation function
export function validateMeetingData(data: Partial<CreateMeetingDTO>): string[] {
  const errors: string[] = [];

  if (data.source && !isValidMeetingSource(data.source)) {
    errors.push(`Invalid source: ${data.source}. Valid values: ${MEETING_SOURCE_VALUES.join(', ')}`);
  }

  if (data.meeting_date) {
    const date = new Date(data.meeting_date);
    if (isNaN(date.getTime())) {
      errors.push('Invalid meeting_date format. Expected ISO timestamp');
    }
  }

  if (data.duration_seconds !== undefined && data.duration_seconds < 0) {
    errors.push('duration_seconds must be a positive number');
  }

  if (data.recording_url && !isValidUrl(data.recording_url)) {
    errors.push('Invalid recording_url format');
  }

  return errors;
}

function isValidUrl(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

// Helper to extract Fireflies ID from URL
export function extractFirefliesId(urlOrId: string): string | null {
  // If it's already just an ID (no slashes or protocol)
  if (!urlOrId.includes('/') && !urlOrId.includes(':')) {
    return urlOrId;
  }

  // Try to parse as URL
  try {
    const url = new URL(urlOrId);
    // Fireflies URLs look like: https://app.fireflies.ai/view/Meeting-Title::meetingId
    // or https://app.fireflies.ai/view/meetingId
    const pathParts = url.pathname.split('/');
    const lastPart = pathParts[pathParts.length - 1];

    // Check for :: separator (title::id format)
    if (lastPart.includes('::')) {
      return lastPart.split('::').pop() || null;
    }

    return lastPart || null;
  } catch {
    return null;
  }
}
