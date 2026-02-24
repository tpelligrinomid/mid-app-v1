/**
 * Strategy Notes — Generation Service
 *
 * Builds a Claude prompt from gathered data, generates the strategy note,
 * parses the markdown + structured JSON, and saves to compass_notes.
 */

import { sendMessage } from '../claude/client.js';
import { insert, update } from '../../utils/edge-functions.js';
import { gatherStrategyNoteData, StrategyNoteData } from './gather.js';
import { NoteConfig } from '../../types/note-configs.js';

// ============================================================================
// Types
// ============================================================================

interface GeneratedNote {
  note_id: string;
  title: string;
  status: string;
}

// ============================================================================
// Prompt Building
// ============================================================================

const SYSTEM_PROMPT = `You are an internal strategist assistant at a marketing agency.
Generate a weekly strategy note for the account team. The note should be concise, actionable, and highlight anything the strategist should pay attention to before their client meeting.

Flag any concerns: declining sentiment, point burden issues, overdue tasks, or topics the client has raised repeatedly.

Be direct. This is an internal document, not client-facing.

Format the response in two parts:
1. A markdown strategy note following the standard format below
2. A JSON block (wrapped in \`\`\`json ... \`\`\`) with structured data

Standard format:
## Weekly Strategy Note — {Contract Name}
Week of {date}

### Points Summary
- Monthly allotment: X
- Working (next 30 days): X
- Delivered (last 30 days): X
- Points burden: X
- Tier: X

### Client Sentiment
{sentiment summary based on recent meetings}

### Channels & Projects in Progress
{list of active work}

### Updates Since Last Week
{recently completed work and notable developments}

### Action Items
{actionable next steps}

JSON format:
\`\`\`json
{
  "points_summary": { "allotment": 0, "working": 0, "delivered": 0, "burden": 0, "tier": "" },
  "sentiment": { "label": "", "confidence": 0, "summary": "" },
  "key_concerns": ["..."],
  "action_items": [{ "item": "...", "due": "..." }]
}
\`\`\``;

function buildUserPrompt(data: StrategyNoteData, additionalInstructions?: string | null): string {
  const lines: string[] = [];

  lines.push(`Generate a strategy note for **${data.contract.contract_name}** using this data:`);
  lines.push('');

  // Points
  lines.push('## Points');
  if (data.points) {
    lines.push(`Monthly allotment: ${data.contract.monthly_points_allotment ?? 'N/A'}`);
    lines.push(`Points purchased: ${data.points.points_purchased}`);
    lines.push(`Points delivered (all time): ${data.points.points_delivered}`);
    lines.push(`Points working: ${data.points.points_working}`);
    lines.push(`Points balance: ${data.points.points_balance}`);
    lines.push(`Points burden: ${data.points.points_burden}`);
  } else {
    lines.push('No points data available.');
  }
  lines.push('');

  // Tier
  lines.push('## Tier');
  lines.push(data.contract.priority || 'Not set');
  lines.push('');

  // Managers
  lines.push('## Account Team');
  lines.push(`Account Manager: ${data.contract.account_manager || 'N/A'}`);
  lines.push(`Team Manager: ${data.contract.team_manager || 'N/A'}`);
  lines.push('');

  // Meetings
  lines.push(`## Recent Meetings (last ${data.meetings.length > 0 ? 'period' : '0 found'})`);
  if (data.meetings.length > 0) {
    for (const m of data.meetings) {
      lines.push(`### ${m.title || 'Untitled Meeting'} — ${m.meeting_date}`);
      if (m.sentiment) {
        lines.push(`Sentiment: ${m.sentiment.label || 'N/A'} (confidence: ${m.sentiment.confidence ?? 'N/A'})`);
        if (m.sentiment.bullets && m.sentiment.bullets.length > 0) {
          for (const b of m.sentiment.bullets) {
            lines.push(`- ${b}`);
          }
        }
        if (m.sentiment.highlights && m.sentiment.highlights.length > 0) {
          lines.push('Highlights:');
          for (const h of m.sentiment.highlights) {
            lines.push(`- ${h}`);
          }
        }
      }
      lines.push('');
    }
  } else {
    lines.push('No meetings in this period.');
    lines.push('');
  }

  // Tasks in progress
  lines.push('## Tasks In Progress (Deliverables)');
  if (data.tasks_in_progress.length > 0) {
    for (const t of data.tasks_in_progress) {
      const pts = t.points ? `${t.points} pts` : 'no pts';
      const due = t.due_date ? ` — due ${t.due_date}` : '';
      lines.push(`- ${t.name} — ${pts}${due}`);
    }
  } else {
    lines.push('No deliverable tasks currently in progress.');
  }
  lines.push('');

  // Tasks completed
  lines.push('## Tasks Completed Recently');
  if (data.tasks_completed.length > 0) {
    for (const t of data.tasks_completed) {
      const pts = t.points ? `${t.points} pts` : 'no pts';
      const done = t.date_done ? ` — completed ${t.date_done}` : '';
      lines.push(`- ${t.name} — ${pts}${done}`);
    }
  } else {
    lines.push('No tasks completed in this period.');
  }
  lines.push('');

  // Tasks blocked / waiting on client
  lines.push('## Tasks Waiting on Client');
  if (data.tasks_blocked.length > 0) {
    for (const t of data.tasks_blocked) {
      const pts = t.points ? `${t.points} pts` : 'no pts';
      const due = t.due_date ? ` — due ${t.due_date}` : '';
      lines.push(`- ${t.name} — ${pts}${due}`);
    }
  } else {
    lines.push('No tasks currently waiting on client.');
  }
  lines.push('');

  // Recent notes
  lines.push('## Recent Notes');
  if (data.recent_notes.length > 0) {
    for (const n of data.recent_notes) {
      lines.push(`### ${n.title} (${n.note_type}, ${n.note_date})`);
      if (n.content_raw) {
        lines.push(n.content_raw);
      }
      lines.push('');
    }
  } else {
    lines.push('No recent notes.');
  }

  // Additional instructions
  if (additionalInstructions) {
    lines.push('');
    lines.push('## Additional Instructions');
    lines.push(additionalInstructions);
  }

  lines.push('');
  lines.push('Respond with:');
  lines.push('1. A markdown strategy note following the standard format');
  lines.push('2. A JSON block (```json ... ```) with structured data: { "points_summary": {...}, "sentiment": {...}, "key_concerns": [...], "action_items": [...] }');

  return lines.join('\n');
}

