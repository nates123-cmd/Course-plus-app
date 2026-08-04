# capture-refile — OpenClaw install

Lets a Telegram reply correct a capture the router could not file. Follows the
established OpenClaw bridge pattern: a bearer-gated edge function plus a
SKILL.md, with the service key never leaving the server and the bot holding
only one narrow secret.

## 1. Mint the secret and deploy the function

```bash
REFILE_SECRET=$(openssl rand -hex 24)
echo "$REFILE_SECRET"   # needed in step 2 — copy it now

supabase secrets set OPENCLAW_REFILE_SECRET="$REFILE_SECRET" \
  --project-ref xsmnfcmtbpeaccnyinkr

supabase functions deploy capture-refile --no-verify-jwt
```

`--no-verify-jwt` is required: the bot carries no Supabase JWT and authenticates
with the bearer secret instead.

## 2. Put the secret in BOTH .env files on the Beelink

OpenClaw reads two, and a value in only one silently does not reach the
container:

```bash
ssh nate@100.111.77.98
sudo -u openclaw tee -a /home/openclaw/openclaw/.env <<< "OPENCLAW_REFILE_SECRET=<paste>"
sudo -u openclaw tee -a /home/openclaw/.openclaw/.env <<< "OPENCLAW_REFILE_SECRET=<paste>"
```

## 3. Install the skill

```bash
sudo -u openclaw mkdir -p /home/openclaw/.openclaw/skills/capture-refile
sudo -u openclaw cp SKILL.md /home/openclaw/.openclaw/skills/capture-refile/SKILL.md
```

## 4. Register it

Add `"capture-refile"` to the `skills` array in
`/home/openclaw/.openclaw/openclaw.json`, alongside `ink-capture`,
`course-plus`, `media-stack`.

## 5. Restart

**`up -d` is a no-op when only a bind-mounted skill file changed** — the
gateway will not re-read skills. Restart explicitly:

```bash
sudo -u openclaw env XDG_RUNTIME_DIR=/run/user/1001 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus \
  DOCKER_HOST=unix:///run/user/1001/docker.sock \
  bash -c "cd /home/openclaw/openclaw && docker compose restart"
```

If the daemon itself is down, start rootless dockerd FIRST — see the
restart-after-down runbook in the OpenClaw notes.

## 6. Verify without involving the bot

```bash
curl -sS -X POST "https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture-refile" \
  -H "authorization: Bearer $REFILE_SECRET" \
  -H "content-type: application/json" \
  -d '{"action":"list"}'
```

Expect `{"count":0,"captures":[]}` on a clean inbox, and `401 Auth failed` with
a wrong bearer. Then dictate something deliberately vague, wait for the Telegram
alert, and reply to it.
