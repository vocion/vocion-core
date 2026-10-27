---
slug: serp-research
name: Researching what ranks
description: >-
  Before any page is planned: the top Google results for the keyword, the
  pages behind them, what they cover and miss, and the search volume when the
  provider has it, written as a dated SERP brief with every claim linked.
  Read before planning a batch or briefing a page.
version: 1
---

# Researching what ranks

A page is planned against what already ranks, never against a guess.

## The calls

1. `serp_search` for the keyword (the client's market as `location` when the
   project says where they sell). Read the organic results, the featured
   snippet, People Also Ask and related searches.
2. `serp_compare` on the top results (5 to 10). It reads each page: title,
   meta description, H1 to H3 outline, word count, schema types, FAQ, images,
   links, dates. It renders the SERP brief artifact.
3. `keyword_metrics` for the target and the candidate secondary keywords.

## What the brief must say

- **Intent**: what the people searching want, read from what ranks (guides,
  product pages, comparisons, local results).
- **What every top page covers**: the subtopics a page needs to compete.
- **What they miss**: the gap a new page can own. This is the reason to write
  the page at all.
- **The bar**: typical length, structure, schema and FAQ use.
- **People Also Ask** questions worth answering on the page.

Every claim links the page it came from and carries the date it was read.
When the results came from a web search provider rather than Google's ranking,
the tool says so: put that in the brief's first line. When volume could not
be established, write "volume not established".

## Attach it

`seo_save_research` with the page and the brief's artifact id. For a batch
being planned, one brief per topic is enough until pages are released; then
one per page.
