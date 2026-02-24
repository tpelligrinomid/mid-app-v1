// Types for compass_note_configs table

export type AutoNoteType = 'strategy' | 'abm' | 'paid' | 'content' | 'web';

export const AUTO_NOTE_TYPE_VALUES: AutoNoteType[] = ['strategy', 'abm', 'paid', 'content', 'web'];

export function isValidAutoNoteType(value: string): value is AutoNoteType {
  return AUTO_NOTE_TYPE_VALUES.includes(value as AutoNoteType);
}

// Database record
export interface NoteConfig {
  config_id: string;
  contract_id: string;
  note_type: AutoNoteType;
  enabled: boolean;
  day_of_week: number; // 0=Sunday ... 6=Saturday
  generate_time: string; // HH:MM
  timezone: string;
  lookback_days: number;
  lookahead_days: number;
  additional_instructions: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_note_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// For creating a new config
export interface CreateNoteConfigDTO {
  contract_id: string;
  note_type: AutoNoteType;
  day_of_week: number;
  generate_time?: string;
  timezone?: string;
  lookback_days?: number;
  lookahead_days?: number;
  additional_instructions?: string;
}

// For updating an existing config
export interface UpdateNoteConfigDTO {
  enabled?: boolean;
  day_of_week?: number;
  generate_time?: string;
  timezone?: string;
  lookback_days?: number;
  lookahead_days?: number;
  additional_instructions?: string | null;
}

// Validation
export function validateNoteConfigData(data: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (data.note_type !== undefined && !isValidAutoNoteType(data.note_type as string)) {
    errors.push(`Invalid note_type: ${data.note_type}. Valid values: ${AUTO_NOTE_TYPE_VALUES.join(', ')}`);
  }

  const dayOfWeek = data.day_of_week as number | undefined;
  if (dayOfWeek !== undefined && (dayOfWeek < 0 || dayOfWeek > 6)) {
    errors.push('Invalid day_of_week. Must be 0 (Sunday) through 6 (Saturday)');
  }

  const generateTime = data.generate_time as string | undefined;
  if (generateTime !== undefined && !/^\d{2}:\d{2}$/.test(generateTime)) {
    errors.push('Invalid generate_time format. Expected HH:MM');
  }

  const lookbackDays = data.lookback_days as number | undefined;
  if (lookbackDays !== undefined && (lookbackDays < 1 || lookbackDays > 90)) {
    errors.push('Invalid lookback_days. Must be between 1 and 90');
  }

  const lookaheadDays = data.lookahead_days as number | undefined;
  if (lookaheadDays !== undefined && (lookaheadDays < 1 || lookaheadDays > 90)) {
    errors.push('Invalid lookahead_days. Must be between 1 and 90');
  }

  return errors;
}

// Day of week labels for display
export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};
