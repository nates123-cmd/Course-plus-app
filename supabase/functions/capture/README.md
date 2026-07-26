# capture

Plain-REST drop point for dictated text from an Apple Watch Shortcut. One POST, one row in `cp_inbox`, one short line back.

This is the active half of a two-part capture system. The passive ambient desk pipeline is specced separately and is not implemented here.

Endpoint: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture`

The Course Plus MCP server lives in the same project but speaks JSON-RPC with a session envelope, which Shortcuts cannot assemble. This function is a separate, dumber path into the same database. See `SHORTCUT.md` for the phone-side build.

## Contract

| Case | Status | Body |
| --- | --- | --- |
| Valid POST | 200 | `Captured — 23 words` |
| Missing or wrong `x-capture-key` | 401 | `Auth failed` |
| Empty or whitespace-only body | 400 | `Empty capture` |
| Body over 8 KB | 413 | `Capture too long` |
| Any method other than POST | 405 | `POST only` |
| Insert failed | 500 | `Not saved: <reason>` |
| Missing env secret | 500 | `Server misconfigured` |

Responses are always `text/plain` and always one line, because the string is rendered verbatim in a watch notification. A failed insert never returns a success line.

Content type is not enforced. The header is set to `text/plain` on the Shortcut side for correctness, but the function reads the raw body either way, so a content-type mismatch cannot silently eat a capture.

No CORS handling. There is no browser client.

## Schema notes

`cp_inbox` does not have a single "text" column or a `source` column. What it actually has, and how this function maps onto it:

- `id` — `text`, no default, and the primary key is composite `(user_id, id)`. The function mints `watch-<uuid>`, which also makes watch rows greppable.
- `user_id` — `uuid`, defaults to `auth.uid()`, which is null under the service key. Must be supplied explicitly from the `OWNER_ID` secret or the not-null constraint rejects the row.
- `title` — `text not null`. This is the headline in the Inbox list, so it cannot be left empty. The function uses the dictated text flattened to one line and cut at 80 characters on a word boundary. This is truncation for display, not parsing.
- `snippet` — the full dictated text, untouched. This is the real payload.
- `src` — provenance. Set to `watch`. This is the column the brief called `source`.
- `src_icon` — left null.
- `tags` — left empty. No tagging, no project inference, no routing.
- `created_at` — defaults to `now()`, not supplied.

## Secrets

Reads four, sets none:

- `CAPTURE_KEY` — shared secret, compared in constant time. Both sides are SHA-256'd to a fixed 32 bytes before the byte compare so differing lengths cannot leak through an early return.
- `OWNER_ID` — already set on the project; shared with `gmail-ingest`.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — platform-provided.

## Deploy

```
supabase secrets set CAPTURE_KEY=$(openssl rand -hex 24) --project-ref xsmnfcmtbpeaccnyinkr
supabase functions deploy capture --no-verify-jwt --project-ref xsmnfcmtbpeaccnyinkr
```

`--no-verify-jwt` is required. The shared secret is the auth mechanism; Shortcuts carries no Supabase JWT.

## Smoke test

```
KEY=<the capture key>
URL=https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture

# 200
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$URL" \
  -H "x-capture-key: $KEY" -H 'content-type: text/plain' \
  --data-binary 'Smoke test from the watch capture endpoint.'

# 401
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$URL" \
  -H 'x-capture-key: wrong-key' -H 'content-type: text/plain' \
  --data-binary 'should not be saved'

# 400
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$URL" \
  -H "x-capture-key: $KEY" -H 'content-type: text/plain' --data-binary ''

# 405
curl -sS -w '\nHTTP %{http_code}\n' "$URL"

# 413
python3 -c "print('word '*2000, end='')" > /tmp/big.txt
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$URL" \
  -H "x-capture-key: $KEY" -H 'content-type: text/plain' --data-binary @/tmp/big.txt
```

Confirm the row with `list_inbox` on the Course Plus MCP server. `src` should read `watch`.

## Documented, not built

Neither of these is implemented. They are recorded here so the decision is not re-litigated from scratch.

**Task variant.** Duplicate the Shortcut and have it send `{"text": "...", "task": true}` as `application/json`. The function would branch on content type, tag the capture `watch:task`, and a later batch pass would route tagged captures to `create_task` instead of filing them as a note. Not built because it doubles the Shortcut surface for a distinction that is easy to make at triage time. Note that adding it means content type stops being advisory and starts being load-bearing.

**Rate limiting.** There is none. The endpoint is publicly reachable and unauthenticated apart from the shared secret, and it writes a database row per request. At one user on a wrist this does not matter. It would matter if the key ever leaked, since the failure mode is unbounded inbox rows rather than data exposure. If that becomes a concern, the cheap fix is a per-minute cap keyed on `OWNER_ID` before the insert.
