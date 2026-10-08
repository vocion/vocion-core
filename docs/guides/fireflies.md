# Fireflies as a knowledge source

A workspace connects Fireflies.ai with an API key and, on every sync, Vocion
writes one document per meeting into knowledge: who attended, Fireflies'
summary and action items, and the transcript by speaker. An agent reads them
with `search_knowledge` for "what did Contoso ask for", and with the meeting
tools for one meeting whole.

It is read-only, needs one credential per workspace, and needs no OAuth app.

## What gets stored, and what never does

One `knowledge_document` per meeting, `externalId` `fireflies:<id>`, titled
`<meeting title> — <start time>`, whose body is:

```
Meeting: Contoso renewal
When: 2026-10-03T16:00:00.000Z (25 min)
Participants: dana@kestrel.example, sam@contoso.example
Fireflies: https://app.fireflies.ai/view/…

Summary:
Contoso will renew with two more seats.

Action items:
Send the order form

Transcript:
Dana: How is the rollout going?
Sam: Well. We want two more seats.
```

Metadata carries `kind: fireflies-transcript`, `started`, `durationMinutes`,
`participants` (emails), `url` and `hasTranscript`.

**Never stored:** audio or video, and anything Fireflies has not shared with
the key's owner.

## How it syncs

| Setting | Default | What it does |
|---|---|---|
| Index meetings from the past (days) | 60 | How far back a **full** sync reads. Meetings older than this are retired from search. |

A full sync reads every meeting held in the window. An incremental sync starts
three days before the last one, since a transcript lands after the meeting.
Deleted transcripts drop out on the weekly full reconcile.

**Mind the plan's limits.** Fireflies' free and Pro plans allow **50 API
requests a day**; Business allows 60 a minute. Each request reads a page of 50
meetings with their sentences and summaries in it, so a sync of a normal
window spends one or two requests. Test connection spends one.

## Agent tools

- `meeting_find_recordings` — the meetings in a window, newest first, with ids.
- `meeting_read_transcript` — one meeting whole: participants, summary and
  transcript. Answered from the synced copy first, which spends no request.

Both belong to the meetings family and name no vendor.

## Actions

None. Fireflies' API offers no write that is both useful and reversible, so
agents only read.

## Connecting it

Copy the API key from **Fireflies → Settings → Developer settings** and paste
it on the Connectors page. It reads what its owner can see in Fireflies; it is
stored AES-256-GCM encrypted under the workspace's key and never shown again.
Test connection says whose key it is and saves nothing.
