---
slug: search-terms-review
name: Search terms review
description: Find the searches a Google Ads campaign paid for that nobody meant to buy, and propose them as negatives; find the ones that convert and propose them as keywords.
---

# Search terms review

1. Read `ads_report` `search_terms` for the window asked (default the last 14 days), and `campaigns` for the same window so each term is judged against its campaign.
2. A term is **waste** when it spent, did not convert, and does not match what the campaign's landing page offers: a job search, a different product with the same name, a how-to for a competitor's tool, a login. Spend alone is not waste; a relevant term with a few clicks is still learning.
3. A term is a **winner** when it converted, or brought several clicks on a clearly relevant search, and `already` is empty (it is not a keyword yet).
4. Propose, never add:
   - waste as `google_ads.add_negatives` on its campaign, PHRASE match on the shortest words that catch it ("jobs", not "loom jobs remote"), grouped into one proposal per campaign;
   - winners as `google_ads.add_keywords` on the ad group that matched them, EXACT match.
5. Each proposal's reason gives the numbers: clicks, spend, conversions and the window.
6. Report what you proposed and what you left alone, and why.
