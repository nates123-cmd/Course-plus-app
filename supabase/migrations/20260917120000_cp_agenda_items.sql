-- Agenda items — the "To discuss in this meeting" checklist, made permanent.
--
-- Until now the checklist on the meeting composer was DERIVED: every task with
-- work_type='scheduled' whose meeting_id matched the meeting's title. That
-- covers tasks, but a talking point is not always a task ("ask about the
-- reorg", "raise the budget freeze"), and there was nowhere to put one except
-- the free-text prep agenda, which nothing ticks off.
--
-- cp_agenda_items holds the manual talking points. The composer, the Agenda
-- screen and the series page all show ONE list per meeting: scheduled tasks
-- (still derived from cp_tasks, so a done task drops out on its own) plus
-- these rows. Keyed by meeting TITLE, exactly like cp_tasks.meeting_id — Today
-- regenerates placed_blocks so block ids aren't stable, and a title is what
-- makes an item carry forward to next week's "Jon 1:1" if it never came up.
--
-- done + note_id record WHICH instance it was raised in, so a saved meeting
-- can list what got covered; an open item simply keeps showing until it does.
--
-- ids are TEXT to match every other cp_* table (client-generated, no FKs
-- between cp_* tables — links are resolved app-side).
--
-- Apply by hand BEFORE the code that writes this ships:
--   supabase db query --linked -f supabase/migrations/20260917120000_cp_agenda_items.sql

create table if not exists public.cp_agenda_items (
  id            text not null,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  meeting_title text not null,                 -- matches placed_blocks.title / cp_tasks.meeting_id (normalized app-side)
  label         text not null default '',
  done          boolean not null default false,
  done_at       timestamptz,
  note_id       text,                          -- the cp_notes meeting it was covered in, once done
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists cp_agenda_items_title_idx
  on public.cp_agenda_items (user_id, meeting_title, done);

alter table public.cp_agenda_items enable row level security;

drop policy if exists cp_agenda_items_owner on public.cp_agenda_items;
create policy cp_agenda_items_owner on public.cp_agenda_items
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
