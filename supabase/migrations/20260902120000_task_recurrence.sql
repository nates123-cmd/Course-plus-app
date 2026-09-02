-- Recurring tasks.
--
-- Model: completing a recurring task SPAWNS the next occurrence as a new row and
-- leaves the completed one in place. It is deliberately not "roll the same row's
-- due date forward" — cp_goals reads completed_at off finished tasks to build the
-- wins ledger, and a rolling row would record one win no matter how many times
-- the chore actually got done.
--
-- recurrence  the rule, carried on EVERY occurrence (it travels with the task so
--             any occurrence can be edited or stopped on its own):
--               { freq: 'daily'|'weekly'|'monthly'|'yearly',
--                 interval: int >= 1,
--                 weekdays: [0..6],     -- weekly only, 0 = Sunday
--                 monthDay: int|'last', -- monthly only
--                 from: 'due'|'completion',
--                 until: {y,m,d}|null,
--                 count: int|null }
-- recur_parent  id of the FIRST task in the series — series identity, so every
--               occurrence of one chore can be found together.
-- recur_index   0-based occurrence number, so `count` can be enforced.
-- recur_spawned this occurrence already produced its successor. The idempotency
--               guard: ticking done → undone → done must not fork the series.
alter table public.cp_tasks add column if not exists recurrence    jsonb;
alter table public.cp_tasks add column if not exists recur_parent  text;
alter table public.cp_tasks add column if not exists recur_index   int     not null default 0;
alter table public.cp_tasks add column if not exists recur_spawned boolean not null default false;

create index if not exists cp_tasks_recur_parent_idx
  on public.cp_tasks (user_id, recur_parent) where recur_parent is not null;
