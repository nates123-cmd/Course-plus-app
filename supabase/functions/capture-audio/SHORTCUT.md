# Send to Course+ Shortcut

Takes a finished recording from Just Press Record (or Voice Memos, or any audio
file) and sends it to the `capture-audio` endpoint. The transcript lands in
Course+ as a meeting note a few minutes later.

Built in the Shortcuts app on iPhone. Two actions plus a share-sheet setting.

## Build it

1. Open Shortcuts on iPhone, tap `+` to make a new shortcut.
2. Name it `Send to Course+`. This name is what you tap in the share sheet, so keep it recognizable in a long list.
3. Open the shortcut's details (the info button).
4. Enable **Show in Share Sheet**.
5. Under **Share Sheet Types**, turn everything off except **Media** and **Files**. Leaving Text on means the shortcut clutters the share sheet everywhere you copy a word.
6. Go back to the shortcut editor.
7. Add action: **Get Contents of URL**.
8. Set the URL to `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture-audio`.
9. Tap **Show More** to reveal Method, Headers, and Request Body.
10. Set **Method** to `POST`.
11. Under **Headers**, add key `x-capture-key`, value = the CAPTURE_KEY secret. The long hex string itself, not the words `CAPTURE_KEY`.
12. Under **Headers**, add key `content-type`, value `audio/m4a`.
13. Set **Request Body** to **File**.
14. In the Request Body field, insert the **Shortcut Input** variable. This is the audio file handed over by the share sheet.
15. Add action: **Show Notification**.
16. Set the Show Notification body to the **Contents of URL** variable.

## Use it

1. Open Just Press Record and record. Watch or phone, either works.
2. Wait for the watch recording to sync to the phone, if you recorded on the wrist.
3. Tap the recording, then the share button.
4. Choose **Send to Course+**.
5. Read the notification. `Sent 4.2 MB — transcribing` means it is on its way.
6. The meeting note appears in Course+ a few minutes later, titled `Recording <date>, <time>`, tagged `watch` and `recording`, with speaker labels.

## What the notification means

| Notification | Meaning | What to do |
| --- | --- | --- |
| `Sent 4.2 MB — transcribing` | Accepted. The transcript is being made. | Nothing. Check Course+ in a few minutes. |
| `Auth failed` | The `x-capture-key` header is missing or wrong. | Check step 11. Exact value, no trailing space. |
| `Empty recording` | No file reached the endpoint. | Usually means Request Body was not set to File, or Shortcut Input was empty. Check steps 13 and 14. |
| `Recording too large` | Over 150 MB. | Split the recording, or raise `MAX_BYTES` in the function. |
| `Upload failed: ...` | The transcription service rejected the audio. | Check the format is real audio. Retry once. |
| `POST only` | Method is wrong. | Check step 10. |
| `Server misconfigured` | A secret is missing on the function. | Check `CAPTURE_KEY`, `OWNER_ID`, and `ASSEMBLYAI_API_KEY` on the project. |

## Notes

- **The endpoint answers before the transcript exists.** A 200 means the audio was accepted and queued, not that the note is written. If the notification is good but no note appears in a few minutes, the failure happened during transcription; check the function logs.
- **Keep the recording in Just Press Record until you see the note.** Nothing is stored on our side. The audio is streamed through to the transcription service and forgotten.
- **A one-hour meeting costs about 27 cents** to transcribe, and is roughly 15 MB.
- Speaker labels are on. You get `Speaker A`, `Speaker B` and so on, which you relabel in Course+ afterwards.
- The CAPTURE_KEY value is the same secret the wrist dictation shortcut uses. Supabase secrets are write-only, so it exists only inside your shortcuts and wherever you filed it.
