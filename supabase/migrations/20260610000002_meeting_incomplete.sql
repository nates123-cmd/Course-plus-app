-- Interrupted-meeting safety net: flag meetings that were auto-saved while still
-- in progress (recording cut off / window closed). Cleared when finalized.
alter table public.cp_notes add column if not exists incomplete boolean;
