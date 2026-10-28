---
slug: review-page
name: Reviewing an SEO draft
description: >-
  The check a draft passes before a person sees it, in the cheap order: the
  client's rules, adopted feedback, the brief, the SERP brief, local
  substance on a location page, then the craft. Fix or pass, at most three
  ordered fixes, and on pass the sign-off is filed for a person. Read before
  reviewing any draft.
version: 6
---

# Reviewing an SEO draft

You decide one thing: is this ready for a person to sign off. A person's time
is the expensive part; a draft that reaches them with a broken rule wastes it.

## Read the page first

`seo_read_page` with the page: its record, your earlier findings, every note
a person gave, and the full text of the SERP brief, the page brief and the
current draft, each with its artifact id and version. A long text is cut
where it says, with the call that reads the rest. Never file an ask for a
draft or a brief you could not open: read it here.

## The cheap order

1. **The client's voice and rules** (`read_project` with the page's
   `project_id`). One broken rule is a
   `fix`. Banned phrases and never-claim words are checked in code by
   `seo_save_review`: a draft with one goes back whatever your verdict, each
   one a finding ahead of yours. Point of view, reading level, spelling and
   tone are yours to read. Check against the client's own guidelines only
   (`read_project` with `find` or `source`).
2. **Adopted feedback** (`/learnings/seo-feedback.md`, and the client's own
   adopted rules `seo_next_pages` returns as `clientRulesFromSignoffs`) and
   the notes on this batch's pages. Repeating a mistake a person already
   corrected is a `fix`.
3. **The brief**: the query answered first, the outline followed, the
   internal links in. The meta title, description and slug are on the page
   (checked in code when the draft was saved); judge their words, not their
   length.
4. **The SERP brief**: covers what every ranking page covers in its body
   (the synthesis and the shared terms; directories do not count), and the
   gap it was meant to own.
5. **Local substance** (location pages): the brief's local facts are in the
   body, each traceable to the project. A location page that could be any
   town's page is a `fix`, quoted.
6. **Claims**: every number and comparison traced to a source. An untraced
   one is a `fix`, quoted.
7. **Craft**: voice, clarity, length. Only what a person would send back.

## Siblings, in code

`seo_save_review` compares a location page's draft with every other location
draft in its batch, city names masked, five-word runs (shingles), Jaccard
share. At 70% or more it records `fix` whatever verdict you gave, names the
sibling and the score, and sends it back to the writer. Read its receipt and
do not file a sign-off for that page.

## The verdict

`seo_save_review` with `fix` and `findings`, a list of `{ issue, location,
fix }` (the most important first, each quoting the rule, note or fact it is
about), or `pass` with what you checked in `notes`. A long review is kept
whole as an artifact linked from the page; never shorten a finding to fit.

On `fix` the writer's revision is queued in code with your findings, and the
draft comes back to you; after three rounds the sign-off is filed anyway
with the findings still open, and the person decides. On `pass` the tool
files the sign-off itself; never file one with `file_ask`. The person approves, revises with a note, or discards; their
answer moves the page and the gate, and the strategist picks the work up
after it. Never change the page's status yourself.
