# Gong as a knowledge source

A workspace connects its Gong account with an API key and, on every sync,
Vocion writes one document per recorded call into knowledge: who was on it,
Gong's own brief, key points and outcome, and the transcript turn by turn. An
agent reads those calls with `search_knowledge` for "what did Northwind say
about budget", and with the meeting tools for one call whole.

It is read-only, needs one credential per workspace, and needs no OAuth app.

## What gets stored, and what never does

One `knowledge_document` per call, `externalId` `gong:<callId>`, titled
`<call title> — <start time>`, whose body is:

```
Meeting: Northwind discovery
When: 2026-10-01T15:00:00Z (30 min)
Participants: Dana Reyes, Lee Park
Gong: https://app.gong.io/call?id=…

Summary:
Northwind wants a pilot in Q4.

Transcript:
Dana Reyes: Thanks for joining. Shall we start?
Lee Park: Yes, let us.
```

Metadata carries `kind: gong-call`, `started`, `durationMinutes`,
`participants` (emails where Gong knows them), `url` and `hasTranscript`.

**Never stored:** calls marked private in Gong (they are skipped before
anything about them is read), recordings or media, comments, scorecards and
trackers.

## How it syncs

| Setting | Default | What it does |
|---|---|---|
| Index calls from the past (days) | 60 | How far back a **full** sync reads. Calls older than this are retired from search. |

A full sync reads every call that started in the window. An incremental sync
starts three days before the last one, because Gong lists calls by when they
started and a transcript lands after the call ends. Deleted calls drop out on
the weekly full reconcile. Gong allows 3 requests a second and 10,000 a day;
the connector reads parties, briefs and transcripts in batches of 50 calls,
paces itself, and waits out a 429 for as long as Gong asks.

## Agent tools

- `meeting_find_recordings` — the calls in a window, newest first, with their
  ids, so an agent never says a call was not recorded without looking.
- `meeting_read_transcript` — one call whole: participants, Gong's brief and
  the transcript. Answered from the synced copy when there is one.

Both belong to the meetings family and name no vendor; the workspace's Gong
source answers them.

## Actions

None. Gong's API offers no write a reviewer could check and Undo could take
back, so agents only read.

## Connecting it

An admin makes an API key in Gong under **Company settings → Ecosystem →
API** and pastes three values on the Connectors page:

| Field | Where to find it | Shown |
|---|---|---|
| Base URL | the same page (`https://us-NNNN.api.gong.io`); blank means `https://api.gong.io` | in full |
| Access key | the same page | in full |
| Access key secret | shown once when the key is made | masked |

Test connection reads the Gong workspaces the key sees. It is free and saves
nothing. The key is stored AES-256-GCM encrypted under the workspace's key.
