-- Study: deep dives + graded recall runs, for WORK material.
--
-- Break (the 5-minute app) already has a `deep_dives` table with the same shape
-- of idea, but that deck is deliberately the fun one - curiosity topics, world
-- knowledge, an atomic flashcard deck underneath it. Work material must not land
-- in it. So Course+ gets its own tables under the cp_* prefix and never reads or
-- writes Break's `deep_dives` / `flashcards`. Two decks, no bleed.
--
-- What is different here, beyond the separation: a Course+ dive is built FROM
-- the user's own corpus - a meeting transcript, a note, an artifact, or a whole
-- project's state - not from the model's world knowledge. So a dive carries a
-- source_ref back to the document it came from, and a project_id so drills can
-- be scoped to what a meeting is actually about.
--
-- NOTE: id / project_id / source_ref are TEXT to match cp_projects.id and
-- cp_notes.id (the suite uses client-generated text ids, NOT uuids).

create table if not exists public.cp_dives (
  id               text not null,
  user_id          uuid not null default auth.uid(),
  title            text not null default '',
  prompt           text not null default '',        -- the "explain this" ask, never reveals the answer
  summary          text,                            -- one line, shown on the shelf
  key_points       jsonb not null default '[]'::jsonb,  -- [{ text }] - what a strong answer must hit
  source           text not null default 'manual',  -- manual|note|meeting|artifact|project
  source_ref       text,                            -- cp_notes.id / cp_artifacts.id it was built from
  source_label     text,                            -- human label of that source, for the shelf
  project_id       text,                            -- home project, or null
  area_id          text,                            -- home pillar, or null
  last_reviewed_at timestamptz,
  last_bucket      text,                            -- miss|hard|easy from the newest run
  review_count     integer not null default 0,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  primary key (user_id, id)
);

-- Every graded attempt, kept. Break throws its results away (it only stamps
-- last_reviewed_at) because there the point is the reading, not the record. For
-- work the record IS the point: "what am I still shaky on before Thursday" is
-- only answerable if the misses are stored.
create table if not exists public.cp_dive_runs (
  id           text not null,
  user_id      uuid not null default auth.uid(),
  dive_id      text not null,
  mode         text not null default 'type',        -- mental|type|speak
  bucket       text,                                -- miss|hard|easy
  hit_count    integer,
  total_count  integer,
  answer       text,                                -- what the user actually said/wrote
  feedback     text,                                -- Claude's prose response
  verdicts     jsonb not null default '[]'::jsonb,  -- [{ index, hit }] per key point
  created_at   timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists cp_dives_project_idx on public.cp_dives (user_id, project_id);
create index if not exists cp_dive_runs_dive_idx on public.cp_dive_runs (user_id, dive_id, created_at desc);

-- RLS: each row visible/writable only by its owner.
alter table public.cp_dives enable row level security;
drop policy if exists cp_dives_owner on public.cp_dives;
create policy cp_dives_owner on public.cp_dives
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.cp_dive_runs enable row level security;
drop policy if exists cp_dive_runs_owner on public.cp_dive_runs;
create policy cp_dive_runs_owner on public.cp_dive_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
