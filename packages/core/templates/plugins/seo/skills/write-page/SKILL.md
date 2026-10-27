---
slug: write-page
name: Writing an SEO page
description: >-
  One page from its brief, in the client's voice and inside the client's
  rules, answering the query better than what ranks. Location pages carry
  what is true of their own place. Only pages the volume gate has released.
  Read before writing or redrafting any page.
version: 4
---

# Writing an SEO page

## Before the first word

1. `seo_next_pages` for the batch. Write only what it lists under writeNow.
   If the page you were asked for is not there, say why (the gate's reason)
   and stop.
2. Read the client's project (`read_project`): the client voice and the
   rules first, then the three-star guideline documents (printed in full; a
   cut one says how to read the rest), the notes and the brand. To look
   something up in the client's guides, `read_project` with `find`; never a
   workspace-wide search, which reads other clients' material too.
3. Read the page brief, the SERP brief, `/learnings/seo-feedback.md`, the
   client's adopted rules `seo_next_pages` returns (`clientRulesFromSignoffs`),
   and every feedback note on this batch's pages. A redraft starts from the
   notes on its own page (and the editor's review notes when it sent it back).

## The page

- The H1 and the first two sentences answer the query, in the words people
  search with.
- Follow the brief's outline. A section the brief did not ask for needs a
  reason from the SERP brief.
- Write in the client's voice as the project's voice block describes it:
  its point of view, reading level, spelling, tone and calls to action. Never
  a word from its "never use" list or a claim from "never claim": the review
  checks both in code. The client's rules win over everything else. The
  workspace's own brand is the agency's, never the client's.
- Every number and claim traces to the client's material or a dated source in
  the SERP brief. Otherwise cut it.
- Internal links from the brief, written into the sentences that need them.
- The body is the page and nothing else: no meta block, no front matter. The
  meta title, meta description and slug go to `seo_save_draft` as fields.

## The meta

From the brief, checked by `seo_save_draft` before it saves anything:

- `meta_title`: at most 60 characters (it says so at 55 and over).
- `meta_description`: at most 155 characters.
- `slug`: the page's planned slug stands when you leave it out; a new one
  is kebab-case, path segments allowed (`fairview/water-heater-repair`),
  unique within the client's project. A redraft keeps the page's meta unless
  you pass new values.

## Location pages

A location page is written for its own place, from the brief's **Local
substance**: the jobs done there, what customers there said, the service area
and response times, the local conditions that change the work. Put that
substance in the body, not in one paragraph at the end.

Never write a location page by copying a sibling and swapping the city. The
editor's review compares every location draft in the batch with its siblings,
city names masked, and sends back one that is 70% or more the same, whatever
else it says. If the brief's local substance is empty, write the shorter,
honest page and say in your reply what the project is missing for that
place; never invent a job, a review or a fact about a town.

## Save it

Render it as one markdown artifact in folder `seo/drafts` (a redraft updates
the same artifact as a new version) and attach it with `seo_save_draft`, with
the meta. If it is refused, report the reason as given. The editor reads it
next; you never mark a page approved and never file a sign-off. Once a person
has signed a draft off, any edit to it puts the page back to review.
