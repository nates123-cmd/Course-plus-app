# Watch Capture Shortcut

Three actions. Built by hand in the Shortcuts app on iPhone. Takes about two minutes.

## Build it

1. Open Shortcuts on iPhone, tap `+` to make a new shortcut.
2. Name it something short. The name is what you say to Siri and what shows on the watch face.
3. Add action: **Dictate Text**.
4. In Dictate Text, set **Language** to English.
5. In Dictate Text, set **Stop Listening** to **On Tap**. Not After Pause.
6. Add action: **Get Contents of URL**.
7. Set the URL to `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/capture`.
8. Tap **Show More** on the Get Contents of URL action to reveal Method, Headers, and Request Body.
9. Set **Method** to `POST`.
10. Under **Headers**, add key `x-capture-key` with the CAPTURE_KEY value as its text.
11. Under **Headers**, add key `content-type` with value `text/plain`.
12. Set **Request Body** to **File**.
13. In the Request Body field, insert the **Dictated Text** variable.
14. Add action: **Show Notification**.
15. Set the Show Notification body to the **Contents of URL** variable.
16. Open the shortcut's settings (the info or details button).
17. Enable **Show on Apple Watch**.
18. Optional: add the shortcut to a watch face complication, or launch it from the Shortcuts app on the watch.

## Things that go wrong

- Step 5: **On Tap**, not After Pause. After Pause cuts you off mid-thought the moment you stop to think, and the half-sentence is what gets saved.
- Step 12: **File**, not Text. This is the step people get wrong. Text mode makes Shortcuts try to build a form body and the endpoint receives nothing usable.
- Step 15: do not drop action 3. A silent failure on the wrist means the thought is gone and you do not find out for a week. The notification is the only proof the capture landed.

## Where the key lives

The `CAPTURE_KEY` value is a Supabase Edge Function secret on project `xsmnfcmtbpeaccnyinkr`. Supabase secrets are write-only: `supabase secrets list` shows a digest, never the value. So the plaintext exists in exactly two places, and neither is this repo:

1. Inside the Shortcut, in the `x-capture-key` header field.
2. Wherever you filed it when it was generated (Vaultwarden is the right home).

If it is lost, generate a new one and rotate both sides at once:

```
supabase secrets set CAPTURE_KEY=$(openssl rand -hex 24) --project-ref xsmnfcmtbpeaccnyinkr
```

Then paste the new value into step 10. Nothing else needs redeploying.

## What the notification means

| Notification | Meaning | What to do |
| --- | --- | --- |
| `Captured — 23 words` | Saved. The row is in the Course Plus inbox, untriaged. | Nothing. Triage it later. |
| `Auth failed` | The `x-capture-key` header is missing or wrong. | Check step 10. The header name is case-insensitive but the value is exact, with no trailing space. |
| `Empty capture` | Dictation produced nothing, or only whitespace. | Say it again. Usually means Stop Listening fired before you spoke. |
| `Capture too long` | Body over 8 KB. | Should never happen from dictation. If it does, something upstream is wrong. |
| `POST only` | The request was not a POST. | Check step 9. |
| `Not saved: ...` | The endpoint got the text but the database insert failed. The thought was NOT saved. | Say it again into Notes or Ink so it is not lost, then check the function logs. |
| `Server misconfigured` | An environment secret is missing on the function. | Check that `CAPTURE_KEY`, `OWNER_ID`, and the service key are set on the project. |
| No notification at all | The shortcut did not reach step 3, or the watch lost the network. | Rerun it. Assume the capture did not land. |

## Privacy

Dictation runs on-device via Apple. No audio leaves the watch. There is no transcription step on our side and no audio is ever sent to, stored by, or processed by this endpoint. What crosses the wire is the finished text string and nothing else.
