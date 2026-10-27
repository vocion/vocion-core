# Intercom

The `intercom` source puts an Intercom workspace's conversations into the
knowledge index, with their replies and internal notes, and gives agents the
help desk live.

## What it syncs

One document per conversation: its subject (or first line), state, priority,
contact, tags, and every reply and note in order. Found with
`POST /conversations/search` on `updated_at` (incremental: since the last run
less five minutes; full: `lookbackDays` back, default 90), then read whole.

```yaml
kind: intercom
config:
  region: us # us | eu | au — a token only works in its own region
  lookbackDays: 90
```

## What agents can do

| | |
|---|---|
| `support_search_tickets` | Plain words matched against the conversations' messages, with an optional state (`open`, `closed`, `snoozed`). |
| `support_read_ticket` | One conversation whole, internal notes marked. |
| `support.draft_reply` (action) | Puts a draft on the conversation as an **admin note**, written as the admin who owns the token; the customer never sees it. **No Undo**: Intercom has no API to delete a note. |

## Auth

An **access token** from the Developer Hub (your app → Authentication), sent
as a Bearer token with `Intercom-Version: 2.11`. It needs to read
conversations and admins, and to write conversations only for draft replies.
Test connection names the admin and the workspace. No OAuth app is needed.
