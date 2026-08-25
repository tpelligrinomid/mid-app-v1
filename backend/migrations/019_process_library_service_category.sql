-- Migration 019: Service Category on the Process Library
-- Run in Supabase SQL Editor

-- compass_process_library.category is the ClickUp LIST name ("Templates",
-- "Assets", client names) -- a grouping, not a service category. The
-- hours/program roadmap needs the real taxonomy so it can filter the library
-- down to the categories a sold program actually covers, so it gets its own
-- column rather than overloading the existing one.
--
-- Source of truth is the ClickUp "Service Category" dropdown, same as
-- pulse_tasks. The sync reads it off the task payload; the classifier fills it
-- in ClickUp where it is empty, and the next sync brings the value back here.
-- Nothing writes a category to this column that ClickUp does not also hold.

ALTER TABLE compass_process_library
  ADD COLUMN IF NOT EXISTS service_category text;

-- Roadmap generation filters active library items by category, so the partial
-- index matches how it is actually read.
CREATE INDEX IF NOT EXISTS idx_process_library_service_category
  ON compass_process_library(service_category)
  WHERE is_active;

COMMENT ON COLUMN compass_process_library.service_category IS
  'ClickUp Service Category dropdown label (CONTENT, DESIGN, PAID MEDIA, ...). Distinct from `category`, which is the ClickUp list name.';
