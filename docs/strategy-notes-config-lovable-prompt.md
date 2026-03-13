# Automated Strategy Notes — Configuration UI (Lovable Frontend Build Prompt)

## Overview

Add an **"Auto Notes"** settings section within the **Management** area of Compass. This is where strategists configure automated weekly strategy notes per contract. When enabled, the backend generates a draft strategy note on a configurable schedule (day of week + time), pulling from existing points data, tasks, meetings, and notes. The strategist reviews the draft before their client meeting.

The backend API is fully built and deployed.

---

## Navigation

Add **"Auto Notes"** as a new nav item under Management in the Compass sidebar:

```
MANAGEMENT
  Notes
  Meetings
  Deliverables
  Status Reports
  Chat
  Auto Notes      <-- NEW
```

**Route:** `/compass/:contractId/auto-notes`

Use the Sparkles icon (or Wand icon) to indicate AI/automation.

---

## Backend API

**Base URL:** `https://mid-app-v1.onrender.com`

**Auth:** All requests require the Supabase JWT:
```typescript
const response = await fetch('https://mid-app-v1.onrender.com/api/compass/note-configs...', {
  headers: {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json'
  }
});
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/compass/note-configs?contract_id={id}` | List all note configs for a contract |
| GET | `/api/compass/note-configs/:id` | Get single config |
| POST | `/api/compass/note-configs` | Create config (starts disabled) |
| PUT | `/api/compass/note-configs/:id` | Update config (enable/disable, change schedule) |
| DELETE | `/api/compass/note-configs/:id` | Delete config |
| POST | `/api/compass/note-configs/:id/generate-now` | Generate a note immediately |

### List Response

```json
{
  "configs": [
    {
      "config_id": "uuid",
      "contract_id": "uuid",
      "note_type": "strategy",
      "enabled": true,
      "day_of_week": 0,
      "generate_time": "20:00",
      "timezone": "America/New_York",
      "lookback_days": 7,
      "lookahead_days": 30,
      "additional_instructions": "Focus on SEO metrics and content performance",
      "next_run_at": "2026-03-01T01:00:00.000Z",
      "last_run_at": "2026-02-23T01:00:00.000Z",
      "last_note_id": "uuid-of-last-generated-note",
      "created_by": "uuid",
      "created_at": "2026-02-23T...",
      "updated_at": "2026-02-23T..."
    }
  ]
}
```

### Create Request

```json
{
  "contract_id": "uuid",
  "note_type": "strategy",
  "day_of_week": 0,
  "generate_time": "20:00",
  "timezone": "America/New_York",
  "lookback_days": 7,
  "lookahead_days": 30,
  "additional_instructions": "Optional custom instructions"
}
```

Config is created with `enabled: false`. The user toggles it on after reviewing settings.

### Update Request

Send only the fields being changed:

```json
{
  "enabled": true,
  "day_of_week": 4,
  "generate_time": "17:00"
}
```

### Generate Now Response

```json
{
  "success": true,
  "note_id": "uuid",
  "title": "Weekly Strategy Note — Client Name",
  "status": "draft"
}
```

---

## Page Layout

The Auto Notes page shows a card for each note type that can be automated. For now, only **Strategy** notes are available. The other types (ABM, Paid, Content, Web) will be added later and should appear as "Coming Soon" cards.

