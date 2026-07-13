-- Task touch timestamp.
--
-- cp_tasks only had created_at, so COMPLETING or re-prioritizing a task left no
-- timestamp anywhere in the schema. The "Pending decisions" nudge could not see
-- that work and kept telling Nate to archive projects he was actively working
-- ("No work logged in 33 days"). db.updateTask() now stamps this on every edit,
-- and DataContext.lastTouchAt() reads it as a project-activity signal.
--
-- Applied to prod (xsmnfcmtbpeaccnyinkr) by hand via the SQL editor on
-- 2026-07-12, before the code that writes it shipped — writing the column
-- before it exists returns 42703 and breaks every task update.
alter table public.cp_tasks
  add column if not exists updated_at timestamptz not null default now();