// ============================================================================
// Parsing
// ============================================================================

function parseGeneratedOutput(output: string): {
  content_raw: string;
  content_structured: Record<string, unknown> | null;
} {
  // Extract JSON block if present
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  let content_structured: Record<string, unknown> | null = null;

  if (jsonMatch) {
    try {
      content_structured = JSON.parse(jsonMatch[1]);
    } catch {
      console.warn('[StrategyNotes] Failed to parse JSON block from Claude output');
    }
  }

  // The markdown content is everything before the JSON block (or the entire output)
  let content_raw = output;
  if (jsonMatch) {
    content_raw = output.substring(0, jsonMatch.index).trim();
  }

  return { content_raw, content_structured };
}

// ============================================================================
// Note Date Helpers
// ============================================================================

function getUpcomingMonday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() + daysUntilMonday);
  return monday.toISOString().split('T')[0];
}

function getWeekNumber(dateStr: string): { week: number; year: number } {
  const date = new Date(dateStr);
  const jan1 = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000));
  const week = Math.ceil((days + jan1.getDay() + 1) / 7);
  return { week, year: date.getFullYear() };
}

// ============================================================================
// Main Generation Function
// ============================================================================

export async function generateStrategyNote(config: NoteConfig): Promise<GeneratedNote> {
  const startTime = Date.now();
  console.log(`[StrategyNotes] Generating for contract ${config.contract_id} (config ${config.config_id})`);

  // 1. Gather data
  const data = await gatherStrategyNoteData(
    config.contract_id,
    config.lookback_days,
    config.lookahead_days
  );

  console.log(`[StrategyNotes] Data gathered: ${data.tasks_in_progress.length} working, ${data.tasks_completed.length} completed, ${data.meetings.length} meetings`);

  // 2. Build prompt with additional instructions if configured
  let systemPrompt = SYSTEM_PROMPT;
  if (config.additional_instructions) {
    systemPrompt += `\n\n## Per-Contract Instructions\n${config.additional_instructions}`;
  }
  const userPrompt = buildUserPrompt(data, config.additional_instructions);

  // 3. Call Claude
  const output = await sendMessage(systemPrompt, userPrompt, {
    maxTokens: 2048,
    temperature: 0.4,
  });

  // 4. Parse output
  const { content_raw, content_structured } = parseGeneratedOutput(output);

  // 5. Compute note metadata
  const noteDate = getUpcomingMonday();
  const { week, year } = getWeekNumber(noteDate);
  const title = `Weekly Strategy Note — ${data.contract.contract_name}`;

  // 6. Save to compass_notes via edge function proxy
  const noteRows = await insert<Array<{ note_id: string; title: string; status: string }>>(
    'compass_notes',
    {
      contract_id: config.contract_id,
      note_type: 'strategy',
      title,
      content_raw,
      content_structured,
      note_date: noteDate,
      week_number: week,
      year,
      status: 'draft',
      is_auto_generated: true,
    },
    { select: 'note_id, title, status' }
  );

  const note = Array.isArray(noteRows) ? noteRows[0] : noteRows;

  // 7. Update config with last run info
  await update(
    'compass_note_configs',
    {
      last_run_at: new Date().toISOString(),
      last_note_id: note.note_id,
      updated_at: new Date().toISOString(),
    },
    { config_id: config.config_id }
  );

  const duration = Date.now() - startTime;
  console.log(`[StrategyNotes] Generated note ${note.note_id} in ${duration}ms`);

  return note;
}
