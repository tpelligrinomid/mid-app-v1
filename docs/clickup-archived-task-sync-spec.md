# Spec: ClickUp Archived Tasks Not Syncing to Database

**Date:** August 3, 2026
**From:** MiD Platform Team
**To:** Backend Developer (Render Orchestrator)
**Priority:** Medium
**Component:** ClickUp Sync Worker (Render)

---

## Summary

When a team member archives a task in ClickUp, the archived state is not reflected in our database. The task continues to appear as active in both Pulse and Compass, creating confusion for the team and outdated data for clients.

## Problem Statement

ClickUp's API does **not** include archived tasks in standard list responses by default. To retrieve archived tasks, the API requires an explicit `archived=true` query parameter on the `/list/{list_id}/task` endpoint.

Our current sync worker appears to only fetch non-archived tasks (the default behavior). As a result, when a task is archived in ClickUp, the corresponding `pulse_tasks` row in our database retains its previous `is_archived = false` value indefinitely.

## Evidence

- **Example task:** `86e1t291t` ("Develop jMount Landing Page")
  - Archived in ClickUp on **June 9, 2026**
  - Database record (`pulse_tasks`) last synced **June 8, 2026**
  - `is_archived` was still `false` and `status` was still `working` over a month later
  - Required a manual SQL update to correct
- **Scale:** Only **3 out of 65,000+** tasks in `pulse_tasks` are currently flagged `is_archived = true`, which is far below what we'd expect given normal team archiving activity over time. This strongly indicates the sync has never been capturing archive events.

## Impact

- Archived ClickUp tasks appear as active in Pulse dashboards and Compass deliverable views.
- Task counts, working-status metrics, and client-facing task lists are inflated and stale.
- Manual SQL intervention is required each time the issue is reported, which is not scalable.

## Proposed Fix

The sync worker should run a **second pass per list** that explicitly fetches archived tasks and upserts them with `is_archived = true`.

### Approach

For each ClickUp list already being synced:

1. Fetch tasks with `archived=true` (ClickUp API: `GET /list/{list_id}/task?archived=true`)
2. For each returned task, upsert the `pulse_tasks` row with:
   - `is_archived = true`
   - All other fields (status, name, dates, assignees, etc.) updated from the API response as usual
3. This ensures an archived task's row is updated the next time the worker runs, rather than being skipped entirely.

### Pseudocode

```
for each list_id in tracked_lists:
    # Existing pass — active tasks (unchanged)
    active_tasks = clickup.get_tasks(list_id, archived=false)
    upsert_tasks(active_tasks, is_archived=false)

    # New pass — archived tasks
    archived_tasks = clickup.get_tasks(list_id, archived=true)
    upsert_tasks(archived_tasks, is_archived=true)
```

### Considerations

- **Pagination:** Archived task responses should be paginated the same way as active tasks. Confirm the worker's existing pagination logic handles both passes.
- **Rate limits:** Doubling the number of list fetches per cycle will increase API calls. ClickUp rate limits apply — consider whether the archived pass should run on a separate, less-frequent cadence (e.g., once daily) if rate limits are a concern.
- **Re-activation edge case:** If a task is un-archived in ClickUp, the active pass will naturally re-upsert it with `is_archived = false` on the next cycle, so no special handling is required.
- **Field freshness:** The archived pass should still update all standard fields (status, date_done, assignees, etc.) so that the row is fully consistent — not just the `is_archived` flag.

## Acceptance Criteria

1. A task archived in ClickUp is reflected as `is_archived = true` in `pulse_tasks` within one sync cycle of being archived.
2. The archived pass updates all standard fields, not just `is_archived`.
3. Un-archiving a task in ClickUp reverts `is_archived` to `false` on the next active pass.
4. No regression in existing active-task sync behavior.
5. ClickUp rate limits are respected (no 429 errors under normal operation).

## References

- ClickUp API docs — Get Tasks: `GET /list/{list_id}/task` supports `archived` boolean query param.
- Example affected task: `86e1t291t` (ClickUp task ID).
- Database table: `pulse_tasks`, column `is_archived` (boolean, default `false`).
