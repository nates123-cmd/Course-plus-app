# OpenClaw → Course+ Agenda fix (deploy from Mac, ~2 min)

**Problem:** OpenClaw can't pull "my schedule for tomorrow." The Course+ **Agenda**
reads `placed_blocks` (the Today app's time-blocked schedule — see
`src/screens/Agenda.jsx`). OpenClaw's `course-plus` bridge only exposes `cp_*`
tables, so it has no path to `placed_blocks`.

**Why it must be done on the Mac:** the Beelink has no Supabase deploy creds (no
service-role key, no `sbp_` CLI token) — verified. Deploy from where `supabase`
CLI is logged in.

This uses a **self-contained new function** so there's no existing source to find.

---

## Step 1 — deploy the function (the only Mac step)

The complete function is committed at `supabase/functions/cp-agenda/index.ts`. It
reuses the bearer `course-plus` already uses (`OPENCLAW_CP_SECRET`, already a
project secret) and the auto-injected service-role key. From this repo:

```bash
supabase functions deploy cp-agenda --no-verify-jwt --project-ref xsmnfcmtbpeaccnyinkr
```

Smoke-test it directly (swap in the real secret — it's in OpenClaw's `.env` as
`OPENCLAW_CP_SECRET`):

```bash
curl -sS -X POST "https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/cp-agenda" \
  -H "authorization: Bearer $OPENCLAW_CP_SECRET" -H "content-type: application/json" \
  -d '{"days":7}'
```

Expect `{"ok":true,...,"days":{...}}`. If you get `{"ok":false,"error":...}`
mentioning a column, `placed_blocks` doesn't use `user_id` — edit `OWNER_COL` at
the top of `index.ts` and redeploy.

## Step 2 — turn the bot skill on (already staged on the Beelink)

The `cp-agenda` skill file is already at
`/home/openclaw/.openclaw/skills/cp-agenda/SKILL.md`, but **inert** (not in the
`skills:` array, so it isn't loaded). To activate, add it to `openclaw.json` and
recreate the container — run as the `openclaw` user (see `/openclaw` for the
sudo/env wrapper):

```jsonc
// /home/openclaw/.openclaw/openclaw.json  → agents.defaults.skills
skills: ["ink-capture", "course-plus", "media-stack", "cp-agenda"],
```
```bash
cd /home/openclaw/openclaw && docker compose up -d --no-build   # recreate, re-reads skills
```

## Verify
Telegram the bot: **"what's my schedule tomorrow?"** → it calls `cp-agenda` with
tomorrow's date and reads back the blocks.

---

### One-shot prompt for a Mac Claude session
> Read `OPENCLAW_AGENDA_PATCH.md` in the Course-plus-app repo and execute it:
> deploy the `cp-agenda` edge function, smoke-test it, then SSH to the Beelink
> (see the `openclaw` skill) to add `cp-agenda` to `openclaw.json`'s skills array
> and recreate the container. Confirm the `placed_blocks` owner column first.
