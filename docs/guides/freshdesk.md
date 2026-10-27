# Freshdesk

The `freshdesk` source puts one Freshdesk helpdesk's tickets into the
knowledge index, with their replies and private notes, and gives agents the
help desk live.

## What it syncs

One document per ticket: subject, status, priority, requester, tags, the
description and every conversation, private notes marked. Listed with
`updated_since` always — without it Freshdesk lists only the last 30 days —
from the last run less five minutes, or `lookbackDays` back on a full run.

```yaml
kind: freshdesk
config:
  lookbackDays: 90
  includeConversations: true
```

## What agents can do

| | |
|---|---|
| `support_search_tickets` | A Freshdesk filter query (`priority:4 AND status:2`), with a status named in words folded in. Empty: the most recently updated. |
| `support_read_ticket` | One ticket whole. |
| `support.draft_reply` (action) | Puts a draft on the ticket as a **private note**. No Undo from Vocion (the family's action has none, since Zendesk and Intercom cannot delete one); a person can delete the note in Freshdesk. |

## Auth

An agent's **API key** (Profile settings → View API key) and the helpdesk
domain (`northwind` in `northwind.freshdesk.com`), sent as Basic
`{apiKey}:X`. No OAuth app is needed.
