-- Library pins + task groups.
--
-- pinned: the project library is one stream over three different tables
-- (cp_notes, cp_artifacts, cp_assets), so a `pinned` boolean would have to be
-- added to all three and read back in three places. Instead the project owns the
-- pin list as an array of the library's own row keys ('n<id>' note/meeting,
-- 'a<id>' artifact, 'f<id>' asset) — one column, one write path, and it works
-- for row types that get added later. Order in the array is display order, so
-- re-pinning something moves it without touching any of the source tables.
-- Stale keys (the underlying row was deleted) are ignored on read, not cleaned.
--
-- group_label: optional ad-hoc bucket for tasks inside one project ("Phase 1",
-- "Waiting on legal"). Null is the norm and renders exactly as today — no
-- header, no "Ungrouped" bucket — so projects that never use groups look
-- untouched. A group has no row of its own: it exists as long as some task
-- names it and disappears when the last one stops. Note `group` is reserved in
-- Postgres, hence group_label.

alter table public.cp_projects
  add column if not exists pinned jsonb not null default '[]'::jsonb;

alter table public.cp_tasks
  add column if not exists group_label text;
