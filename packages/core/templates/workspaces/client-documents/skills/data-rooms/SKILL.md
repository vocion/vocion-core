---
slug: data-rooms
name: Data rooms
description: >-
  Keep the source of record for a client engagement: file a call transcript,
  email thread or shared document into the right data room with a decision
  log, update the room's status and open items, and read a room before writing
  anything from it. Read when a transcript lands, an engagement starts, or a
  document is about to be drafted.
version: 1
---

# Data rooms

A data room is **the source of record for one engagement**: everything known
about it, indexed, with a status that is current and a list of open items that
keeps nothing from falling through. Documents are written *from* it, and
filed *back into* it.

## The room

A `data_room` record carries: a dated **status** paragraph; the **deliverables**
promised or sent; the **cast** (every person, role, email, side); the
**sources** filed to it, each with a rating (⭐⭐⭐ = read this before writing
anything); and its **open items**, which are asks on the room — they carry
urgency, get struck through when done, and are a work queue.

Tools: `list_data_rooms` · `read_data_room` (the whole room as one markdown
bundle — the LLM-context export) · `create_data_room` · `update_data_room`
(status, cast, deliverables, deal link, domains) · `file_to_data_room` · the
open items are asks (`request_human_review` for a decision; the room lists
them).

## Filing material

Every transcript, thread and attachment is filed as a dated source with its
**provenance** (channel, retrieval date) and a rating. Never leave source
material only in the conversation.

Which room? `file_to_data_room` matches by the attendee or sender email
domains first, then by the client's name, codename or aliases in the title.
Confidence decides what happens:

- **High** — filed into the room. The receipt says which room and why.
- **Medium** — filed as a proposal for a person to confirm, never silently.
- **No match** — a proposal to create a new room for what looks like a new
  opportunity, with the evidence. A room is never created on a guess.

## The decision log — the part that matters

Anyone can store a transcript. What makes a room useful is the numbered list
on top of it: **every scope correction, every commitment with its date, every
price said out loud, every constraint, and every correction to something the
room previously believed**. Two examples of the shape:

> 3. Volume is far smaller than the room recorded. The client, twice: "a
>    little less than 30 openings… usually is in the 20 ballpark." The room
>    carried "about a dozen". Pricing model changes.
>
> 7. Name the product "Managed AI". The seller's own words on the call: "we
>    work on a monthly fee for managed AI services."

Write it as: participants · headlines · **Decisions and corrections**
(numbered) · **Open items created by this call** (numbered, each with an
owner). Then the speaker-attributed, turn-merged transcript. Keep the small
talk; it is the record. Capture who said what for load-bearing lines — client
quotes become pull-quotes with attribution.

## Verify, don't relay

An agent's summary is a claim until it is checked against a typed read. When
two accounts differ, record both and mark the person's version authoritative.
Every filed item carries its retrieval date and channel.

## Status and open items

After any change: update the status paragraph with the date, add the source
to the index, reconcile the open items (strike what is done, add what the
call created, with owners). When a document ships, say so in the status and
flip the open item. A room whose status still reads "ready to send" after the
send is worse than no status.

## Before writing a document

`read_data_room` first. The ⭐⭐⭐ sources, then the latest transcripts. The
client's own project list, deliverable names and vocabulary become the
document's spine. Anything the room cannot back up renders as an amber
placeholder in the document and an open item on the room.
