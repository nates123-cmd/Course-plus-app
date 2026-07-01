-- Priority flag on tasks (P1/P2/P3), mirroring cp_projects.priority.
-- Nullable smallint 1..3; null = unset. App-side Priority pill renders P{level}.
alter table public.cp_tasks add column if not exists priority smallint;
