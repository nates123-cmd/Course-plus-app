# Long-Form Capture — Design Brief

Written 2026-07-26. This is a design brief, not a build spec. It exists to be
brought into a fresh conversation with no prior context, so it restates
everything relevant including things already known elsewhere.

---

## 1. What this is about

There is a working "quick capture" path from an Apple Watch into the Course
Plus inbox. It is capped at roughly 60 seconds by Apple's dictation engine.
The goal now is a **long-form capture path: 30 minutes or more of continuous
speech, landing as text in Course Plus.**

The 60-second cap is not a bug in what was built. It is a hard limit of the
Shortcuts `Dictate Text` action, confirmed empirically on-device. No amount of
configuration on our side moves it. Long-form therefore requires a different
primitive: record audio, transcribe it, then post the text. That is a
different pipeline, not a tweak.

---

## 2. What already exists and works

### The `capture` edge function

- Live at `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture`
- Source: `supabase/functions/capture/index.ts` in repo `nates123-cmd/Course-plus-app`
- Deployed with `--no-verify-jwt`
- Accepts `POST` with a raw `text/plain` body. Not JSON. This was deliberate,
  to remove the JSON-assembly step from Shortcuts.
- Auth: `x-capture-key` header compared in constant time against a
  `CAPTURE_KEY` Supabase secret
- Inserts one row into `cp_inbox` with `src` = `watch`
- Returns a single short line of `text/plain`, because the string is rendered
  verbatim in a watch notification
- Verified end to end: 200 / 401 / 400 / 405 / 413 all confirmed by curl, and
  a real dictated capture from the built Shortcut landed correctly

### The "Capture" Shortcut

Built and working. Three actions: `Dictate Text` (Stop Listening: On Tap) into
`Get Contents of URL` (POST, headers `x-capture-key` and `content-type:
text/plain`, Request Body: **File** = Dictated Text) into `Show Notification`
(Contents of URL).

**This should probably stay exactly as it is.** It is a good quick-capture
tool. Long-form should be built alongside it, not as a replacement, unless the
design concludes otherwise.

---

## 3. Environment facts, verified 2026-07-26

These were checked directly. Do not re-derive them, and do not assume the
opposite.

**Voice Memos is not a viable Mac transport.**
`Voice Memos.app` is **not installed** on the Mac (macOS 26.2). Nothing in
`/System/Applications`, nothing in Spotlight. The group container
`~/Library/Group Containers/group.com.apple.VoiceMemos.shared` exists but is
empty, with no `Recordings` subfolder, and stayed empty after a test recording
was made on the watch. So the obvious architecture (watch records to Voice
Memos, iCloud syncs it to a Mac folder, a launchd watcher picks it up) does
not work on this machine without first reinstalling the app, and even then the
sync leg is unproven.

**A local transcriber already exists on the Mac.**
The Murmur app at `~/Developer/Murmur-app` runs MLX Whisper (`whisper_model:
"turbo"`, see `config.py`) inside its own venv, plus an MLX Qwen model for
cleanup. It works. It is free and on-device. It requires the Mac to be awake.
Note the standing landmine: iCloud evicts venvs under `~/Documents`, which is
why Murmur lives under `~/Developer`.

**`ffmpeg` is installed** at `/opt/homebrew/bin/ffmpeg`.

**A cloud transcription key is already provisioned.**
`ASSEMBLYAI_API_KEY` is already set as a secret on the Supabase project. So is
`ANTHROPIC_API_KEY`, `OWNER_ID`, and the service role key. No new billing
relationship is needed to go the cloud route.

**There is also a browser-side Whisper engine** already shipped in Course+ and
built in Scribe (transformers.js, `src/lib/whisper.js`). Relevant only if the
design routes through a web page rather than a phone or watch.

---

## 4. The database target

Course Plus tables are `cp_*` on Supabase project `xsmnfcmtbpeaccnyinkr`, with
per-user RLS. The inbox table has a shape that trips people up:

- Table is `cp_inbox`
- There is **no `body` column and no `source` column**
- Provenance lives in **`src`** (the quick-capture path writes `watch`)
- There is **no single text column**. Full text goes in **`snippet`**, and
  **`title` is `not null`**, so something must always be supplied for it. The
  quick-capture function uses a word-boundary truncation of the text at 80
  characters, purely for the Inbox list headline.
- Primary key is **composite `(user_id, id)`**, and `id` is `text` with **no
  default**, so ids must be minted by the caller
