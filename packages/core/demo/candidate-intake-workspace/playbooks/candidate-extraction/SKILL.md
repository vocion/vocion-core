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
- `dedupOn` is required — always at the top level of `action_input`, never
  nested inside `fields`. A proposal that leaves it empty, omits it, or nests
  it in `fields` is refused outright: there is no "every proposal stands
  alone" mode any more, because a proposal with no identity has no way to
  avoid stacking a duplicate row in the queue every time the page is walked
  again.
- Genuinely cannot identify the record? Key on whatever you do have — a
  source id, the listing URL, even the scrape timestamp — rather than
  skipping `dedupOn`. That still lets each finding merge with itself on a
  re-walk instead of duplicating.
- Named a field in `dedupOn` whose value the extractor left blank? The
  proposal still goes through — the review card just flags which identity
  field came back empty, so a reviewer knows two different candidates
  missing the same field would look identical on that key alone.
- A record a person already approved or rejected does not come back. Propose
  it again and the tool answers `Not proposed: a person already decided this
  exact record` and writes nothing. That is the normal answer on a page you
  have walked before, not a failure — so propose every record you find and
  read the answer, rather than trying to remember which ones were decided.
- A record that came back with changed details behaves three ways. Change a
  `dedupOn` field — the date, the venue — and it is a different record, so it
  opens its own card. Change anything else while the card is still waiting
  and the card is updated in place, so the reviewer sees the new details.
  Change anything else after a person decided and the change is dropped: say
  so in your summary if it looks like it matters, because nothing else will
  surface it.

## What you must not do

- Do not say a record was created, published, added, or saved. It was
  **proposed**, and it is waiting for a person. Say that.
- Do not propose the same record twice in one pass to "make sure" — the
  second call is not free, it rewrites the first.
- Do not invent a missing field. Leave it out. A blank on the review card is
  honest; a guess is a defect a reviewer has to catch.
- Do not lower `confidence` to slip a doubtful record through. If the listing
  is too vague to identify, skip it and say which one you skipped and why.