```
Auto Notes — Configure automated note generation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────────────────────────────────────────────────────┐
│  Strategy Notes                                    [Toggle]  │
│  Weekly strategy briefing for your client meeting            │
│                                                              │
│  Schedule:  Every [Sunday ▼] at [8:00 PM ▼] [Eastern ▼]     │
│                                                              │
│  Lookback:  [7] days    Lookahead: [30] days                │
│                                                              │
│  Additional Instructions:                                    │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ Focus on SEO metrics and content performance             ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  Last generated: Feb 23, 2026 at 11:00 PM  [View Note]      │
│  Next scheduled: Mar 2, 2026 at 1:00 AM UTC                 │
│                                                              │
│  [Save Changes]                    [Generate Now]            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  ABM Notes                                      Coming Soon  │
│  Automated account-based marketing progress notes            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Paid Media Notes                               Coming Soon  │
│  Automated paid media status and optimization notes          │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Content Notes                                  Coming Soon  │
│  Automated content production and pipeline notes             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Web / SEO Notes                                Coming Soon  │
│  Automated website and SEO progress notes                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Strategy Notes Config Card — Detailed Behavior

### Toggle (Enable / Disable)

- A prominent toggle switch in the top-right corner of the card
- When toggling **ON**: calls `PUT /api/compass/note-configs/:id` with `{ "enabled": true }`
- When toggling **OFF**: calls `PUT /api/compass/note-configs/:id` with `{ "enabled": false }`
- Show a confirmation when disabling: "This will stop generating weekly strategy notes for this contract. You can re-enable at any time."
- The toggle should be visually prominent — green when on, gray when off

### First-Time Setup (No Config Exists)

When no strategy config exists for this contract (the `configs` array from the GET is empty or has no `note_type: "strategy"` entry), show a setup state:

```
┌──────────────────────────────────────────────────────────────┐
│  Strategy Notes                                              │
│  Weekly strategy briefing for your client meeting            │
│                                                              │
│  Automatically generate a weekly strategy note that          │
│  summarizes points, active work, recent deliveries,          │
│  meeting insights, and action items.                         │
│                                                              │
│  [Set Up Strategy Notes]                                     │
└──────────────────────────────────────────────────────────────┘
```

Clicking **"Set Up Strategy Notes"** opens the configuration form (inline expand or modal) with default values pre-filled:
- Day of week: Sunday (0)
- Time: 8:00 PM
- Timezone: America/New_York
- Lookback: 7 days
- Lookahead: 30 days

On save, calls `POST /api/compass/note-configs` to create the config. The config starts disabled — the user must toggle it on.

### Schedule Fields

**Day of Week** — dropdown with all 7 days:

| Value | Label |
|-------|-------|
| 0 | Sunday |
| 1 | Monday |
| 2 | Tuesday |
| 3 | Wednesday |
| 4 | Thursday |
| 5 | Friday |
| 6 | Saturday |

**Generate Time** — time picker or dropdown with 30-minute increments:
- 12:00 AM, 12:30 AM, 1:00 AM, ... 11:00 PM, 11:30 PM
- Default: 8:00 PM
- Display in 12-hour format (e.g., "8:00 PM"), send to API in 24-hour format (e.g., "20:00")

**Timezone** — dropdown with common US timezones:

| Value | Label |
|-------|-------|
| America/New_York | Eastern (ET) |
| America/Chicago | Central (CT) |
| America/Denver | Mountain (MT) |
| America/Los_Angeles | Pacific (PT) |

Default: America/New_York

### Lookback / Lookahead

- **Lookback days** — number input, 1-90, default 7. Label: "Look back X days for completed tasks, meetings, and notes"
- **Lookahead days** — number input, 1-90, default 30. Label: "Look ahead X days for tasks in progress"

These are advanced settings. Consider putting them in a collapsible "Advanced Settings" section so the main card stays clean.

### Additional Instructions

- Textarea, optional
- Placeholder: "Add custom instructions for the AI when generating notes for this contract (e.g., 'Focus on SEO metrics' or 'Always mention competitor activity')"
- This text gets injected into the Claude prompt, so it customizes the output per-contract

### Status Information

Show at the bottom of the card:

- **Last generated:** formatted date/time of `last_run_at`, or "Never" if null
- **View Note** link next to last generated — navigates to `/compass/:contractId/notes/:last_note_id` if `last_note_id` is set
- **Next scheduled:** formatted date/time of `next_run_at`, or "Not scheduled" if null/disabled
- Show times in the user's local timezone

### Save Changes Button

- Only appears when the user has made changes to the form (day, time, timezone, lookback, lookahead, instructions)
- Calls `PUT /api/compass/note-configs/:id` with the changed fields
- Show a success toast: "Strategy note schedule updated"

### Generate Now Button

- Always available (whether config is enabled or not)
- Calls `POST /api/compass/note-configs/:id/generate-now`
- Show a loading state on the button while generating (this takes ~10 seconds)
- On success, show a toast: "Strategy note generated" with a link to view it
- On error, show an error toast with the error message
- After successful generation, refresh the card to show the updated `last_run_at` and `last_note_id`

---

## What Gets Generated

For context (do not build this — it's handled by the backend), here's what the generated strategy note contains:

- **Points summary** — monthly allotment, working, delivered, balance, burden
- **Client sentiment** — from recent meeting transcriptions
- **Projects in progress** — active deliverable tasks with points and due dates
- **Recent deliveries** — completed tasks in the lookback period
- **Tasks waiting on client** — blocked items that need client action
- **Insights from recent notes** — pulled from meeting notes, ABM notes, paid notes, etc.
- **Action items** — synthesized next steps

The note is saved as a draft in `compass_notes` with `note_type: 'strategy'` and `is_auto_generated: true`. The strategist reviews and edits it in the existing Notes detail view before their meeting.

---

## Notes List View — Auto-Generated Badge

In the existing Notes list view (`/compass/:contractId/notes`), auto-generated strategy notes should be visually distinguishable:

- Show an **"AI Generated"** badge (or "Auto" badge with Sparkles icon) on notes where `is_auto_generated: true`
- Show the **"Strategy"** type badge (the existing `note_type` badge) alongside it
- These badges should appear on the note card in the list view, so strategists can quickly identify which notes were auto-generated vs. manually created

The Notes list already shows `is_auto_generated` in the data — just add the visual badge. No API changes needed.

---

## User Roles

- **admin / team_member** — full access: view, configure, enable/disable, generate now
- **client** — no access to Auto Notes (hide the nav item for client users)

---

## Error Handling

| Status | Message |
|--------|---------|
| 400 | Show validation error details (e.g., "Invalid day_of_week") |
| 404 | "Note config not found" — shouldn't happen in normal usage |
| 409 | "A strategy note config already exists for this contract" — prevent double-create |
| 500 | "Something went wrong. Please try again." |

For the generate-now endpoint, errors may include:
- Missing API keys (500) — "Generation service is not configured"
- Claude API errors (500) — "Failed to generate note"

Show all errors as toast notifications.

---

## Design Notes

- The Auto Notes page should feel like a **settings/configuration** page — clean and organized
- Use the same card/panel style as other Compass settings pages
- The toggle switch should be the most prominent interactive element — it's the primary action
- "Coming Soon" cards should be visually muted (lower opacity, no interactive elements) but still show what's planned
- The "Generate Now" button is secondary to the toggle — it's a testing/manual override action
- Keep the schedule configuration simple and scannable: "Every Sunday at 8:00 PM Eastern"
- The additional instructions textarea should look like a text area, not a code editor — it's natural language, not code
- Follow existing Compass module patterns for layout consistency

---

## Optional Enhancements (Nice-to-Have)

1. **Preview** — a read-only preview of what data will be gathered (show counts: "12 working tasks, 5 meetings, etc.") before generating
2. **History** — show a small list of recently generated notes (last 4-5) with dates and links, below the config card
3. **Schedule visualization** — "Next note in 3 days" countdown badge
4. **Notification** — show a badge on the Notes nav item when a new auto-generated note is available for review
