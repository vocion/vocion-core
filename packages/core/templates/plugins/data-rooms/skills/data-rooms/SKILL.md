---
slug: data-rooms
name: Data rooms
description: >-
  Keep the collection around one engagement: file a call transcript, email
  thread or shared document into the right data room with a decision log,
  keep the room's rules, notes, timeline and highlights current, update its
  status and open items, and read a room before writing anything from it.
  Read when a transcript lands, an engagement starts, a person corrects you
  about an engagement, or a document is about to be drafted.
version: 2
---

# Data rooms

A data room is **the collection around one entity** — a deal, a project, an
engagement: everything known about it, indexed by weight, everything written
from it, and the room's own knowledge that keeps the collection growing on
its own. Documents are written *from* it, and filed *back into* it. A sales
room persists into delivery: the stage moves, the collection stays.

## The room

A `data_room` record carries: its **anchor** (the CRM deal or project it is
about); its **rules**; its **notes** (the wiki); a dated **status**
paragraph; the **deliverables** promised or sent; the **cast**; the
**sources** filed to it, each with a rating (⭐⭐⭐ = read this before writing
anything) and who filed it; the **timeline** of milestones; the
**highlights** kept for the case study; and its **open items**, which are
asks on the room — a work queue.

Tools: `list_data_rooms` · `read_data_room` (the whole room as one markdown
bundle — the LLM-context export) · `create_data_room` · `update_data_room`
(status, stage, anchor, cast, deliverables, domains, and the room's own
knowledge: notes, rules, milestones, highlights) · `file_to_data_room` ·
`unfile_from_data_room` (the undo of a filing) · `add_open_item`.

## Rules first

`read_data_room` puts the room's **rules** at the top because they govern
everything under them: how the client names things ("verticals, never
products"; "Managed AI"), what files here, what never leaves the room, who
signs off. **When a person corrects you about an engagement, or states how
something is called, add it as a rule** (`update_data_room` with
`add_rules`) so it holds next time without being said again. A rule is one
line. Remove a rule only when a person says it no longer holds.

## Notes — the room's wiki

The **notes** are standing knowledge in markdown: where things are, who owns
what, how the client's systems fit together, what was tried. Add a dated
section with `append_notes` when you learn something durable; rewrite with
`notes` only when a person asks for a clean-up. Notes are not the status
(one dated paragraph) and not the decision log (per call).

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

**The collector does the same after every sync**, on its own: a recording
or thread that clearly matches a room is filed as an automatic source with
its score and evidence; a plausible one becomes the same ask. So when you
read a room, some sources will say "filed automatically · 82%". If one is
wrong, `unfile_from_data_room` takes it out and the collector will not put
it back. A deal that reaches a Proposal stage in the CRM gets its own room,
anchored to the deal; a person closes it if it is not an engagement.

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

A decision that changes how the room should be worked (a name, a constraint,
a sign-off rule) also becomes a **rule**. A decision the whole engagement
will be measured by becomes a **milestone**.

## Highlights — the case study writes itself

While reading any material for the room, watch for what is worth keeping
and file it as **highlights** in the same `update_data_room` call you make
anyway — proactively, without being asked:

- **quote** — a client's own words worth featuring verbatim, with who and when;
- **metric** — a measured before/after, time or money saved, a count;
- **win** / **challenge** — what landed, what was hard and how it was met;
- **testimonial** — a sign of satisfaction or impact;
- **risk** — a constraint or exposure a person should keep in view.

Always with who/when/source, so the material is usable months later.

## Timeline

When a dated engagement event happens — a discovery call, a delivery, an
approval, a go-live, a blocker cleared — add it as a **milestone**
(`update_data_room` with `milestone`, status `done`); when one is promised,
add it as `planned`. The timeline is the factual record; the highlights are
the narrative. A milestone worth remembering usually belongs in both.

## Verify, don't relay

An agent's summary is a claim until it is checked against a typed read. When
two accounts differ, record both and mark the person's version authoritative.
Every filed item carries its retrieval date and channel.

## Status and open items

After any change: update the status paragraph with the date, add the source
to the index, reconcile the open items (strike what is done, add what the
call created, with owners). When a document ships, say so in the status,
flip the open item and the milestone. A room whose status still reads "ready
to send" after the send is worse than no status.

## Before writing a document

`read_data_room` first. The rules, then the ⭐⭐⭐ sources, then the latest
transcripts. The client's own project list, deliverable names and vocabulary
become the document's spine. Anything the room cannot back up renders as an
amber placeholder in the document and an open item on the room.
