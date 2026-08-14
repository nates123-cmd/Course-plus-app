-- Goals — the Arrow EPR goals, plus the automatically-kept record of what got
-- accomplished against them and what got in the way.
--
-- Three things ship here.
--
-- 1. cp_tasks.completed_at — the moment a task actually flipped done. Until now
--    the only timestamp was updated_at, which db.updateTask stamps on EVERY
--    edit (see the comment at src/lib/db.js:301). So "done + updated_at" meant
--    "last touched while done", not "finished on". A success record dated by
--    that is wrong the first time you relabel a finished task.
--
-- 2. cp_goals — the goal definitions, each pointing at the projects that feed
--    it. A goal owns no work of its own.
--
-- 3. cp_goal_events — an append-only ledger, kind win | hindrance.
--    Deliberately durable rather than re-derived on every render: the ask was
--    "a record of my success that I don't have to manage", and live derivation
--    only satisfies the second half. Delete or relabel the underlying task and
--    the win silently disappears. So the reconciler writes a row once,
--    SNAPSHOTS the title as it read at the time, and never deletes it. A source
--    that vanishes is marked orphaned, not forgotten.
--
--    Hindrances are recorded as SPANS (opened_at / closed_at) rather than a
--    live flag. "Shipped the CSA model despite being blocked on Ludo for six
--    weeks" is the sentence a performance review actually needs, and a flag
--    that clears itself can never produce it.
--
-- ids are TEXT to match every other cp_* table (client-generated, no FKs
-- between cp_* tables — links are resolved app-side).
--
-- Apply by hand BEFORE the code that writes these ships:
--   supabase db query --project-ref xsmnfcmtbpeaccnyinkr \
--     < supabase/migrations/20260813120000_cp_goals.sql

-- ── 1. when a task was actually finished ────────────────────────────
alter table public.cp_tasks add column if not exists completed_at timestamptz;

-- One-time backfill. updated_at is the best available approximation for tasks
-- finished before this column existed: an upper bound, never earlier than the
-- real completion. The `is null` guard makes this re-runnable.
update public.cp_tasks
   set completed_at = coalesce(updated_at, created_at)
 where done = true and completed_at is null;

create index if not exists cp_tasks_completed_idx
  on public.cp_tasks (user_id, completed_at desc) where done = true;

-- ── 2. the goals ────────────────────────────────────────────────────
create table if not exists public.cp_goals (
  id           text not null,
  user_id      uuid not null default auth.uid(),
  title        text not null default '',
  blurb        text,
  kind         text not null default 'goal',      -- goal | competency (the EPR is 50/50)
  weight       int,                               -- % within the goals half
  period       text,                              -- 'FY26' / 'H2 2026'
  status       text not null default 'on-track',  -- on-track | at-risk | hit | missed
  source_note  text,                              -- cp_notes.id this was synced from
  project_ids  text[] not null default '{}',      -- cp_projects.id, joined app-side
  sort         int not null default 0,
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── 3. the ledger ───────────────────────────────────────────────────
create table if not exists public.cp_goal_events (
  id           text not null,
  user_id      uuid not null default auth.uid(),
  goal_id      text not null,
  kind         text not null default 'win',       -- win | hindrance
  source_kind  text not null,                     -- win:  task | artifact | update | manual
                                                  -- hind: blocked | waiting | checkin | drift | decay | stall
  source_id    text,                              -- cp_tasks.id / cp_artifacts.id /
                                                  -- cp_updates.id / cp_projects.id; null = manual
  project_id   text,
  title        text not null default '',          -- SNAPSHOT of the label at the time
  detail       text,                              -- "was blocked on Ludo" / hold reason / "pushed 4x"
  happened_at  timestamptz,                       -- wins
  opened_at    timestamptz,                       -- hindrances: first seen
  closed_at    timestamptz,                       -- hindrances: cleared
  orphaned     boolean not null default false,    -- source row no longer exists
  manual       boolean not null default false,    -- hand-entered; the reconciler never touches it
  dismissed    boolean not null default false,    -- hidden from the record, not destroyed
  created_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- Idempotency for the reconciler: one row per (goal, kind, source). Manual rows
-- have no source_id and are excluded by the predicate, so two hand-logged wins
-- can share wording.
create unique index if not exists cp_goal_events_src_uniq
  on public.cp_goal_events (user_id, goal_id, kind, source_kind, source_id)
  where source_id is not null;
create index if not exists cp_goal_events_goal_idx
  on public.cp_goal_events (user_id, goal_id, happened_at desc);

-- ── RLS: each row visible/writable only by its owner ────────────────
alter table public.cp_goals enable row level security;
drop policy if exists cp_goals_owner on public.cp_goals;
create policy cp_goals_owner on public.cp_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.cp_goal_events enable row level security;
drop policy if exists cp_goal_events_owner on public.cp_goal_events;
create policy cp_goal_events_owner on public.cp_goal_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
