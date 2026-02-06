// Note types for compass_notes table

export type NoteType = 'meeting' | 'abm' | 'paid' | 'content' | 'web' | 'status' | 'strategy';
export type NoteStatus = 'draft' | 'published' | 'archived';

export const NOTE_TYPE_VALUES: NoteType[] = ['meeting', 'abm', 'paid', 'content', 'web', 'status', 'strategy'];
export const NOTE_STATUS_VALUES: NoteStatus[] = ['draft', 'published', 'archived'];

export function isValidNoteType(value: string): value is NoteType {
  return NOTE_TYPE_VALUES.includes(value as NoteType);
}

export function isValidNoteStatus(value: string): value is NoteStatus {
  return NOTE_STATUS_VALUES.includes(value as NoteStatus);
}

// Action item structure for meeting notes
export interface ActionItem {
  item: string;
  assignee?: string;
  due?: string; // ISO date string
  completed?: boolean;
}

// Database record
export interface Note {
  note_id: string;
  contract_id: string;
  note_type: NoteType;
  title: string;
  content_raw: string | null;
  content_structured: Record<string, unknown> | null;
  note_date: string; // ISO date string
  week_number: number | null;
  year: number | null;
  status: NoteStatus;
  meeting_id: string | null;
  action_items: ActionItem[] | null;
  is_auto_generated: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// For creating a new note
export interface CreateNoteDTO {
  contract_id: string;
  note_type: NoteType;
  title: string;
  content_raw?: string;
  content_structured?: Record<string, unknown>;
  note_date: string; // ISO date string (YYYY-MM-DD)
  week_number?: number;
  year?: number;
  status?: NoteStatus;
  meeting_id?: string;
  action_items?: ActionItem[];
  is_auto_generated?: boolean;
}

// For updating an existing note
export interface UpdateNoteDTO {
  note_type?: NoteType;
  title?: string;
  content_raw?: string;
  content_structured?: Record<string, unknown>;
  note_date?: string;
  week_number?: number;
  year?: number;
  status?: NoteStatus;
  action_items?: ActionItem[];
}

// Note with related meeting data
export interface NoteWithMeeting extends Note {
  meeting: {
    meeting_id: string;
    meeting_date: string;
    title: string | null;
    recording_url: string | null;
    participants: string[] | null;
    duration_seconds: number | null;
  } | null;
}

// List item (lighter weight for list views)
export interface NoteListItem {
  note_id: string;
  contract_id: string;
  note_type: NoteType;
  title: string;
  note_date: string;
  status: NoteStatus;
  is_auto_generated: boolean;
  has_action_items: boolean;
  created_at: string;
  updated_at: string;
}

// Query parameters for listing notes
export interface ListNotesQuery {
  contract_id: string;
  note_type?: NoteType;
  status?: NoteStatus;
  limit?: number;
  offset?: number;
}

// Validation function
export function validateNoteData(data: Partial<CreateNoteDTO>): string[] {
  const errors: string[] = [];

  if (data.note_type && !isValidNoteType(data.note_type)) {
    errors.push(`Invalid note_type: ${data.note_type}. Valid values: ${NOTE_TYPE_VALUES.join(', ')}`);
  }

  if (data.status && !isValidNoteStatus(data.status)) {
    errors.push(`Invalid status: ${data.status}. Valid values: ${NOTE_STATUS_VALUES.join(', ')}`);
  }

  if (data.note_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.note_date)) {
    errors.push('Invalid note_date format. Expected YYYY-MM-DD');
  }

  if (data.week_number !== undefined && (data.week_number < 1 || data.week_number > 53)) {
    errors.push('Invalid week_number. Must be between 1 and 53');
  }

  if (data.year !== undefined && (data.year < 2000 || data.year > 2100)) {
    errors.push('Invalid year. Must be between 2000 and 2100');
  }

  return errors;
}