- `user_id` defaults to `auth.uid()`, which is **null under the service key**,
  so `OWNER_ID` must be passed explicitly or the insert fails a not-null
  constraint
- `created_at` defaults to `now()`
- `tags` is `text[]`, default empty

Also available and possibly a better home for a long transcript: `cp_notes`
(docs and meeting transcripts, which already has a transcript concept),
`cp_projects`, `cp_tasks`, `cp_artifacts`. The MCP server exposes
`create_note`, `list_inbox`, `triage_inbox` and others.

---

## 5. The actual constraint that killed the obvious answer

30 minutes of steady speech is roughly 4,000 to 4,500 words, which is about
25 KB of text. The current `capture` endpoint rejects anything over 8 KB with
`Capture too long`. **Any long-form path either raises that cap or uses a
different endpoint.** Worth deciding deliberately rather than bumping the
number reflexively, because the 8 KB cap is currently doing useful work as a
sanity check on the quick path.

---

## 6. Open questions the design needs to answer

These are the real forks. They are listed because they change the architecture,
not because they are nice to think about.

1. **Is the phone present during capture?**
   If yes, iPhone Shortcuts has a `Record Audio` action with no 60-second cap
   that can POST a file directly, and the whole problem gets much smaller. If
   the requirement is genuinely phoneless for 30 minutes (running, for
   example), watchOS Shortcuts has no long-form recorder and the answer likely
   involves a third-party watch app or a deliberate manual step. Worth being
   honest about how often the phoneless case actually happens.

2. **Instant or deferred?**
   The quick path confirms on the wrist within a second. A 30-minute
   transcription cannot do that. Is a "queued, will land in a few minutes"
   acknowledgement acceptable, or does the capture need to be confirmed
   complete before the user walks away?

3. **Where does a 30-minute transcript belong?**
   A wall of text in `cp_inbox` is arguably wrong. `cp_notes` may be the right
   home. Or the transcript lands as a note and only a short summary goes to the
   inbox for triage. This is a product decision, not a technical one.

4. **Transcription engine.**
   Three real options, each with a genuine cost:
   - **MLX Whisper via Murmur, on the Mac.** Free, private, already installed.
     Requires the Mac to be awake and reachable, and adds a machine to the
     dependency chain.
   - **AssemblyAI, server-side.** Key already provisioned. Fast, no Mac
     needed, works from anywhere. Costs money per minute and the audio leaves
     the device, which is a real change from the current posture where nothing
     but finished text ever crosses the wire.
   - **The Beelink.** Always on, already runs a media stack and several cron
     pipelines, and could host whisper.cpp. Adds a build step but removes both
     the Mac-awake dependency and the per-minute cost. Note the Beelink runs
     UTC and has no iCloud access.

5. **Chunked or single upload?**
   Streaming 60-second chunks as they are recorded gives partial results and
   survives a dropped connection, but is much more machinery. One file at the
   end is simple and loses everything if the upload fails.

6. **Failure semantics.**
   The v1 rule was: never return a silent success on a failed insert, because a
   dropped thought that looks saved is the worst outcome. That rule matters
   more here, not less, since 30 minutes of thinking is at stake. Should the
   audio be retained locally until a transcript is confirmed in the database?
   Where does it go if transcription fails?

7. **Does the transcript need structure?**
   Timestamps, speaker diarization, paragraph breaks, a Claude cleanup pass
   (Murmur already does cleanup with Haiku or a local Qwen). Raw Whisper output
   over 30 minutes is a difficult read.

---

## 7. Things to carry forward from v1

- Never return a success response for a capture that did not land
- Confirmation must be glanceable, since it may be read on a wrist
- No emojis anywhere, including code, UI strings, and commit messages
- The Course Plus MCP server is not a viable POST target for Shortcuts; it
  speaks JSON-RPC with a session envelope. Plain REST endpoints are the way in.
- Supabase secrets are write-only. `supabase secrets list` shows digests only,
  so any shared secret exists in exactly two places: the client that sends it,
  and wherever it was filed when generated.
- Deploy pattern: `supabase functions deploy <name> --no-verify-jwt --project-ref xsmnfcmtbpeaccnyinkr`

---

## 8. What a good answer looks like

A recommended architecture, with the phoneless question resolved one way or the
other, an explicit choice of transcription engine with its cost stated plainly,
a decision on where the transcript lands, and an honest account of what the
design gives up. The v1 path took about an hour end to end including the
Shortcut. If the proposal is much larger than that, it should say why the
extra machinery earns its keep.
