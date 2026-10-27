---
slug: meeting-followup
name: Meeting follow-up
description: >-
  Write the follow-up after a call with a client or prospect, from what was
  said: reflect back their one to three priorities in their own words, confirm
  the next step already on the calendar, attach the deliverable the call was
  about as a PDF, and write the call's decisions, promises and changes back to
  its project. Read when a call's follow-up was approved, or a person asks
  for the follow-up after a call.
version: 1
---

# Meeting follow-up

The follow-up a great chief of staff has ready after a client call: short,
specific, in the voice of the person whose meeting it was, and complete —
what they heard, what happens next, the document they were looking at.

## 1. Read the call, and only the call

- `read_meeting_record` with the follow-up's `documentId`. It answers only
  for a call a person released; a refusal is the answer — say so in your
  report and stop. Never read the call another way.
- The project, when there is one: `read_project`. Its rules come first (how
  the client names things, what never leaves the project).
- The deliverable named on the follow-up (a deck or document on the project):
  `read_artifact` / `read_deck` / `read_document`, so you know what they saw.
- The next meeting with these people, when the follow-up names one; else
  `calendar_events` for the next two weeks with any of the people outside.
- The thread, when there is one: search the mail with the people outside, so
  the email answers in it (`threadId`) rather than starting a new one.

## 2. Write the email

Voice: the meeting owner's. Read every playbook the workspace attaches for
how they write; it wins over anything here.

- **Open on them**, by first name, anchored to the call: "good talking
  today", the one thing that mattered most.
- **Reflect back one to three priorities in their words.** Quote or
  near-quote what they said they need. Their words, not ours; not a summary
  of the meeting.
- **The next step.** When one is already on the calendar, confirm it with its
  day and time ("See you Tuesday at 10 for the demo"). When none is, propose
  one concrete step. One, not a menu.
- **What was promised.** Anything our side said it would send or do, said as
  done or with its date.
- **Connect personally** when the call gave you something real to connect on
  (a shared reference, a congratulation); never invent one.
- **No price, rate, discount or date that was not said on the call.** If the
  call changed scope or price, say only what was said.
- Short. Plain. No "just following up", no recap of the agenda.

## 3. Attach the deliverable

When the call presented a deck or document from the project, or was about it
(a proposal review, a scope walk-through), put its artifact id in the
email's `attachments` — it goes as its PDF. Never write an artifact number in
the body. Nothing to attach is fine; never attach something the call was not
about.

## 4. Propose — never send

`propose_action` with `gmail.send`:

- `to`: the people outside who were on the call ("Name <address>").
- `cc`: anyone else on our side who should stay copied, when the thread has them.
- `subject`: the thread's "Re: …" when answering one, else short and specific.
- `draft: true`, `threadId` when there is a thread, `attachments` per 3.
- confidence, a one-line rationale citing what in the call it rests on, and
  `suggested_decision: approve`.

One email per call. If one is already waiting for these people it is updated
in place — that is the dedupe, not a reason to propose twice.

## 5. Write the call back to the project

When the call has a project (or opened an engagement: a next step was booked or
a proposal was discussed — then `create_project` for the client first):

- **Decision log** — `file_to_project` with the captured `documentId`, kind
  transcript, a weight, the call's date, and a `decisionLog`: who was there,
  the headlines, numbered decisions and corrections, the open items created.
- **Open items** — `add_open_item` for each thing promised, with its owner
  and `sourceRef` set to the document id and the promise, so a re-run
  updates rather than duplicates.
- **A deliverable the call changed** — when the call changed the scope,
  price, timeline or framing of the project's deck or document, an open item on
  the project titled for that deliverable, saying exactly what changed and where
  in the call it was said ("Proposal v3: scope drops the Android app — said at
  the 14-minute mark"). Do not edit the deliverable here.
- **Status** — `update_project` with the status paragraph dated today: what
  happened, what is next, who owes what.

## Report

Three lines: the draft's action id and who it goes to; what was attached (or
"nothing to attach"); what was written to the project (or why nothing was).
