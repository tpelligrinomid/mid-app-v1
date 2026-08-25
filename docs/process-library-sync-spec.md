# Process Library Sync — Backend Fix Spec

Two separate issues, both on the Render backend side.

## Issue 1: `time_estimate` is never written

ClickUp returns a `time_estimate` field on every task (milliseconds, integer). The
Process Library sync is mapping `points` and `External Description` correctly, but
skipping `time_estimate`.

**Evidence:** `compass_process_library.time_estimate_ms` is NULL for 79 of 80 active
rows. The single populated row holds `1800000` (30 min), so the column type and write
path work — the mapper just isn't setting it in the general case.

### Mapping to add

| Source (ClickUp task JSON) | Type | Target column |
|---|---|---|
| `task.time_estimate` | integer, milliseconds | `compass_process_library.time_estimate_ms` |

Notes:
- ClickUp's `time_estimate` is **milliseconds**, not seconds. Do not convert — store raw.
- The field is `null` when unset in ClickUp; write `NULL`, do not coerce to `0`.
- The value must be read from the **task detail** response. On some ClickUp list
  endpoints `time_estimate` is only returned when the request includes
  `include_subtasks=true` / the task-detail call is used; verify the current
  fetch returns it before assuming the field is absent upstream.
- Parent tasks in ClickUp may roll up subtask estimates. Match whatever rule we
  already use for `points` (top-level task value, no subtask summing) so hours and
  points stay consistent.

### Upsert change

Add `time_estimate_ms` to the upsert column list and the `ON CONFLICT (clickup_task_id)
DO UPDATE SET ...` clause, alongside `points`, `description`, `phase`, `category`,
`is_active`, `last_synced_at`.

### Frontend (already shipped, no action needed)

The app renders `time_estimate_ms / 3_600_000` as an "X hrs" badge next to the points
badge in:
- `src/pages/ProcessLibrary.tsx`
- `src/components/deliverables/renderers/points-plan/ProcessLibraryPicker.tsx`

Badges appear automatically as soon as values land. `36h 50m` in ClickUp → `36.83 hrs`.

## Issue 2: the sync hasn't run since February 9

The Process Library appears to have been a **one-time import**, not a recurring job.

**Evidence:**
- `MAX(last_synced_at)` = `2026-02-09 17:25:05Z` across all 139 rows
- `MAX(updated_at)` = same timestamp; `MAX(created_at)` = `2026-02-09 06:57:41Z`
- `pulse_sync_state` has rows for `clickup/tasks` (synced today) and
  `quickbooks/invoices` (synced today) but **no row for the process library entity
  at all** — so nothing is scheduling or tracking it.

Meanwhile the ClickUp Process Library space has clearly moved on (new tasks, revised
points, time estimates now filled in), so our copy is ~6 months stale.

### Requested changes

1. Register the Process Library as a first-class sync entity:
   - insert a `pulse_sync_state` row with `service = 'clickup'`,
     `entity_type = 'process_library'`
   - update `last_sync_at` / `last_successful_sync_at` / `records_processed` /
     `status` / `error_message` on each run, same as the tasks sync does
2. Schedule it — daily is plenty; this data changes rarely.
3. Handle deletions/archives: any `clickup_task_id` present in our table but absent
   from the ClickUp fetch should be set `is_active = false` (not hard-deleted —
   Points Plans reference `process_id`).
4. Run one full backfill immediately after the `time_estimate_ms` mapping lands, so
   all 139 rows get current points, descriptions, phases, and hours.

### Acceptance check

After the backfill, this should return a small number, not 79:

```sql
SELECT count(*) FROM compass_process_library
WHERE is_active AND time_estimate_ms IS NULL;
```

And this should show a recent timestamp and a live entity row:

```sql
SELECT max(last_synced_at) FROM compass_process_library;
SELECT * FROM pulse_sync_state
WHERE service = 'clickup' AND entity_type = 'process_library';
```
