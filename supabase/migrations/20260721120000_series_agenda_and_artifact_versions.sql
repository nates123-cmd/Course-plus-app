-- Two additions:
--
-- 1. cp_series.standing_agenda — a persistent checklist for a recurring meeting,
--    deliberately distinct from standing_context. standing_context is background
--    ("who they are, what we always cover") fed to AI prep/synthesis prompts;
--    standing_agenda is a literal template that pre-fills every new instance's
--    agenda with no AI call at all.
--
-- 2. cp_artifact_versions — a snapshot of an artifact's title+body taken right
--    before something overwrites it (an AI revision or a manual edit), so any
--    document update can be rolled back.

alter table public.cp_series add column if not exists standing_agenda text;

create table if not exists public.cp_artifact_versions (
  id          text not null,
  user_id     uuid not null default auth.uid(),
  artifact_id text not null,
  title       text not null default '',
  body        text,
  reason      text,                             -- "revised from Jon 1:1" | "manual edit"
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists cp_artifact_versions_artifact_idx
  on public.cp_artifact_versions (user_id, artifact_id, created_at desc);

alter table public.cp_artifact_versions enable row level security;

drop policy if exists cp_artifact_versions_owner on public.cp_artifact_versions;
create policy cp_artifact_versions_owner on public.cp_artifact_versions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
