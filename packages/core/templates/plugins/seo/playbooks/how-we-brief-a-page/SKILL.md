---
slug: how-we-brief-a-page
name: How we brief a page
description: >-
  The agency's way of briefing an SEO page: the intent the results reward, the
  gap the page owns, the outline, the entities it must name, its internal
  links, the FAQ and the schema. Read before briefing any page, and by the
  writer and editor to know what the brief promised.
version: 1
---

# How we brief a page

A brief is good when a writer who has never met the client can write the page
without asking a question, and the editor can check the draft against the
same lines. Everything below goes in the brief; anything the project or the
SERP brief cannot support is written as "not established", never guessed.

## 1. Search intent: read the results, not the keyword

- Name the dominant intent from what ranks now: learn, compare, hire or buy,
  find a place nearby. The keyword alone is not evidence; the top ten are.
- Name the format Google is rewarding: a service page, a guide, a list, a
  comparison, a cost page, a local pack with map results. We match the format
  and beat the content; a guide does not rank where Google shows service pages.
- Mixed results (guides and service pages together) mean two intents. Pick
  one, say which positions we are competing with, and leave the other intent
  for another page.
- When directories, marketplaces or review sites hold the top positions for a
  "service + place" query, the page competes for the local pack and the
  organic results below them. Directories are not the competition the angle
  is written against.
- Note whether an AI Overview or other answer box shows for the query. If it
  does, the page states the direct answer in its first 40 to 60 words as a
  plain sentence that can be quoted, then gives what a summary cannot:
  specifics, process, local proof, a sourced price range.

## 2. The gap: one sentence the page owns

Write the angle as one sentence: what this page does that the ranking pages
do not, citing their positions from the SERP brief ("positions 1 to 4 give no
price range; position 2 is a national franchise page with nothing local").

A gap is information the reader cannot get from the current results:
first-hand experience from the client's jobs, data or photos the client owns,
a decision the reader has to make and how to make it, a local condition that
changes the work. "Longer" and "more keywords" are not gaps.

## 3. The outline

- H1: the query in natural words, not a keyword string.
- The answer comes first, under the H1, before context or history.
- Every H2 and H3 with one line on what it says. Order them in the order a
  searcher asks the questions: what it is, whether they need it, what it
  costs, how it is done, who does it here, what to do next.
- No heading that exists only to hold a keyword. A section the SERP brief
  does not justify needs a reason in the brief.

## 4. Entities, not keyword counts

List the things the page must name to be complete: services, parts and
materials, standards and codes, the places served, brands the client works
with, the problems a reader describes. Take them from the shared terms of the
ranking pages and the client's own material. The writer defines each at first
use in plain words. We never set a keyword density or an exact-match count.

## 5. Internal links

Follow the internal-linking playbook. The brief names:

- 3 to 6 links out, each with its target URL from the site inventory (status
  200, never a redirect) and the phrase it sits in;
- the service page this page supports, linked in the body where the reader
  decides, not only at the end;
- the hub it belongs under;
- at least two existing pages that should link to this one once it is live,
  so the page is never an orphan.

## 6. FAQ

- Only questions people actually ask: People Also Ask in the SERP brief, the
  client's sales calls and emails, its reviews. Three to six of them.
- Each answer stands alone in 40 to 80 words and does not repeat the body.
- The FAQ is for readers and for answer engines quoting the page. Google
  shows FAQ rich results only for well-known government and health sites,
  so we never add an FAQ for the snippet.

## 7. Schema

Name the types the page carries, and only for what is visible on the page:

- service page: `Service`, with `provider` the client's `LocalBusiness`
  (its most specific subtype: `Plumber`, `HVACBusiness`, `Electrician`…);
- location page: the same `LocalBusiness` subtype, with `areaServed` naming
  only places the client really serves;
- blog post: `BlogPosting` with `author` a real `Person` (the byline, with
  their author page as `url`), `datePublished` and `dateModified`;
- every page: `BreadcrumbList` matching the site's hierarchy;
- `FAQPage` only when the FAQ is on the page.

Never `HowTo` (Google dropped its rich result), and never review or rating
markup about the client on the client's own site: self-serving reviews of a
business are not eligible and read as spam.

## 8. Meta and length

- Title at most 60 characters, the main phrase near the front, the brand at
  the end when it fits. Description at most 155 characters, written as the
  reason to click. The slug: the planned one, or the live URL for a refresh.
- Length from the SERP brief's median, as a range. The page stops when the
  reader's questions are answered.

## Never in a brief

A statistic with no source, a competitor claim not in the SERP brief, a local
fact the project does not support, search volume that `keyword_metrics` did
not return, or a promise the client's rules forbid.
