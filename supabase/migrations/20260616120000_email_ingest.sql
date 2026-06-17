-- Email forwarding → Inbox ingestion.
-- The `gmail-ingest` edge function reads forwarded mail from a Gmail label and
-- drops each message into cp_inbox (under the owner's user_id). This table is the
-- idempotency ledger so a message is never ingested twice (belt-and-suspenders
-- with the Gmail label-strip the function also performs).
create table if not exists public.cp_email_seen (
  message_id text primary key,        -- Gmail message id
  user_id    uuid not null,           -- owner the inbox row was filed under
  created_at timestamptz not null default now()
);

-- Service-role only: RLS on with no policies. The edge function uses the service
-- key (bypasses RLS) to read/write this ledger; clients can never see it.
alter table public.cp_email_seen enable row level security;
