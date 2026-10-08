# Google Meet as a knowledge source

A workspace connects Google Meet with the same Google login its Gmail, Drive
and Calendar sources use, and Vocion writes one document per recorded meeting:
who was on it, when, Meet's transcript and the notes Gemini took. An agent
reads them with `search_knowledge` ("what did Northwind say about pricing"),
and reads one whole with the meeting tools.

It is read-only, and there is no Meet-specific credential or second Google
client: it reuses the workspace's Google login.

## Where the meetings come from

Meet keeps nothing of its own that an API key opens. When a meeting is
transcribed, noted by Gemini or recorded, Meet saves the file to the
organizer's Drive and **attaches it to the calendar event**. So the connector
reads the calendar for events with Google Meet conference data, and Drive for
the Docs attached to them:

- **Transcript** — the Doc Meet names `<meeting> - Transcript`, exported as text.
- **Gemini notes** — the Doc named `<meeting> - Notes by Gemini`, stored as the summary.
- **Recording** — kept as a **link** only. Video is never downloaded.

Which Doc is which is read off those file names, which Meet generates; a Doc
attached by a person with any other name is read as transcript text. An event
with no Meet file on it yields nothing — the Google Calendar source already
indexes plain events.

Each document is `gmeet:<eventId>`, titled `<meeting> — <start>`, with
metadata `kind: meet-meeting`, the conference id, attendee emails, recording
links and `hasTranscript`.

## Syncing

| Setting | Default | What it does |
|---|---|---|
| Calendar | `primary` | Whose meetings are read. |
| Keep (days) | 60 | How far back a full sync reads meetings that already happened. |

An incremental sync asks Calendar only for events changed since the last run.
Meet attaching a transcript after the call changes the event, so the
transcript arrives on the next run. A weekly full sync retires meetings that
were deleted.

## Connecting it

Meet must have transcripts (or Gemini notes) turned on: that takes a Google
Workspace edition that supports them, and someone pressing it in the meeting.

**Log in with Google** on the Connectors page. The login asks only for
`calendar.readonly` and `drive.readonly`, and it adds to the scopes this
Google account already granted the workspace rather than replacing them. It
runs on the workspace's own Google login app (Developers page) when one is
saved, else on the server's (`GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`). Without either, paste an OAuth client ID,
secret and refresh token with those scopes instead.

**Test connection** reads one page of the calendar's meetings and checks Drive
answers. It is free and saves nothing.

## Tools and actions

- `meeting_find_recordings` — meetings in a window, with who was on them and
  whether a transcript is ready.
- `meeting_read_transcript` — one meeting whole: transcript and Gemini notes.

Both are the meeting-recorder family's tools, shared with Gong and Fireflies;
the source decides which recorder answers. There are no actions: nothing is
ever written to Calendar, Drive or Meet.
