-- Meeting Series — recurring-meeting entity (e.g. "Jon 1:1") that owns its
-- instances (cp_notes kind='meeting' with series_id), holds standing context +
-- default attendees/links, and powers carry-forward / series synthesis.

create table if not exists cp_series (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'Untitled series',
  people text[] not null default '{}',
  project text,                 -- default home/primary project (nullable)
  area text,                    -- default area/pillar (nullable)
  projects text[] not null default '{}',  -- default "projects discussed"
  standing_context text,        -- who they are + standing agenda; fed to prep/synth
  cadence text,                 -- free label ("weekly"), display-only
  archived boolean not null default false,
  created text,
  updated text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table cp_series enable row level security;

create policy "cp_series owner select" on cp_series for select using (user_id = auth.uid());
create policy "cp_series owner insert" on cp_series for insert with check (user_id = auth.uid());
create policy "cp_series owner update" on cp_series for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cp_series owner delete" on cp_series for delete using (user_id = auth.uid());

-- link a meeting instance to its series (nullable; text id, app-side join)
alter table cp_notes add column if not exists series_id text;
create index if not exists cp_notes_series_id_idx on cp_notes (user_id, series_id);
