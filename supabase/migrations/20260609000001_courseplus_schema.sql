-- Course+ (merged Course × Scribe) schema — single-user, per-user RLS on the
-- shared suite project. The merge: a PROJECT carries both the work side
-- (status / priority / due / tasks / milestones / where-it-stands updates) and
-- owns DOCUMENTS (notes/meetings/artifacts), grouped under AREA → project.
-- New cp_* tables so this lives alongside the standalone scribe_* / course_*
-- tables without collision. All tables carry user_id default auth.uid() + RLS.

-- ── areas ──────────────────────────────────────────────────────────
create table if not exists public.cp_areas (
  id           text not null,
  user_id      uuid not null default auth.uid(),
  name         text not null,
  open_default boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── projects (work spine: status-forward, own documents) ───────────
create table if not exists public.cp_projects (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  area_id     text not null,
  name        text not null,
  status      text not null default 'active',  -- active|next-up|on-hold|idea|sent|archived
  priority    int,                              -- 1|2|3 | null
  due         jsonb,                            -- {y,m,d} | null
  blurb       text,
  hold        jsonb,                            -- {waitingOn, checkIn} | null
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── tasks (belong to a project) ────────────────────────────────────
create table if not exists public.cp_tasks (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  project_id  text not null,
  label       text not null default '',
  done        boolean not null default false,
  next        boolean not null default false,   -- the surfaced "next" action
  waiting     text,                             -- "waiting on …"
  due         text,                             -- freeform chip ("Thu") | null
  due_date    jsonb,                            -- {y,m,d} from the calendar | null
  work_type   text,                             -- deep|admin|scheduled | null
  task_status text,                             -- none|next|in-progress|waiting|done
  notes       text,
  src_meeting text,                             -- note id this was promoted from | null
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── milestones (belong to a project) ───────────────────────────────
create table if not exists public.cp_milestones (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  project_id  text not null,
  label       text not null default '',
  state       text not null default 'upcoming', -- upcoming|current|done
  sub         text,
  due         jsonb,                            -- {y,m,d} | null
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── updates ("where it stands" append-only timeline) ───────────────
create table if not exists public.cp_updates (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  project_id  text not null,
  body        text not null default '',
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── notes (documents: note|meeting|artifact; knowledge folds to reference) ──
create table if not exists public.cp_notes (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  kind        text not null default 'note',     -- note|meeting|knowledge|brainstorm|artifact
  title       text not null default '',
  project     text,                             -- home project id, or null
  area        text,                             -- home area id, or null
  projects    text[] not null default '{}',     -- multi-project meetings span these
  people      text[] not null default '{}',
  tags        text[] not null default '{}',
  reference   boolean,                          -- reference flag (overrides legacy)
  date        text,
  updated     text,
  updated_at  timestamptz not null default now(),
  indexed     boolean not null default true,
  status      int not null default 2,           -- 0 Raw / 1 Ready / 2 Indexed
  raw_words   text,
  transcript  text,
  summary     text,
  terms       text[] not null default '{}',
  actions     jsonb not null default '[]'::jsonb,  -- [{text,src,owner,project?}]
  body        jsonb not null default '[]'::jsonb,  -- [{p}|{ul}|{ol}|{links}]
  related     jsonb not null default '[]'::jsonb,  -- [{kind,title,reason}]
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── inbox (untriaged captures) ─────────────────────────────────────
create table if not exists public.cp_inbox (
  id            text not null,
  user_id       uuid not null default auth.uid(),
  title         text not null default '',
  src           text,
  src_icon      text,
  snippet       text,
  suggest       jsonb,        -- {project,confidence} | null
  suggest_multi jsonb,        -- {home,homeLabel,confidence,routes:[{project,count}]} | null
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── artifacts (Claude-generated deliverables, with provenance) ─────
create table if not exists public.cp_artifacts (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  project_id  text not null,
  title       text not null default '',
  art_type    text,                             -- deck|onepager|exec|email
  provenance  text,                             -- "✦ Claude · from N notes"
  from_count  int,
  body        text,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── RLS: each row visible/writable only by its owner ───────────────
alter table public.cp_areas      enable row level security;
alter table public.cp_projects   enable row level security;
alter table public.cp_tasks      enable row level security;
alter table public.cp_milestones enable row level security;
alter table public.cp_updates    enable row level security;
alter table public.cp_notes      enable row level security;
alter table public.cp_inbox      enable row level security;
alter table public.cp_artifacts  enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['cp_areas','cp_projects','cp_tasks','cp_milestones',
    'cp_updates','cp_notes','cp_inbox','cp_artifacts'] loop
    execute format('drop policy if exists %1$s_owner on public.%1$s', tbl);
    execute format($f$
      create policy %1$s_owner on public.%1$s
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid())
    $f$, tbl);
  end loop;
end $$;
