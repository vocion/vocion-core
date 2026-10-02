---
slug: intake-from-chat
name: A thread in chat becomes a request
description: >-
  How a message or thread in the connected chat (Slack first; Teams and others
  later) becomes exactly one request record: who asked, where, their words kept
  verbatim, the thread's link kept as evidence, an acknowledged reaction left
  on the message, and a check against the open requests before anything is
  filed. Read whenever a chat message, a mention or a thread link is the thing
  being asked about, and before `file_request` is called for it.
playbooks: [naming-the-work]
version: 1
---

# A thread in chat becomes a request

The chat is where people say what they need, in the order they think of it.
The request record is where the factory keeps its promise. This skill is the
one move from the first to the second, and it ends in exactly one request, or
in a link to the one that already exists.

## Read the whole thread first

`chat_read_thread` with the permalink (or the channel id and the message's
`ts`). Read every message, oldest first, and the files on them. The ask is
rarely the first message alone: the second message narrows it, a reply says
"actually only on mobile", a screenshot shows what words did not. A thread
with a file worth seeing is read with `chat_read_file` before anything is
written down.

The tool answers with the channel's name and each author's name. When a scope
is missing it says which one; say that to the person in one line and file
what you could read — never guess at the message you could not.

## Dedupe against what is open

`lookup_objects` for open requests on the same product, then the same
`dedupeKey` (product plus the thing asked for, normalised) or the same surface.
A second person asking in a second channel is the same request as the first:
set `duplicateOf`, leave the acknowledged reaction on their message too, and
tell them where the original stands when you tell the first asker.

## File it, in their words

Call `file_request` (see `surface-an-ask-as-a-card`). What the chat decides:

- `channel: chat`.
- `askedBy`: `name` the author's display name as the tool returned it,
  `externalId` their chat user id, `email` only when the tool gave one.
- `body`: the asker's own words, quoted, with the follow-ups that changed the
  ask. Never a paraphrase in the body; the paraphrase is the `title`.
- `evidence.urls`: the thread permalink first, then any link the thread
  carried. `evidence.screenshotArtifactIds`: the files you read, saved as
  artifacts by `chat_read_file`.
- `askedAt`: the first message's time.

## Acknowledge where they asked

Propose `chat.add_reaction` on the message that became the request — `eyes`
is the house word for "seen, filed" — with the request id in `reason`. It is
done for you and Undo removes it; it is the cheapest honest signal that the
ask did not vanish. When the request ships, the same action with
`white_check_mark` closes the loop on the message itself; the words go in the
thread through `tell-the-requester`.

## What never happens here

No reply in the thread from this skill. A reply is `chat.reply_in_thread`, a
person sends it, and it is written once the request has an outcome to report
(`tell-the-requester`). A request filed is the acknowledgement; the reaction is
its receipt.
