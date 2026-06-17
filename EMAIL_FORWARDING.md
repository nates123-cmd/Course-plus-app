# Email forwarding → Course+ Inbox

Forward (or auto-forward) any email into the Course+ **Inbox**, then triage it onto a
project with the existing Inbox UI. A leading `[Project]` / `#project` token in the
subject auto-suggests the matching project (so "Triage all" files it in one tap);
otherwise it lands plain for manual triage.

Built on the **Gmail API** (reusable later for sending, smarter filters, etc.), not a
third-party inbound provider.

```
You forward mail ─▶ Gmail label "course-plus" ─▶ gmail-ingest edge fn (on a schedule)
                                                   └▶ cp_inbox row ─▶ Inbox triage ─▶ project note
```

## How it works
- `supabase/functions/gmail-ingest/index.ts` — refreshes a Google token, lists mail
  carrying the `course-plus` label, parses subject/from/body, inserts a `cp_inbox` row
  under your `user_id` (service key + `OWNER_ID`, bypassing RLS), records it in
  `cp_email_seen`, then strips the label so it never re-ingests.
- The forwarded email's plaintext body becomes the note body when you accept it in
  triage (the Inbox files `snippet` → note). Capped at 8000 chars.

---

## One-time setup (your hands — ~10 min)

### 1. Google Cloud OAuth client
1. console.cloud.google.com → create a project (or reuse one).
2. **APIs & Services → Library →** enable **Gmail API**.
3. **OAuth consent screen →** External, app name anything, add your Gmail as a **Test user**
   (testing mode is fine — no verification needed for your own account).
4. **Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the
   **Client ID** and **Client secret**.

### 2. Get a refresh token
From the repo root:
```bash
GMAIL_CLIENT_ID='…' GMAIL_CLIENT_SECRET='…' node scripts/gmail-login.mjs
```
Approve in the browser (pick the account you forward from). It prints a
`supabase secrets set …` command — run it.

**Multiple accounts** (e.g. personal + work): run `gmail-login.mjs` once per account,
then set `GMAIL_REFRESH_TOKEN` to all the tokens **comma-separated** (no spaces):
`GMAIL_REFRESH_TOKEN='token_a,token_b'`. The fn loops every account; one account
failing (missing label, revoked token) does not block the others. Dedup/inbox keys are
namespaced per account, so a shared Gmail message id can never collide.

### 3. Set the remaining secrets
```bash
supabase secrets set \
  OWNER_ID='<your auth.users uuid>' \
  INGEST_SECRET='<any long random string>' \
  --project-ref xsmnfcmtbpeaccnyinkr
```
Find your uuid: Supabase dashboard → Authentication → Users → your row, or run
`select id from auth.users where email='nates123@gmail.com';` in the SQL editor.
(Optional: `GMAIL_LABEL` to rename the trigger label, default `course-plus`.)

### 4. Gmail label + filter
1. Gmail → Settings → Labels → **Create label** `course-plus`.
2. Settings → Filters → **Create a new filter**. Easiest trigger: filter on
   `to:(nates123+courseplus@gmail.com)` → **Apply label** `course-plus`, **Skip Inbox**.
   Now forward anything to `nates123+courseplus@gmail.com` and it ingests.
   (Or just hand-apply the `course-plus` label to any message.)
3. To route to a project, edit the forwarded **subject** to start with `[Project Name]`
   or `#projectid`. No prefix = lands for manual triage.

### 5. Deploy + schedule
The function is deployed via the Supabase MCP / CLI (`gmail-ingest`, verify_jwt=false).
Schedule it with pg_cron (run once in the SQL editor — substitute INGEST_SECRET):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('gmail-ingest', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/gmail-ingest',
    headers := '{"x-ingest-secret":"<INGEST_SECRET>"}'::jsonb
  );
$$);
```

## Test
```bash
curl -s -H "x-ingest-secret: <INGEST_SECRET>" \
  https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/gmail-ingest | jq
```
Forward an email to the trigger address, hit the curl, then open Course+ → Inbox.
Returns `{ ingested, scanned, items }`.

## Notes / landmines
- Google only returns a **refresh token on first consent**. If `gmail-login.mjs` prints
  no refresh token, revoke the app at myaccount.google.com/permissions and rerun.
- Testing-mode OAuth tokens can expire after ~7 days of inactivity; ingesting every
  5 min keeps it warm. Publish the consent screen if it ever lapses.
- `cp_email_seen` + label-strip both dedupe — a message is never ingested twice.
- Scope is `gmail.modify` (read + label). Add `gmail.send` later for outbound.
