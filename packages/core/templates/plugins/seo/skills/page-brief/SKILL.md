---
slug: page-brief
name: Writing a page brief
description: >-
  The plan a page is written from: the query and intent, the angle that beats
  what ranks, the outline, what to include from the SERP brief, the local
  substance a location page needs, the client rules that apply, internal
  links, and the meta title and description. Read before briefing any page.
version: 3
---

# Writing a page brief

A writer should be able to write the page from the brief without asking a
question. Write it as one markdown artifact (folder `seo/briefs`) and attach
it with `seo_save_brief`.

## Read first

The client's project (rules first, then notes and three-star guidelines), the
page's SERP brief (its synthesis: intent, common subtopics, gaps, each cited
to page positions; its local pack; the terms the ranking pages share), and
every feedback note already on this batch. For a refresh (`existingUrl`),
read the live page too: keep what earns its rankings and fix what the SERP
brief says it misses.

## The brief

1. **Query and intent**: the target keyword, the secondary keywords (its
   cluster), the page type, and the one question the page answers.
2. **The angle**: what this page does that the ranking pages do not (from the
   SERP brief's gaps, citing their positions), in one sentence. Directories
   are not the competition.
3. **Local substance** (every location page; `seo_save_brief` refuses a
   location page's brief without a section headed "Local substance"): what is
   true of this place for this client, each with its source in the project.
   Projects done there, reviews from customers there, the service area and
   response times, local codes, permits, water, climate or housing stock that
   change the work. If the project has nothing for this place, say so in this
   section and ask for it; never invent a job, a review or a fact about a
   town. A location page without it is a sibling page with the city swapped,
   and the editor fails those in code.
4. **Outline**: the H1 and every H2 and H3, each with one line on what it
   says. The answer to the query comes first.
5. **Must include**: the brief's common subtopics and the shared terms that
   belong on this page, People Also Ask questions to answer, facts with their
   sources. Search volume only if `keyword_metrics` established it;
   otherwise leave it out.
6. **Client rules that apply**: quoted from the project, so the writer and
   the editor check the same lines.
7. **Internal links**: pages from the client's content inventory, with URLs;
   a location page links its service pages and its nearest sibling areas.
8. **Meta**: title (under 60 characters) and description (under 155), and the
   URL slug (the page's `slug` or `existingUrl` when it has one).
9. **Length and format**: from the SERP brief's median (directories are
   already left out), plus schema or FAQ when the ranking pages use them.

## Never

A statistic with no source, a competitor claim not in the SERP brief, a local
fact the project does not support, or a promise the client's rules forbid.
