-- Assets: hosted screenshots / PDFs / files for Course+, attachable to a project
-- or a note. The "interpret once, markdown forever" pattern — on upload the file
-- is interpreted ONCE by a Claude vision model and the result stored in
-- extracted_md, so every engine (Claude + Deepseek) can later read it as plain
-- text. The original bytes live in the private `cp-assets` storage bucket and are
-- only fetched for human viewing or re-extraction.
--
-- NOTE: project_id / note_id are TEXT to match cp_projects.id / cp_notes.id
-- (the suite uses client-generated text ids, NOT uuids).

create table if not exists public.cp_assets (
  id             text not null,
  user_id        uuid not null default auth.uid(),
  project_id     text,                              -- home project id, or null
  note_id        text,                              -- home note id, or null
  filename       text not null default '',
  mime           text,
  size_bytes     bigint,
  storage_path   text not null,                     -- {user.id}/{uuid}.{ext}
  kind           text not null default 'other',     -- image|pdf|other
  extracted_md   text,                              -- Claude transcription (markdown)
  extract_status text not null default 'pending',   -- pending|done|error|skipped
  created_at     timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── RLS: each row visible/writable only by its owner ───────────────
alter table public.cp_assets enable row level security;
drop policy if exists cp_assets_owner on public.cp_assets;
create policy cp_assets_owner on public.cp_assets
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Private storage bucket ─────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('cp-assets', 'cp-assets', false)
on conflict (id) do nothing;

-- ── storage.objects policies, scoped to the user's id path prefix ──
-- Path is `{auth.uid()}/…`, so the first folder segment must equal the user id.
do $$
declare op text;
begin
  foreach op in array array['select','insert','update','delete'] loop
    execute format('drop policy if exists %I on storage.objects', 'cp_assets_' || op);
  end loop;
end $$;

create policy cp_assets_select on storage.objects for select to authenticated
  using (bucket_id = 'cp-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cp_assets_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cp-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cp_assets_update on storage.objects for update to authenticated
  using (bucket_id = 'cp-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cp-assets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cp_assets_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cp-assets' and (storage.foldername(name))[1] = auth.uid()::text);
