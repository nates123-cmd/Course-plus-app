-- Meetings as a first-class composer: pre-meeting prep/agenda notes.
-- Live notes live in body (jsonb), transcript in transcript, attendees/speakers
-- in people[], multi-project in projects[], pillar in area, labels in tags[].
alter table public.cp_notes add column if not exists agenda text;
