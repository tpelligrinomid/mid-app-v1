# Automated Strategy Notes — Implementation Plan

**Date:** February 23, 2026
**Status:** Planning

## Overview

Automated weekly strategy notes generated per contract on a configurable schedule. Pulls from existing Pulse and Compass data (points, tasks, meetings, sentiment) and uses Claude to synthesize a readable internal note. Strategists review the draft before their weekly one-on-ones.

Designed to be extensible — the same config system will support automated ABM notes, paid media notes, content notes, and other note types in the future.

## What This Replaces

Strategists currently type up weekly notes manually before client meetings. They pull from ClickUp, check points, review meeting transcripts, and summarize everything. This automates that entire process using data we already have.

## Data Sources (All Existing)

| Data | Source Table | Key Fields |
|------|-------------|------------|
| Monthly points allotment | `contracts` | `monthly_points_allotment` |
| Points purchased/credited/delivered/working/balance/burden | `contract_points_summary` (materialized view) | All point metrics |
| Tier level | `contracts` | `priority` (Tier 1-4) |
| Client sentiment | `compass_meetings` | `sentiment.label`, `sentiment.confidence`, `sentiment.bullets` |
| Channels/projects in progress | `pulse_tasks` | `name`, `status`, `points`, `clickup_list_id` WHERE status = 'working' |
| Recently completed work | `pulse_tasks` | WHERE `status` = 'delivered' AND `date_done` within lookback period |
| Meeting summaries | `compass_meetings` | `title`, `meeting_date`, `sentiment.bullets`, `sentiment.highlights` |
| Account/team manager | `contracts` + `pulse_clickup_users` | `account_manager`, `team_manager` → `full_name` |

## Output Format

The generated strategy note will follow this structure:

```
## Weekly Strategy Note — {Contract Name}
Week of {date}

### Points Summary
- Monthly allotment: 150
- Working (next 30 days): 45
- Delivered (last 30 days): 120
- Points burden: -15 (on track)
- Tier: Tier 1

### Client Sentiment
Positive (0.85 confidence) — based on meeting on Feb 18

Key takeaways from recent meetings:
- Client expressed excitement about the new ABM campaign launch
- Requested additional focus on LinkedIn content for Q2
- Action item: Send revised content calendar by Friday

### Channels & Projects in Progress
- **SEO Audit** — 25 points, in progress
- **Q1 Blog Content** — 40 points, 3 of 8 posts delivered
- **LinkedIn Campaign Setup** — 15 points, working

### Updates Since Last Week
- Delivered: Brand Guidelines v2, February Newsletter
- Client discussed shifting budget toward paid social in March call
- New competitive threat identified: {competitor} launched similar service

### Action Items
- Send revised content calendar (due: Feb 28)
- Schedule Q2 planning session
- Follow up on paid social budget discussion
```

Saved to `compass_notes` as:
- `note_type`: 'strategy'
- `status`: 'draft' (strategist reviews before publishing)
- `is_auto_generated`: true
- `content_raw`: markdown above
- `content_structured`: JSON with each section as a key for frontend rendering

## Data Model

### New Table: `compass_note_configs`

Separate from `compass_report_configs` to support multiple automated note types independently.

```sql
CREATE TABLE compass_note_configs (
  config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(contract_id),

  -- What type of note to generate
  note_type text NOT NULL,            -- 'strategy' | 'abm' | 'paid' | 'content' | 'web'

  -- Schedule
  enabled boolean DEFAULT false,
  day_of_week integer NOT NULL,       -- 0=Sunday, 1=Monday, ..., 6=Saturday
  generate_time time DEFAULT '20:00', -- Time to generate (default 8 PM)
  timezone text DEFAULT 'America/New_York',

  -- Lookback configuration
  lookback_days integer DEFAULT 7,    -- How far back to look for completed tasks/meetings
  lookahead_days integer DEFAULT 30,  -- How far ahead to look for working tasks

  -- Generation settings
  additional_instructions text,       -- Optional per-contract instructions for Claude
                                      -- e.g., "Focus on SEO metrics" or "Include competitor mentions"

  -- Scheduling state
  next_run_at timestamptz,            -- Pre-computed next generation time
  last_run_at timestamptz,
  last_note_id uuid,                  -- FK to the most recently generated note

  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- One config per note_type per contract
  UNIQUE(contract_id, note_type),

  CONSTRAINT valid_note_type CHECK (note_type IN ('strategy', 'abm', 'paid', 'content', 'web')),
  CONSTRAINT valid_day_of_week CHECK (day_of_week BETWEEN 0 AND 6)
);

CREATE INDEX idx_note_configs_next_run ON compass_note_configs(next_run_at)
  WHERE enabled = true;
CREATE INDEX idx_note_configs_contract ON compass_note_configs(contract_id);
```

