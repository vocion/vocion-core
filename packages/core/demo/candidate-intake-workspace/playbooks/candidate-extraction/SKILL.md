---
slug: candidate-extraction
name: Candidate Extraction
description: >-
  How to turn a listings page into review-queue candidates: one proposal per
  record, what goes in the identity fields, and what never to claim.
version: 1
---

# Candidate Extraction

You read a page that lists many records and you put each one in front of a
human. You never create anything outside Vocion. Approval is somebody else's
job, and it happens later, somewhere else.

## One record, one proposal

Call `propose_action` once per record on the page. Never batch several
records into one call and never summarise a page into a single proposal — a
reviewer decides one record at a time, and a batched proposal cannot be
approved in part.

The call looks like this:

```json
{
  "action_id": "objects.propose_candidate",
  "action_input": {
    "objectType": "event_candidate",
    "title": "Open Mic Night",
    "fields": {
      "title": "Open Mic Night",
      "start": "2026-09-19T19:30",
      "venue": "The Flynn",
      "price": "Free"
    },
    "dedupOn": ["title", "start", "venue"],
    "sourceUrl": "https://example.org/events/open-mic-night",
    "sourceListingUrl": "https://example.org/events",
    "summary": "Weekly open mic, sign-up from 7pm."
  },
  "confidence": 0.9,
  "rationale": "Listed on the venue's own events page with a date and a time."
}
```

## Fields

- `objectType` is the slug of an object type this workspace defines. Read the
  type's schema first and fill the properties it names. A field the schema
  does not describe still gets stored, but it will not be labelled on the
  review card, so a reviewer sees a raw key.
- `fields` holds the record itself and nothing else. Where you found it goes
  in `sourceUrl` and `sourceListingUrl`, not in `fields`.
- `title` at the top level is what a reviewer sees in the queue list. Make it
  the thing a person would recognise, not a slug or an id.

## dedupOn — the part that matters

`dedupOn` names the fields that make this record *this record and not another
one*. Two extractions that agree on every one of those fields are treated as
the same proposal: the second refreshes the first instead of adding a second
queue item.

- Pick the smallest set that is genuinely unique. For an event that is
  usually name, start time, and venue.
- Same name, different night → two records. Same name, same night, same
  venue → one record, seen twice.
- Order does not matter and neither does punctuation or capitalisation —
  "The Flynn" and "the flynn" are the same value.
- Leave `dedupOn` out only when you truly cannot identify the record. Every
  such proposal then stands alone in the queue and nothing will ever merge
  with it.

## What you must not do

- Do not say a record was created, published, added, or saved. It was
  **proposed**, and it is waiting for a person. Say that.
- Do not propose the same record twice in one pass to "make sure" — the
  second call is not free, it rewrites the first.
- Do not invent a missing field. Leave it out. A blank on the review card is
  honest; a guess is a defect a reviewer has to catch.
- Do not lower `confidence` to slip a doubtful record through. If the listing
  is too vague to identify, skip it and say which one you skipped and why.
