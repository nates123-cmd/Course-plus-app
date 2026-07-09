-- A task marked work_type='scheduled' (to be discussed in a meeting) can be
-- assigned to the meeting it'll be discussed in: a recurring series (cp_series.id)
-- or a specific meeting note (cp_notes.id). No FK — cp_* refs are app-side.
alter table public.cp_tasks add column if not exists meeting_id text;
