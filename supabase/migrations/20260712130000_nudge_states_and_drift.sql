-- Nudge memory + task drift. Both ported from the original Course app, where
-- they were built and then never read (course_stall_states, reschedule_count).
--
-- 1) cp_nudge_states — persisted "Pending decisions" memory, one row per project.
--    Course+ currently dismisses a nudge into a React Set, so a decision to
--    ignore a project dies on reload and the same nudge nags forever. snoozedUntil
--    keeps it quiet for a while; lastQuestion remembers what Claude last asked in
--    "Think it through" so a second visit doesn't re-open cold.
--
-- 2) cp_tasks.reschedule_count — how many times a task's due date has been pushed
--    FORWARD. The strongest "you are avoiding this" signal there is, and the old
--    app populated it via trigger but never surfaced it. Course+ bumps it in
--    db.updateTask when the new due date is later than the old one.
--
-- Apply BEFORE the code that writes these ships: a write to a missing table or
-- column returns PostgREST 42703/42P01 and takes the whole path down with it.
-- (Code degrades gracefully on read, but don't rely on that.)

create table if not exists public.cp_nudge_states (
  user_id        uuid not null default auth.uid(),
  project_id     text not null,
  snoozed_until  timestamptz,          -- quiet until this passes; null = not snoozed
  dismissed_at   timestamptz,          -- last time Nate consciously waved it off
  last_question  text,                 -- last "Think it through" question asked
  updated_at     timestamptz not null default now(),
  primary key (user_id, project_id)
);

alter table public.cp_tasks add column if not exists reschedule_count int not null default 0;

-- RLS, same owner policy as every other cp_ table.
alter table public.cp_nudge_states enable row level security;
drop policy if exists cp_nudge_states_owner on public.cp_nudge_states;
create policy cp_nudge_states_owner on public.cp_nudge_states
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
