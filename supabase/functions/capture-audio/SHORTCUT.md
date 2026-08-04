# Send to Course+ Shortcuts

Two shortcuts, because there are two ways to get a recording out of Just Press
Record and they want different treatment.

- **Share Transcript** gives you text that Apple already transcribed on-device.
  Free, instant, nothing but the finished words leaves your phone. No speaker
  labels.
- **Share the recording** gives you the audio file. Costs about 27 cents an
  hour, takes a few minutes, and comes back with speaker labels.

Use the transcript for solo captures. Use the audio for anything with more than
one person in the room.

You do not have to choose in a menu. Each shortcut filters the share sheet by
input type, so only the right one appears for what you are sharing.

---

## Shortcut 1: Send Transcript to Course+

1. Open Shortcuts on iPhone, tap `+`.
2. Name it `Send Transcript to Course+`.
3. Open the details (info button).
4. Enable **Show in Share Sheet**.
5. Under **Share Sheet Types**, turn everything OFF except **Text**. This is what keeps it from appearing when you share audio.
6. Back in the editor, add action: **Get Contents of URL**.
7. URL: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture-audio/text`
8. Tap **Show More**.
9. **Method**: `POST`.
10. Header: `x-capture-key` = the CAPTURE_KEY secret. The long hex string itself, not the words `CAPTURE_KEY`.
11. Header: `content-type` = `text/plain`.
12. **Request Body**: **File**.
13. Insert the **Shortcut Input** variable into the Request Body field.
14. Add action: **Show Notification**, body = **Contents of URL**.

Expect `Filed — 178 words` back. The note is already written when you see that.

---

## Shortcut 2: Send Recording to Course+

1. New shortcut, name it `Send Recording to Course+`.
2. Details, enable **Show in Share Sheet**.
3. Under **Share Sheet Types**, turn everything OFF except **Media** and **Files**.
4. Add action: **Get Contents of URL**.
5. URL: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture-audio`
6. **Show More**, **Method**: `POST`.
7. Header: `x-capture-key` = the CAPTURE_KEY secret.
8. Header: `content-type` = `audio/m4a`.
9. **Request Body**: **File**.
10. Insert the **Shortcut Input** variable.
11. Add action: **Show Notification**, body = **Contents of URL**.

Expect `Sent 4.2 MB — transcribing`. That means accepted, not finished. The note
appears a few minutes later.

---

## Use it

1. Record in Just Press Record. Watch or phone.
2. If you recorded on the watch, wait for it to sync to the phone.
3. Open the recording on the iPhone.
4. Solo capture: **Share Transcript**, then `Send Transcript to Course+`.
5. Meeting: share the **recording**, then `Send Recording to Course+`.
6. Find it in Course+ under meetings, titled `Recording <date>, <time>`.

Notes are tagged `watch` and `recording`, plus `on-device` or `transcribed` so
you can tell at a glance which path produced them.

## What the notifications mean

| Notification | Meaning | What to do |
| --- | --- | --- |
| `Filed — 178 words` | Written. The note exists now. | Nothing. |
| `Sent 4.2 MB — transcribing` | Audio accepted, transcript being made. | Check Course+ in a few minutes. |
| `Auth failed` | The `x-capture-key` header is missing or wrong. | Exact value, no trailing space. |
| `Empty transcript` | No text arrived. | The recording may not have been transcribed yet. Open it in the app first. |
| `Empty recording` | No file arrived. | Request Body was probably not set to File. |
| `Recording too large` | Over 150 MB, roughly five hours. | Split it. |
| `Upload failed: ...` | Transcription service rejected the audio. | Retry once, then check the format. |
| `Not saved: ...` | Reached us but the database write failed. **Nothing was saved.** | Keep the recording. Check the function logs. |
| `Server misconfigured` | A secret is missing on the function. | Check `CAPTURE_KEY`, `OWNER_ID`, `ASSEMBLYAI_API_KEY`. |

## Notes

- **Keep the recording until you see the note.** Nothing is stored on our side. Audio is streamed through to the transcription service and forgotten.
- On-device transcription holds up over length. A 70-second recording came back complete at 178 words with usable punctuation.
- Recordings run about 68 kbps mono, so an hour is roughly 30 MB.
- The CAPTURE_KEY is the same secret the wrist dictation shortcut uses. Supabase secrets are write-only, so it exists only inside your shortcuts and wherever you filed it.
