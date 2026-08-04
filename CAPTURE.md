# Capture

Getting words into Course+ from away from a desk. Three paths, all live, all
verified 2026-07-28. Branch `worktree-watch-capture`, PR #10.

## Pick up here

**Next action: build the two share-sheet shortcuts** in
`supabase/functions/capture-audio/SHORTCUT.md`. Both endpoints were proven with
curl against real files, but neither shortcut has been run from the phone yet.

Then, in order:

1. Record a real multi-person meeting. Do speaker labels hold up on room audio,
   as opposed to the synthetic two-voice test they were proven against?
2. Compare the wrist mic to a phone lying flat on the table. Expectation is the
   phone wins, and if it does, the watch is for solo capture only.
3. Decide whether the Beelink still earns a role. The free on-device path may
   have made local whisper unnecessary.

Parked, deliberately: a native watchOS recorder (see the bottom of this file)
and the $99 Apple Developer Program.

## The three paths

| Endpoint | Trigger | Lands in | Speed | Cost | Speaker labels |
| --- | --- | --- | --- | --- | --- |
| `/capture` | Wrist dictation, capped ~60s | **routed** (see below) | seconds | ~0.1c | n/a |
| `/capture-audio/text` | Share Transcript, solo | `cp_notes` | instant | free | no |
| `/capture-audio` | Share the recording, meetings | `cp_notes` | minutes | ~27c/hr | yes |

**`/capture` is routed, not filed.** It classifies the dictation and writes a
real record in whichever suite app it belongs to — a Course+ task or note, a
Stock shopping item, an Ink thought, a Break look-up — because an inbox row is
the chore the router exists to remove. Anything unroutable or low-confidence
still falls back to `cp_inbox`, so no capture is ever lost. Full write-up,
landmines, and deploy steps: `supabase/functions/_shared/router/README.md`.

The router is a shared module rather than part of the `capture` function
because the long-form path already produces a transcript, so funnelling a
recorded conversation into the same destinations is the same problem with a
longer input. That is not wired up yet.

All three take the same `CAPTURE_KEY` shared secret in an `x-capture-key`
header, compared in constant time, and all are deployed `--no-verify-jwt`
because Shortcuts carries no Supabase JWT. All answer with a single short line
of `text/plain`, because the response is rendered verbatim in a notification and
read at arm's length.

The choice between the two long-form paths is made by **which share action you
tap in Just Press Record**, not by a menu. Each shortcut filters the share sheet
by input type, so only the correct one appears for what you are sharing.

## Why it is shaped this way

Apple's `Dictate Text` action stops at about 60 seconds, confirmed on-device.
Stop Listening set to On Tap does not lift it. That cap is not fixable from our
side, so long-form capture had to split recording from transcription: the client
only records, and something else turns audio into text afterwards.

The MCP server is not a viable POST target for Shortcuts. It speaks JSON-RPC
with a session envelope, which Shortcuts cannot assemble. Hence plain REST.

Audio is never persisted by us. It is streamed through to AssemblyAI and
forgotten. The client keeps the original until it sees a 200, because a
recording that only ever existed in flight is one you can lose.

## Landmines

**`cp_inbox` column names.** No `body` column, no `source` column. Provenance is
`src`. There is no single text column: full text goes in `snippet`, and `title`
is `not null` so it always needs something. Primary key is composite
`(user_id, id)` and `id` is `text` with no default, so ids must be minted.
`user_id` defaults to `auth.uid()`, which is **null under the service key**, so
`OWNER_ID` must be passed explicitly. Same applies to `cp_notes`.

**The Beelink can never read iCloud Drive.** No Linux client exists. Any design
where the Beelink picks files out of iCloud is dead on arrival. Getting a file
off the phone has to be a push from the phone. The Beelink's legitimate role
here would be replacing AssemblyAI with local whisper, not file transport.

**Bitrate.** Just Press Record writes mono AAC at about 68 kbps, so an hour is
roughly 30 MB. The cap started at 40 MB, which would have bounced long meetings,
and is now 150 MB. An early estimate of 62 MB/hour was wrong, inflated by
container overhead on a very short file.

**`list_notes` over the Course+ MCP exceeds the token limit** at around 128k
characters. Grep the saved tool-result file instead of reading it.

**Supabase secrets are write-only.** `supabase secrets list` shows digests only.
`CAPTURE_KEY` therefore exists in exactly two places: inside the Shortcuts, and
wherever it was filed when generated. Rotating means
`supabase secrets set CAPTURE_KEY=$(openssl rand -hex 24) --project-ref xsmnfcmtbpeaccnyinkr`
and pasting the new value into each shortcut. No redeploy needed.

## Just Press Record

£/$6.99 one time, Open Planet Software Ltd, Inverurie, Scotland. Their policy:
audio and transcripts never reach their servers; transcription runs through
Apple's framework; storage is local or your iCloud Drive by your choice.

- Mac iCloud container:
  `~/Library/Mobile Documents/iCloud~com~openplanetsoftware~just-press-record/Documents/YYYY-MM-DD/HH-MM-SS.m4a`
- It transcribes on-device for free and **embeds the result in the m4a** as a
  `JPR2` JSON blob: base64 text at `txscriptv2.tx._data`, plus word-level
  timestamps and a `srcwatch: true` flag on watch-originated recordings.
  Readable with `strings`.
- On-device transcription survives length. A 70-second recording came back
  complete at 178 words with usable punctuation. An earlier 148-second file with
  an empty transcript turned out to be silence, not a failure.
- Records on the watch with the phone absent, which is what the native app was
  going to be for.

## Parked: native watchOS app

Swift sources are committed under `watch/CourseCapture/` and have **never been
compiled**. There is no Xcode project; work stopped before it was written.

What is there: a standalone watchOS recorder using `AVAudioRecorder`, uploading
over a background `URLSession`, deleting a recording only after the server
confirms receipt and retrying anything unconfirmed on next launch. Audio
interruptions are surfaced rather than papered over, because watchOS ends a
recording on an incoming call or Siri and that limit deserves to be visible.

Reasons it is parked rather than dead:

- The Apple Developer Program is $99/year, and free provisioning expires every
  7 days, which is disqualifying for something you rely on to catch a meeting.
- Native breaks the ship loop. A headless Claude can push a PWA; it cannot
  install a build onto a phone. The patchfix daemon stops being able to clear
  anything native.
- Just Press Record already solves interruptions, storage pressure, and sync,
  for $6.99.

If it is ever resumed, the rule is to keep the watch app dumb: it records and
uploads, and every piece of logic that actually changes lives behind the API
where it can still be shipped instantly.