### Why a Separate Table

`compass_report_configs` is designed for client-facing email reports with recipients, send status, and HTML rendering. Automated notes are internal, don't get emailed, and will expand to cover multiple note types (ABM, paid, content). Keeping them separate avoids overloading the report config with unrelated concerns.

The `UNIQUE(contract_id, note_type)` constraint means each contract can have one config per note type. So a contract could have:
- Strategy notes every Sunday at 8 PM
- ABM notes every Monday at 6 AM
- Paid media notes every Friday at 5 PM

All independently toggled.

## API Endpoints

### Note Config CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/compass/note-configs?contract_id={id}` | List all note configs for a contract |
| GET | `/api/compass/note-configs/:id` | Get single config |
| POST | `/api/compass/note-configs` | Create config (starts disabled) |
| PUT | `/api/compass/note-configs/:id` | Update config (enable/disable, change schedule) |
| DELETE | `/api/compass/note-configs/:id` | Delete config |
| POST | `/api/compass/note-configs/:id/generate-now` | Generate a note immediately (for testing) |

### Cron Endpoint

| Method | Endpoint | Schedule | Description |
|--------|----------|----------|-------------|
| POST | `/api/cron/generate-strategy-notes` | Every hour at :30 (30 * * * *) | Check for configs where `next_run_at <= now()` and generate |

Running hourly at :30 (offset from existing crons at :00) means notes generate within an hour of the configured time. The `next_run_at` column ensures each config only fires once per week.

## Architecture

### Cron Flow

```
Render cron hits POST /api/cron/generate-strategy-notes
  │
  ├─ 1. Query compass_note_configs WHERE enabled = true
  │     AND next_run_at <= NOW()
  │     AND note_type = 'strategy'
  │
  ├─ 2. For each matching config:
  │     │
  │     ├─ a. Gather data (all via edge function proxy)
  │     │     - contract info (name, priority, allotment)
  │     │     - contract_points_summary (points metrics)
  │     │     - pulse_tasks WHERE status = 'working' (in progress)
  │     │     - pulse_tasks WHERE status = 'delivered' AND date_done >= lookback (completed)
  │     │     - compass_meetings WHERE meeting_date >= lookback (recent meetings)
  │     │     - compass_notes WHERE note_type IN ('meeting','strategy')
  │     │       AND note_date >= lookback (recent notes for context)
  │     │
  │     ├─ b. Build prompt with all gathered data
  │     │     - Structured data as context
  │     │     - Additional instructions if configured
  │     │
  │     ├─ c. Call Claude to generate the note
  │     │     - Returns markdown (content_raw) + JSON (content_structured)
  │     │
  │     ├─ d. Save to compass_notes
  │     │     - note_type: 'strategy'
  │     │     - status: 'draft'
  │     │     - is_auto_generated: true
  │     │     - week_number + year populated
  │     │     - note_date = the Monday of the upcoming week
  │     │
  │     └─ e. Update config
  │           - last_run_at = now()
  │           - last_note_id = new note ID
  │           - next_run_at = compute next occurrence
  │
  └─ 3. Return summary: { generated: 5, failed: 0, skipped: 2 }
```

### Data Gathering Service

```
services/strategy-notes/gather.ts

gatherStrategyNoteData(contractId, lookbackDays, lookaheadDays)
  → {
      contract: { name, priority, allotment, account_manager, team_manager },
      points: { purchased, credited, delivered, working, balance, burden },
      tasks_in_progress: [{ name, points, status, clickup_list }],
      tasks_completed: [{ name, points, date_done }],
      meetings: [{ title, date, sentiment_label, sentiment_confidence, bullets }],
      recent_notes: [{ title, note_type, content_raw (truncated) }]
    }
```

### Claude Prompt Strategy

The prompt gives Claude the raw data and asks it to synthesize, not just format:

