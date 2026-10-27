---
slug: serp-research
name: Researching what ranks
description: >-
  Before any page is planned: the top Google results for the keyword, the
  pages behind them, what they cover and miss, and search volume when the
  provider has it, as a dated SERP brief with every claim linked. Carries on
  without volume and never invents a number. Read before planning a batch or
  briefing a page.
version: 2
---

# Researching what ranks

A page is planned against what already ranks, never against a guess.

## The calls

1. `serp_search({ query, location?, language?, country?, device?, num? })`
   for the keyword. Use the client's market from the project for `location`
   and `country`, and `device: mobile` when the client's audience searches on
   phones. Read the organic results, the featured snippet, People Also Ask and
   related searches. Keep the `serpResultId` it returns.
2. `serp_compare({ serp_result_id, top })` with `top` 5 to 10 (or
   `{ query, top }` to search afresh). It reads each ranking page (title,
   meta description, H1 to H3 outline, word count, schema types, FAQ, images,
   links, stated dates) and files the **SERP brief** artifact in `seo/serp`,
   every row linked and dated. Keep its brief id.
3. `serp_compare({ brief_id, synthesis: { intent, common_subtopics, gaps } })`
   writes your synthesis into that brief. Each subtopic and gap is one point
   citing the positions (`sources`) of the pages that show it:
   - **intent**: what the people searching want, read from what ranks
     (guides, product pages, comparisons, local results), and in what form;
   - **common_subtopics**: what every top page covers, so a new page must too;
   - **gaps**: what the top pages miss or do thinly. This is the reason to
     write the page at all.
4. `keyword_metrics({ keywords, location?, language? })` for the target and
   the candidate secondary keywords.

## Volume

Volume comes only from `keyword_metrics`, and only when the workspace holds a
provider that has it (DataForSEO). The default provider (Serper) gives none:
the tool then says it could not establish volume. Carry on without it: plan
from intent, the gaps and People Also Ask, leave `volume` out of
`seo_plan_batch`, and say "volume not established" where a person would look
for it. Never estimate, round or infer a number from rankings.

## Honesty about the source

When `serp_search` says the results came from the web search engine rather
than Google's ranking (`isGoogleRanking: false`), put that in the first line
of anything you write from them, and never call that order Google's ranking.
Positions are quoted with the date they were read.

## Attach it

`seo_save_research` with the page and the SERP brief's id, once the synthesis
is written (it refuses a brief without one, or an artifact that is not a SERP
brief). One brief can serve every page of the same topic; research a page on
its own when its keyword's results differ.
