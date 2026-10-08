# Zendesk

The `zendesk` source puts the tickets of one Zendesk Support account into the
knowledge index, each with its whole comment thread, and gives agents the
help desk live: search, read, and a drafted reply the support team sends.

## What it syncs

One document per ticket: subject, status, priority, requester, tags, and the
thread oldest first, each comment marked as the customer's, an agent's, or an
internal note. Synced from Zendesk's incremental ticket export: an incremental
run asks only for tickets updated since the last one (less five minutes); a
full run reaches back `lookbackDays` (default 90), so a ticket nobody touched
for longer leaves search at the nightly reconcile. Deleted tickets are
skipped and drop out the same way.

```yaml
kind: zendesk
config:
  lookbackDays: 90
  includeComments: true # false: subject and description only
```

## What agents can do

| | |
|---|---|
| `support_search_tickets` | Zendesk search syntax (`priority:high requester:dana@northwind.example`), narrowed to tickets, with an optional status. |
| `support_read_ticket` | One ticket whole, the thread with internal notes marked. |
| `support.draft_reply` (action) | Puts a draft on the ticket as a **private comment** — the customer never sees it; a person on the team edits and sends it. The card carries the draft as editable copy. **No Undo**: Zendesk has no API to delete a comment. |

The tools are present for any agent whose `connectorSources` include a
Zendesk source; the family is the help desk, so the same tools answer for
Intercom and Freshdesk ([intercom.md](intercom.md), [freshdesk.md](freshdesk.md)).

## Auth

An **API token** (Admin Center → Apps and integrations → Zendesk API, with
token access turned on), the email of the agent it acts as, and the
subdomain (`northwind` in `northwind.zendesk.com`). Sent as Basic
`{email}/token:{apiToken}`. Test connection says whose token it is — Zendesk
answers a token that does not authenticate as an anonymous visitor, and the
check calls that out — and counts the account's tickets. No OAuth app is
needed.
