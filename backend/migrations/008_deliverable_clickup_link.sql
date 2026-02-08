-- 008_deliverable_clickup_link.sql
-- Link compass_deliverables to ClickUp tasks via clickup_task_id

ALTER TABLE compass_deliverables
  ADD COLUMN IF NOT EXISTS clickup_task_id text;

-- Index for lookups by clickup_task_id
CREATE INDEX IF NOT EXISTS idx_compass_deliverables_clickup_task_id
  ON compass_deliverables (clickup_task_id)
  WHERE clickup_task_id IS NOT NULL;
