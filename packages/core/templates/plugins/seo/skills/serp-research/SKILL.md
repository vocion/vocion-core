---
slug: serp-research
name: Researching what ranks
description: >-
  Before any page is planned: the top Google results for the keyword, the
  local pack, the pages behind them, what their body text covers and misses,
  which keywords belong on one page, and search volume when the provider has
  it, as a dated SERP brief with every claim linked. Carries on without volume
  and never invents a number. Read before planning a batch or briefing a page.
version: 4
---

# Researching what ranks

A page is planned against what already ranks, never against a guess.

## The calls

1. `serp_search({ query, location?, language?, country?, device?, num? })`
   for the keyword. Use the client's market from the project for `location`
   and `country`, and `device: mobile` when the client's audience searches on
   phones. Read the organic results, the **local pack** (the businesses on the
   map, with rating, reviews, category and website), the featured snippet,
   People Also Ask and related searches. Keep the `serpResultId` it returns.
2. `keyword_cluster({ keywords, location? })` over the candidate keywords,
   most important first, before anything is planned. Keywords whose Google
   top 10s share 3 or more URLs belong on one page: plan one page per
   cluster, the head as its keyword and the rest as its secondary keywords. It
   needs no volume, and the pages it reads are reused for the rest of the run.
3. `serp_compare({ serp_result_id, top })` with `top` 5 to 10 (or
   `{ query, top }` to search afresh). It reads each ranking page (title,
   meta description, H1 to H3 outline, word count, schema types, FAQ, images,
   links, stated dates and a slice of its main text) and files the **SERP
   brief** artifact in `seo/serp`, every row linked and dated, with the local
   pack, the headings the pages share (matched loosely) and the terms three or
   more of them use in their body. Keep its brief id.
4. `serp_compare({ brief_id, synthesis: { intent, common_subtopics, gaps } })`
   writes your synthesis into that brief. Each subtopic and gap is one point
   citing the positions (`sources`) of the pages that show it:
   - **intent**: what the people searching want, read from what ranks
     (guides, service pages, comparisons, the local pack), and in what form;
   - **common_subtopics**: what every ranking page covers **in its body
     text**, so a new page must too. Read each page's `text` and the shared
     terms, not only its headings: a subject a page covers without a heading
     still counts;
   - **gaps**: what the ranking pages' text misses or does thinly. This is
     the reason to write the page at all.
5. `keyword_metrics({ keywords, location?, language? })` for the target and
   the candidate secondary keywords, with keyword ideas when DataForSEO is
   configured.

## Directories are not competitors

Yelp, Angi, Thumbtack, Facebook and the like often hold half of a local
results page. `serp_compare` lists them, marked `directory`, and leaves them
out of the median length, the shared headings and terms. Leave them out of
`common_subtopics` and `gaps` too: their page is a list of businesses, not a
page the client could write. Say how many of the top 10 they hold when it
matters to the plan (a page competes with fewer business pages than ten).

## Location pages

A page for one city or service area is researched on that place's own
results: `serp_search` the query with the place in it ("water heater repair
fairview") and `location` set to that place, then `serp_compare` it.
`seo_save_research` refuses a brief whose query does not name the page's
location, and a brief already attached to another location page. Never reuse
one city's brief for another city.

## Volume and keyword ideas

Volume and keyword ideas come only from `keyword_metrics`, and only when the
workspace holds DataForSEO. Serper, the default, has no keyword data: the
tool then says it could not establish volume and that ideas are not
available. Carry on without them: plan from intent, the clusters, the gaps,
People Also Ask and related searches, leave `volume` out of
`seo_plan_batch`, and say "volume not established" where a person would look
for it. Never estimate, round or infer a number from rankings, and never
invent keywords with numbers.

## Only Google's ranking

`serp_compare`, `keyword_cluster` and `seo_save_research` work on Google's
ranking only. With no SERP provider configured they refuse and say a
workspace admin can add a Serper key; say that, and do not build a brief on
web search results or remembered rankings. `serp_search` alone may still
answer from the web search engine (`isGoogleRanking: false`): put that in the
first line of anything you write from it. Positions are quoted with the date
they were read.

## Attach it

`seo_save_research` with the page and the SERP brief's id, once the synthesis
is written (it refuses a brief without one, an artifact that is not a SERP
brief, or one built on web search results). One brief can serve the pages of
one keyword cluster; a location page always gets its own.

## Then plan, and stop

`seo_plan_batch` with the keyword map files one sign-off for a person. Stop
there: no brief, no draft, no handing pages to the writer until they approve
the plan (`seo_save_brief` and `seo_save_draft` refuse until then). Tell the
person the plan is waiting on their card; you are woken when they answer.
