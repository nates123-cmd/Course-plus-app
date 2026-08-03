# Reminders capture

Say **"Hey Siri, add eggs to Capture"** from a raised wrist. A minute later it's
on the Stock shopping list.

Zero taps, nothing to open. Siri is the lowest-friction capture surface on the
watch — a Shortcut costs three taps because it can't be added as a watch
element, and Just Press Record can only write to iCloud Drive or stay
on-device.

```
"Hey Siri, add eggs to Capture"
        │
        ▼
  Reminders — list "Capture"
        │  AppleScript, every 60s
        ▼
  Mac poller (launchd)
        │  POST text/plain
        ▼
  /capture → router → Stock / Course+ / Ink / Break
        │
        ▼
  reminder marked complete
```

Completing the reminder is what removes it from the queue, so there's no cursor
to keep in sync — and a misroute is still recoverable, since the original sits
in the Reminders completed view next to the `capture_log` row.

## Verified working

Measured end to end on 2026-08-03:

| | |
| --- | --- |
| `"I'm out of butter and eggs"` | → two `extras` rows, confidence 0.97 / 0.95 |
| `"look up what a mansard roof is"` | → `look_up_later`, rephrased to *What is a mansard roof?* |
| Empty queue | 0.27s |
| One item | ~23s (about 6s of that is the endpoint) |

Multi-item splitting works: one sentence became two separate shopping items.

## Install

```sh
cp mac/capture-reminders.sh ~/.local/bin/
chmod +x ~/.local/bin/capture-reminders.sh
cp mac/com.nate.capture-reminders.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nate.capture-reminders.plist
```

`~/.config/capture-reminders.env` (mode 600):

```sh
CAPTURE_URL=https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture
CAPTURE_KEY=          # must match the CAPTURE_KEY secret on the Supabase project
```

Log: `~/.local/state/capture-reminders/poller.log`.

## Landmines

- **Scope every AppleScript lookup to the list.** `first reminder whose id is X`
  has no list qualifier, so Reminders scans every reminder in every list to
  resolve one id. That doesn't return in useful time — it presents as a hang,
  and the natural instinct is to blame the network or the endpoint. Cost us a
  3-minute "timeout" that was nothing of the sort. Always
  `first reminder of list "Capture" whose id is X`.
- **Nothing under `~/Documents`.** iCloud evicts files there. Script lives in
  `~/.local/bin`, state in `~/.local/state`.
- **No Python.** Homebrew venvs on this machine break on pyexpat. bash +
  osascript + curl have no install step and nothing to rot.
- **TCC.** The poller needs Reminders access. If reads fail, grant it under
  System Settings → Privacy & Security → Reminders. A denied read looks like an
  empty queue, so the script fails loudly instead.
- **Cold start.** The first run after Reminders has been closed can take minutes
  while the app launches and syncs. Steady state is sub-second when idle.

## Why not the Beelink — do not retry this

The obvious design is a poller on the always-on box. It cannot work, and the
CalDAV attempt is deleted rather than left around to mislead.

When Reminders prompted to "Upgrade" (iOS 13 / Catalina), Apple moved reminders
into **a private store only Apple's own apps can read** and dropped CalDAV. What
survives over CalDAV are legacy stubs — they show up with a `⚠️` in the list
name. A list created today is invisible to any CalDAV client, permanently.

Confirmed empirically: authenticating to `caldav.icloud.com` with an
app-specific password succeeded and returned 13 calendars, two of them VTODO —
`Family ⚠️` and `Reminders ⚠️`. The `Capture` list was not among them. The same
list reads fine from AppleScript on the Mac.

There is one other route — `pyicloud` / `icloud-cli-tools` drive the private web
API behind icloud.com, which does see the modern store and runs on Linux. It was
rejected on three counts: it needs the **real Apple ID password** on the server
(app-specific passwords don't work), 2FA re-auth expires and fails silently, and
it's an unpublished API Apple can break without notice. A capture pipeline that
dies quietly is worse than none, because you keep trusting it.

## Companion: iOS Shortcuts automation

The phone is also an always-on device that reads Reminders natively, so a
time-triggered Shortcuts automation can drain the same list with no Mac
involved. Build it as: **Find Reminders** (List is Capture, Is Completed is
false) → **Repeat with Each** → **Text** (Repeat Item → Name) → **Get Contents
of URL** (POST, `x-capture-key` + `content-type: text/plain`, **Request Body:
File**) → **Mark as Completed**.

Request Body must be **File**, not Text — Text builds a form body and the
endpoint receives nothing usable.

Run it by hand first to prove the POST works, *then* attach the trigger. Those
are two different failure modes and debugging them together is miserable.

Both can run at once. They're idempotent — whoever completes the reminder first
wins and the other finds nothing. The Mac is the frequent backstop for when iOS
declines to fire a background automation, which is the one genuinely unknown
part of that path.

## SHARED-LIST MODE — read before pointing this at your default list

Today everything in `Capture` is assumed to be meant for routing. That
assumption is the entire safety model.

Pointing `CAPTURE_LIST` at the default Reminders list is **not** a config change.
Most items there are real reminders — "call Mom at 5" should stay a reminder —
so it needs a third outcome this doesn't have: *leave it alone entirely*. Don't
route, don't complete, don't touch.

What it would take:

1. The confidence floor flips meaning. On a dedicated list, low confidence means
   "file to cp_inbox". On the default list it has to mean "not mine, hands off".
2. A not-mine signal in the classifier, distinct from `unknown`.
3. Use the due date as a hint — an item with a due date or alarm is probably a
   real reminder; one without is probably a capture.
4. Dry-run for a week logging what it *would* have routed, before it writes.

Until that exists, changing the list name will consume real reminders.