```
System: You are an internal strategist assistant at a marketing agency.
Generate a weekly strategy note for the account team. The note should be
concise, actionable, and highlight anything the strategist should pay
attention to before their client meeting.

Flag any concerns: declining sentiment, point burden issues, overdue tasks,
or topics the client has raised repeatedly.

Be direct. This is an internal document, not client-facing.

{{additional_instructions}}

User: Generate a strategy note for {{contract_name}} using this data:

## Points
Monthly allotment: {{allotment}}
Points purchased: {{purchased}}
Points delivered (all time): {{delivered}}
Points working: {{working}}
Points balance: {{balance}}
Points burden: {{burden}}

## Tier
{{priority}}

## Recent Meetings (last {{lookback}} days)
{{meetings_data}}

## Tasks In Progress
{{working_tasks}}

## Tasks Completed (last {{lookback}} days)
{{completed_tasks}}

## Recent Notes
{{recent_notes}}

Respond with:
1. A markdown strategy note following the standard format
2. A JSON block (```json ... ```) with structured data:
   { "points_summary": {...}, "sentiment": {...}, "key_concerns": [...], "action_items": [...] }
```

## Files to Create

| File | Purpose |
|------|---------|
| `backend/migrations/015_compass_note_configs.sql` | New table + indexes |
| `backend/src/types/note-configs.ts` | TypeScript types, DTOs, validation |
| `backend/src/routes/compass/note-configs.ts` | CRUD API for note configs |
| `backend/src/services/strategy-notes/gather.ts` | Data gathering from existing tables |
| `backend/src/services/strategy-notes/generate.ts` | Claude prompt + note generation |
| `backend/src/services/strategy-notes/scheduler.ts` | Cron logic: find due configs, generate, update next_run_at |

## Files to Modify

| File | Change |
|------|--------|
| `backend/src/index.ts` | Register note-configs route |
| `backend/src/routes/cron.ts` | Add `generate-strategy-notes` endpoint |

## Implementation Order

### Phase A: Data Model + Config API (1 session)
1. Migration: `compass_note_configs` table
2. Types + validation
3. CRUD routes for note configs
4. Register in index.ts

### Phase B: Data Gathering (1 session)
1. `gather.ts` — query all data sources for a contract
2. Format data into structured prompt context
3. Test with real contract data (log output, don't generate yet)

### Phase C: Generation + Cron (1 session)
1. `generate.ts` — Claude prompt, parse markdown + JSON output
2. Save to compass_notes
3. `scheduler.ts` — find due configs, run generation, update next_run_at
4. Add cron endpoint to `cron.ts`
5. Test end-to-end with "generate now" endpoint

### Phase D: Frontend (Lovable)
1. Contract settings tab: toggle auto-notes, pick day/time
2. Notes list view: show auto-generated notes with "Auto" badge
3. Note detail view: edit draft before publishing

## Future Note Types

The same `compass_note_configs` + generation pattern supports:

| Note Type | Data Sources | Focus |
|-----------|-------------|-------|
| `strategy` | Points, tasks, meetings, sentiment | Weekly team prep for client meetings |
| `abm` | ABM-tagged tasks, ABM deliverables, ABM meetings | ABM campaign progress and performance |
| `paid` | Paid media tasks, ad spend data, campaign metrics | Paid media status and optimization notes |
| `content` | Content assets, publishing cadence, content tasks | Content production status and pipeline |
| `web` | Web/SEO tasks, SEO audit deliverables, analytics | Website and SEO progress notes |

Each type would have its own `gather` function that pulls the relevant data, but shares the same config table, scheduling infrastructure, and cron endpoint. The `note_type` field on the config determines which gather function runs.

## Cost Estimate

| Component | Per Note | Per Week (10 contracts) |
|-----------|----------|------------------------|
| Data queries (6-8 selects via proxy) | ~0s cost, ~2s latency | ~20s total |
| Claude generation | ~5K input, ~800 output = ~$0.03 | ~$0.30 |
| **Total** | **~$0.03** | **~$0.30/week** |

## Schedule Recommendations

| Scenario | Day | Time | Why |
|----------|-----|------|-----|
| Monday morning meetings | Sunday | 8 PM ET | Ready for review Monday morning |
| Friday meetings | Thursday | 8 PM ET | Ready for review Friday morning |
| Flexible | Configurable per contract | Default 8 PM ET | Each contract can have its own schedule |

## Render Cron Configuration

Add to Render cron jobs:

```
POST https://mid-app-v1.onrender.com/api/cron/generate-strategy-notes?secret={CRON_SECRET}
Schedule: 30 * * * *  (every hour at :30)
```

The hourly check with `next_run_at` filtering means notes generate within an hour of the configured time, and the `UNIQUE(contract_id, note_type)` constraint prevents duplicates.
