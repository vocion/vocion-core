---
slug: write-release-notes
name: Writing release notes
description: >-
  How a release's notes and its announcement are written: from the tasks the
  release carried and the requests it closed — never from the diff — naming
  what a person can now do and which request asked for it, in the house
  voice, with no internal task ids or model names. Covers the AI-fills-human-
  wins rule (`notesSource`) and why announcing is a gated action. Read when a
  release has no notes, and before proposing any announcement.
playbooks: [house-voice, naming-the-work]
version: 1
---

# Writing release notes

A release is the unit of "what shipped". Its notes are what the people who
asked, and the people who did not, read to find out what they can now do. They
are **drafted by the agent and owned by a person** before they go anywhere;
the announcement written from them is the act that closes the loop with
whoever asked.

## What you read

The release's `taskIds` and `requestIds` — and through them the tasks'
`objective` and `acceptanceContract`, and the requests' `title`, `body` and
`askedBy`. The product's `promises`. The `house-voice` playbook.

**Never the diff.** The diff says what changed in the code; the notes say what
changed for a person. A note written from the diff names files and functions;
a note written from the request names the thing someone could not do last
week and can do now.

## What a note says

One item per shipped request, and one per task with no request only when it
changed something a person can see. Each item:

- names **what a person can now do**, in the words the asker used where they
  fit — the request's title is usually the sentence;
- **cites the request** (`#<requestId>`), so the asker can find themselves in
  it and anyone can trace the note to who asked;
- says, where it matters, what it does **not** do — a promise kept is worth a
  line, a limit that still holds is worth a line.

Fixes read as "X now works" or "X no longer happens", never as "fixed a bug
in X". A `patch` release is a short list; a `major` one opens with one
paragraph on the new capability before the list.

## What a note never contains

Internal task ids. Model names. File paths, function names, branch names,
commit shas. Effort ("this was a big one"). Anyone's name but the product's.
Any phrase the `house-voice` playbook bans. Any claim the product's `promises`
would contradict.

## `notesSource` — AI fills, human wins

Write the draft to `notes` and set `notesSource: agent`. A person edits or
approves it — in place, on the release record — and it becomes
`notesSource: human`. **Once it is `human`, you do not write `notes` again**,
not to improve it, not to add an item; if a later fact changes what it should
say, raise it as an ask naming the line. The announcement is written only from
notes a person owns.

## The announcement

One or two sentences from the owned notes — what people can now do, in the
product's voice — that a store listing, a status page or a chat channel can
carry whole. Written to `announcement`. Releasing it is the **`release.announce`**
action: proposed, decided by a person, and when it runs, `announcedAt` and
`announcedTo.channels` are written. Telling each asker that their request
shipped is one **`notify.requester`** per request, on the channel they used,
and each id lands in `announcedTo.requestIds` when the reply goes.

A release whose `healthAfter` is `down` is not announced; say so and wait.

## The receipt

Per release: notes drafted or left alone (and why), `notesSource`, the
announcement proposed or not, the requesters still to tell.

## The release's announcement and the asker's reply are two facts

`release.announcedAt` / `announcedTo.channels` say what the release said and
where. Whether each PERSON WHO ASKED heard back is written on their request —
`told: {at, channel, what, status}` — because one release carries several
requests with different people on different channels, and the release cannot
say which of them was answered (review, 2026-09-24). A failing `healthAfter`
blocks the success announcement only; an incident update to the same people is
exactly what goes out then.
