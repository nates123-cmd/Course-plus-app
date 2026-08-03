-- capture_log — provenance for every routed voice capture.
--
-- The router writes dictated captures straight into real records (cp_tasks,
-- extras, thoughts, ...) rather than parking them in an inbox, because an
-- inbox row is the chore the router exists to remove. The tradeoff is that a
-- misroute becomes invisible: the capture is filed correctly-looking in an app
-- Nate had no reason to open.
--
-- This table is what buys that back. One row per capture, holding what he
-- actually said and what the router decided, so "recent captures" can be a
-- reviewable strip with re-file and undo rather than an act of faith.

create table if not exists public.capture_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  -- Exactly what was dictated, before any interpretation. This is the record
  -- of last resort when a route turns out to be wrong.
  raw_text    text not null,
  -- Which front door it came through: 'watch', 'audio', 'text'.
  src         text not null,
  -- One entry per record produced, shaped:
  --   { kind, table, record_id, line, confidence, demoted_reason? }
  -- `table` + `record_id` are what an undo needs to find the row again.
  items       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  -- Set when the capture is reverted from the review strip. Kept rather than
  -- deleted so a bad routing pattern stays visible after it is cleaned up.
  undone_at   timestamptz
);

create index if not exists capture_log_user_created_idx
  on public.capture_log (user_id, created_at desc);

alter table public.capture_log enable row level security;

-- Same per-user shape as the rest of the suite: the anon key sees nothing, a
-- signed-in user sees only their own rows, and the service key (which the
-- router runs under) bypasses RLS entirely.
drop policy if exists capture_log_own_rows on public.capture_log;
create policy capture_log_own_rows on public.capture_log
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
