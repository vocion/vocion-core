# Twilio Voice

The workspace's Twilio call log — with the words of any recording Twilio transcribed — as
documents an agent can search and cite, live tools for "who called today", and an action to
place a call that a person always approves.

| | |
|---|---|
| Auth | Account SID + auth token (`twilio` platform), the same pair texts and WhatsApp spend. Works today; no OAuth app. |
| Syncs | `twilio-voice` source — one document per call: from, to, direction, start, duration, status, and each recording's transcript. Incremental by start day; a weekly full pass tombstones deleted calls. Settings: `pastDays` (30), `includeRecordings` (on). |
| Tools | `phone_calls` (recent calls, by number and days), `phone_call` (one call, with recordings and transcripts) — present for an agent with a phone source. |
| Actions | `phone.place_call` — rings a number from one of the workspace's numbers and says a message. **Always waits for a person** (`approvalRequired`, and on the never-auto list); **no Undo** — a placed call has rung. |

Test connection reads the account, its numbers and its latest calls. It sends nothing.

Only recordings Twilio transcribed (`<Record transcribe="true">` or the console's transcription
setting) have words; others are listed by length. The server's `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN` are the fallback when a workspace stored none.
