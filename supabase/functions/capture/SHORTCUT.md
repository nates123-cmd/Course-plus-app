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
10. Under **Headers**, add key `x-capture-key`. Its value is the generated secret string itself, the long hex value, not the literal text `CAPTURE_KEY`. That name only identifies the secret on the Supabase side; Shortcuts never sends the name. Paste with no quotes and no trailing space.
11. Under **Headers**, add key `content-type` with value `text/plain`.
12. Set **Request Body** to **File**.
13. In the Request Body field, insert the **Dictated Text** variable.
14. Add action: **Show Notification**.
15. Set the Show Notification body to the **Contents of URL** variable.
16. Open the shortcut's settings (the info or details button).
17. Enable **Show on Apple Watch**.
18. Optional: add the shortcut to a watch face complication, or launch it from the Shortcuts app on the watch.

Building on a Mac instead works fine and iCloud syncs it, but step 17 has no equivalent there. The Mac details pane only offers Mac options (Spotlight, Quick Action, Services). Build and test on the Mac if you prefer, then open the synced shortcut on iPhone and flip **Show on Apple Watch** there.

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

The capture is **routed**, so the notification names where it landed rather than
just confirming receipt. That is the point: it is the only moment a misroute is
cheap to catch. Read it before you put your wrist down.

Expect a beat before it appears — the endpoint calls a model to classify the
text, so this takes a few seconds rather than being instant. A capture with
several items in it returns several outcomes joined by `;`.

| Notification | Meaning | What to do |
| --- | --- | --- |
| `Stock: butter -> shopping list` | On the Stock shopping list. | Nothing. |
| `Stock: butter marked out` | Matched a pantry item by exact name and flagged it out, which auto-promotes it to the shopping list. | Nothing. |
| `Course+ task on Riverside (due Aug 4, 2026)` | A real task, on that project. | Nothing. |
| `Course+ note` | Filed as a note. | Nothing. |
| `Ink: thought saved` | In Ink's Mind stream. | Nothing. |
| `Break: look up later` | Queued in Break. | Nothing. |
| `Inbox` | Could not route it confidently, so it fell back to the Course Plus inbox — the old behaviour. | Triage later. If this happens for something obvious, the classifier prompt needs work. |
| `Stock: eggs -> shopping list; Course+ task` | Several items in one capture, routed separately. | Nothing. |
| `Captured — 23 words` | **You are on the pre-router build.** | Redeploy the function. |
| `Auth failed` | The `x-capture-key` header is missing or wrong. | Check step 10. The header name is case-insensitive but the value is exact, with no trailing space. |
| `Empty capture` | Dictation produced nothing, or only whitespace. | Say it again. Usually means Stop Listening fired before you spoke. |
| `Capture too long` | Body over 8 KB. | Should never happen from dictation. If it does, something upstream is wrong. |
| `POST only` | The request was not a POST. | Check step 9. |
| `Not saved: router error` | The endpoint got the text but nothing was written. The thought was NOT saved. Should be unreachable — the router falls back to the inbox on every failure it knows about. | Say it again into Notes so it is not lost, then check the function logs. |
| `Server misconfigured` | An environment secret is missing on the function. | Check that `CAPTURE_KEY`, `OWNER_ID`, and the service key are set on the project. |
| No notification at all | The shortcut did not reach step 3, or the watch lost the network. | Rerun it. Assume the capture did not land. |

## Privacy

Dictation runs on-device via Apple. No audio leaves the watch. There is no transcription step on our side and no audio is ever sent to, stored by, or processed by this endpoint. What crosses the wire is the finished text string and nothing else.
