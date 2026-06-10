-- Synthesis: a collapsible "next steps / suggestions" block per meeting.
alter table public.cp_notes add column if not exists next_steps text;
