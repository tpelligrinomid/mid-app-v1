/**
 * Strategy Notes — Scheduler
 *
 * Finds configs where next_run_at <= now(), generates notes,
 * and updates next_run_at for the following week.
 */

import { select, update } from '../../utils/edge-functions.js';
import { NoteConfig } from '../../types/note-configs.js';
import { generateStrategyNote } from './generate.js';

// ============================================================================
// Schedule Computation
// ============================================================================

/**
 * Compute the next occurrence of a given day_of_week + time in a timezone.
 * Returns an ISO string in UTC.
 */
export function computeNextRunAt(
  dayOfWeek: number,
  generateTime: string,
  timezone: string
): string {
  const [hours, minutes] = generateTime.split(':').map(Number);
  const now = new Date();

  // Start from today and find the next matching day of week
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);

    if (candidate.getDay() === dayOfWeek) {
      // Build a date string in the target timezone
      // We'll use a simple approach: construct the time, then adjust for timezone
      const year = candidate.getFullYear();
      const month = String(candidate.getMonth() + 1).padStart(2, '0');
      const day = String(candidate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

      // Get the UTC offset for this timezone at this date
      const tzDate = new Date(dateStr);
      const utcStr = tzDate.toLocaleString('en-US', { timeZone: 'UTC' });
      const tzStr = tzDate.toLocaleString('en-US', { timeZone: timezone });
      const utcDate = new Date(utcStr);
      const localDate = new Date(tzStr);
      const offsetMs = utcDate.getTime() - localDate.getTime();

      // Create the correct UTC time
      const resultDate = new Date(`${dateStr}Z`);
      resultDate.setTime(resultDate.getTime() - offsetMs);

      // Skip if this time has already passed today
      if (offset === 0 && resultDate.getTime() <= now.getTime()) {
        continue;
      }

      return resultDate.toISOString();
    }
  }

  // Fallback: one week from now
  const fallback = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return fallback.toISOString();
}

/**
 * Compute the next_run_at one week from the current run time.
 */
function computeNextWeekRunAt(config: NoteConfig): string {
  // Simply add 7 days to the current next_run_at, or compute fresh
  if (config.next_run_at) {
    const next = new Date(config.next_run_at);
    next.setDate(next.getDate() + 7);
    return next.toISOString();
  }
  return computeNextRunAt(config.day_of_week, config.generate_time, config.timezone);
}

// ============================================================================
// Processing
// ============================================================================

export interface SchedulerResult {
  generated: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/**
 * Process all due strategy note configs.
 * Called by the cron endpoint.
 */
export async function processScheduledNotes(): Promise<SchedulerResult> {
  const result: SchedulerResult = {
    generated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  // Find all enabled configs where next_run_at has passed
  const now = new Date().toISOString();
  let configs: NoteConfig[];

  try {
    configs = await select<NoteConfig[]>('compass_note_configs', {
      select: '*',
      filters: {
        enabled: true,
        note_type: 'strategy',
        next_run_at: { lte: now },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Scheduler] Failed to fetch due configs:', msg);
    result.errors.push(`Failed to fetch configs: ${msg}`);
    return result;
  }

  if (!configs || configs.length === 0) {
    console.log('[Scheduler] No strategy note configs due for generation');
    return result;
  }

  console.log(`[Scheduler] Found ${configs.length} strategy note config(s) due for generation`);

  // Process each config
  for (const config of configs) {
    try {
      await generateStrategyNote(config);

      // Update next_run_at to next week
      const nextRun = computeNextWeekRunAt(config);
      await update(
        'compass_note_configs',
        { next_run_at: nextRun, updated_at: new Date().toISOString() },
        { config_id: config.config_id }
      );

      result.generated++;
      console.log(`[Scheduler] Generated strategy note for config ${config.config_id}, next run: ${nextRun}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Scheduler] Failed to generate for config ${config.config_id}:`, msg);
      result.failed++;
      result.errors.push(`Config ${config.config_id}: ${msg}`);
    }
  }

  return result;
}
