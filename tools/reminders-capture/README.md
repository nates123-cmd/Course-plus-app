# Reminders capture

Say **"Hey Siri, add eggs to capture"** from a raised wrist. A minute later it's
on the Stock shopping list.

Zero taps, no app to open, no Mac involved, works offline (Siri queues it and it
syncs when the watch reconnects).

```
"Hey Siri, add eggs to capture"
        │
        ▼
  iCloud Reminders — list "capture"
        │  CalDAV, app-specific password
        ▼
  Beelink poller  (systemd user timer, every 60s)
        │  POST text/plain
        ▼
  /capture → router → Stock / Course+ / Ink / Break
        │
        ▼
  reminder marked complete
```

## Why CalDAV, and why the Beelink

iCloud **Drive** is an Apple-only surface. Anything reading Just Press Record's
folder has to run on a Mac, which means captures only route while the laptop is
awake. (rclone does now ship an iCloud Drive backend for Linux, but its trust
token expires every 30 days and needs an interactive 2FA prompt — a capture
pipeline that dies monthly is worse than none, because you keep trusting it.)

Reminders are different: plain RFC 4791 CalDAV at `caldav.icloud.com`,
authenticated with an **app-specific password** that doesn't rotate. So this can
live on the box that is always on, and the credential on that box cannot change
the Apple account.

Marking the todo complete is what stops it being picked up again, so there is no
cursor to keep in sync. Completion also means a misroute is still recoverable —
the original sits in the Reminders completed view, alongside the `capture_log`
row.

## Setup

Everything below is already installed on the Beelink except the secrets.

Fill in `~/apps/capture-router/.env` (mode `600`, never committed):

```sh
APPLE_ID=you@example.com
APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx   # appleid.apple.com → Sign-In and Security
CAPTURE_LIST=capture
CAPTURE_URL=https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture
CAPTURE_KEY=                              # same secret the Supabase function holds
```

Then:

```sh
systemctl --user start capture-reminders.timer
systemctl --user start capture-reminders.service   # run one cycle now
journalctl --user -u capture-reminders -n 30 --no-pager
```

A successful line reads:

```
routed 'eggs' -> Stock: eggs -> shopping list
```

## Failure behaviour

Nothing is dropped. An item is only completed after the endpoint returns 200.

| Situation | What happens |
| --- | --- |
| Network or endpoint down | Item stays pending, retried next minute |
| Endpoint returns non-200 | Logged with the status and body, item stays pending |
| Routed but completion write failed | UID cached in `~/.local/state/capture-reminders/seen.json` so it is not routed twice; the orphan stays visible in the list |
| Beelink was off | `Persistent=true` catches up on boot |

The seen-cache exists only for that one narrow window. Without it, a failed
completion would re-route the same item every minute — silently duplicating a
task or a shopping entry until someone noticed.

## SHARED-LIST MODE — read before pointing this at your default list

Today this only touches the list named in `CAPTURE_LIST`, and everything in that
list is assumed to be meant for routing. That assumption is the entire safety
model.

Pointing `CAPTURE_LIST` at the default Reminders list is **not** a config change
alone. Most items there are genuinely reminders — "call Mom at 5" should stay a
reminder — so shared mode needs a third outcome this script does not have:
*leave it alone entirely*. Don't route, don't complete, don't touch.

What it would take:

1. The confidence floor flips meaning. On a dedicated list, low confidence means
   "file to cp_inbox". On the default list it has to mean "not mine, hands off".
2. Add a not-mine signal to the classifier, distinct from `unknown`.
3. Use the due date as a hint — an item with a due date or alarm is probably a
   real reminder; one without is probably a capture.
4. Dry-run for a week, logging what it *would* have routed, before it writes.

Until that exists, changing `CAPTURE_LIST` to the default list will consume real
reminders.

## Files

| Path | What |
| --- | --- |
| `poll.py` | The poller |
| `capture-reminders.service` | Oneshot unit, reads secrets from `.env` so `systemctl cat` never prints them |
| `capture-reminders.timer` | Every 60s, `Persistent=true` |

Deployed to `~/apps/capture-router/` on the Beelink; units in
`~/.config/systemd/user/`. No sudo — the account has `Linger=yes`.

## Pick up here

**Blocked on two secrets in `.env`: `APPLE_APP_PASSWORD` and `CAPTURE_KEY`.**
Nothing else is outstanding. Once they're in, start the timer and say
"Hey Siri, add eggs to capture".

Untested end to end: the CalDAV connection has never authenticated, so list
discovery and the todo shape are unverified against real iCloud.
