# SEO research: what Google ranks, and why

Before anyone plans or writes an SEO page, someone has to read what Google already ranks for the
keyword: the top ten pages and the local pack, how long the pages are, what their text covers, what
it leaves out, what people also ask, and which keywords one page can answer. These four agent tools
do that reading and leave it as evidence a person can check.

| Tool | What it gives back |
|---|---|
| `serp_search({ query, location?, language?, country?, device?, num? })` | Google's results page: the organic top results (position, URL, domain, title, snippet, the date Google showed), the **local pack** (position, name, rating, reviews, category, website and its domain, address), the featured snippet, People Also Ask, related searches, the ads count, the provider that read it and `retrievedAt`. `directoryPositions` names the results that are directories. Plus a `serpResultId` for `serp_compare`. |
| `serp_compare({ query \| serp_result_id, top?: 5..10 })` | Reads the top pages and lays them side by side: title, meta description, H1 to H3 outline, word count, schema.org types, FAQ present, images, internal and external links, published and updated dates when the page states them, and a capped slice of each page's main text. Adds the local pack, the headings two or more ranking pages share (matched loosely) and a **term table**: normalised one- to three-word terms that appear in the body of three or more ranking pages, with which pages use them. Directories are flagged and left out of every aggregate. Files a **SERP brief** artifact in the `seo/serp` folder, every row linked and dated. Google's ranking only. |
| `serp_compare({ brief_id, synthesis })` | Writes the agent's synthesis into that brief: the search intent, the subtopics every ranking page covers in its body text and the gaps a new page could fill, each point citing the pages that show it. The facts above it are not rewritten. |
| `keyword_cluster({ keywords[], location?, language?, country? })` | Which keywords belong on one page: keywords whose Google top 10s share 3 or more URLs form a cluster around the first of them (the head). Pure code over `serp_search` results, with the shared URLs for every grouping; needs no volume. Google's ranking only. |
| `keyword_metrics({ keywords[], location?, language?, ideas? })` | Monthly search volume, CPC, competition and the last twelve months, plus **keyword ideas** (Google Ads' related keywords for the first 20, with their numbers), from Google Ads data via DataForSEO. Without DataForSEO it says it could not establish volume and that ideas are not available, and why. It never estimates. |

All four are paid per call, so they are **granted, not default**: an agent gets them with
`harness.grantTools: [serp]` (or any one by name). Every call is charged to the budget scope
`platform:seo.research`, to the agent, and to the workspace, at the vendor's list price
(`libs/pricing.ts`, rows `serp/*`).

Results pages are cached for the run (the mission run, else the conversation): clustering ten
keywords and then comparing one of them reads, and pays for, that page once.

In chat the steps read as what they did: "Read Google's top 10 for “wide hiking boots”",
"Read the top 10 pages for …", "Looked up search volume for 3 keywords".

## Providers

`VOCION_SERP_PROVIDER` picks the vendor that reads the results page. Unset, the tools use the first
one the server holds a key for, Serper first, then any a workspace stored its own key for.

| Provider | Key | Results page | Local pack | People Also Ask, related | Ads count | Device | Search volume, keyword ideas |
|---|---|---|---|---|---|---|---|
| `serper` (default) | `SERPER_API_KEY` | yes; `gl`, `hl`, `location`, `num` passed through | `places`: name, rating, reviews, category, website, address | yes | not reported | desktop only (says so when mobile was asked) | no |
| `dataforseo` | `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | Google Organic Live Advanced | `local_pack` items: name, rating, reviews, website (no category or address) | yes | yes | desktop or mobile | yes (Google Ads search volume and keywords for keywords) |
| `serpapi` | `SERPAPI_API_KEY` | yes | `local_results`: name, rating, reviews, category, website, address | yes | yes | desktop or mobile | no |

`keyword_metrics` asks DataForSEO whenever a DataForSEO login is held (the workspace's or the
server's), whichever vendor reads the results page. So a workspace on Serper can add DataForSEO for
volume and keyword ideas alone. On Serper alone the answer says plainly that keyword ideas are not
available, because Serper has no keyword data.

**A workspace's own key wins.** None of these vendors offers a sign-in an app could use, so a key
is the way to connect them: a workspace admin opens the tool on `/dashboard/tools` and saves the
key (DataForSEO takes its API login and API password from app.dataforseo.com → API Access, not the
account password). Searches then bill the workspace's own account; with no key stored, the
server's env var is used. A stored key that cannot be read stops the call rather than spending the
server's account (`libs/tools/orgKey.ts`).

**With no SERP provider at all**, `serp_search` falls back to the configured `web_search` provider
(Tavily or Brave) and says so in the result: "Brave results, not Google's ranking". There are no
People Also Ask, related searches or local pack on that path, and its order is that engine's.
`serp_compare`, `keyword_cluster` and `seo_save_research` do **not** fall back: a SERP brief built on
another engine's order looks authoritative and is not, so they refuse and say a workspace admin can
add a Serper key.

## Directories

Directories, marketplaces, social and reference sites (Yelp, Angi, Thumbtack, HomeAdvisor, BBB,
Nextdoor, Houzz, Facebook, Reddit, Wikipedia, YouTube, …) can hold half of a local or home-services
results page. They are one shared list, `libs/tools/serp/directories.ts`, read by the SERP tools and
by onboarding's competitor detection. `serp_compare` keeps them in the table, marked `directory`,
and leaves them out of the median length, the FAQ count, the shared headings and the term table; the
synthesis is told not to count them in what the ranking pages cover.

## What the pages say, not only their headings

Each page's main text is read (chrome removed) and a capped slice of it is handed to the model,
shared out so ten pages fit one turn. Shared headings are matched loosely — case, numbering and
punctuation gone, words stemmed, two headings one when at least half their words are shared — so
"How We Tested!" and "Our testing process" count as one. The term table lists terms in the body of
three or more ranking pages with the pages that use them (the query's own words left out). The
synthesis judges coverage and gaps from that text, citing positions (`libs/tools/serp/textMatch.ts`).

## Local search

A location page (`pageType: location` on an SEO page, with its `location`) is researched on its
own city's results: `seo_save_research` refuses a SERP brief whose query does not name the page's
location, or one already attached to another location page. Its page brief must carry a section
headed "Local substance" (the client's jobs, reviews and service-area facts there), and the editor's
review fails a location draft that is 70% or more the same as a sibling location draft in the batch,
city names masked, by five-word shingles and Jaccard (`services/seo/duplicates.ts`). See
[the SEO app](../apps/seo.md).

## Reading the pages

`serp_compare` reads up to ten pages, four at a time, through the browse provider
(`VOCION_BROWSE_PROVIDER`): the built-in fetcher, or Firecrawl for pages that only render in a
browser. Every address is checked public on every redirect hop (`libs/net/publicFetch.ts`), and a
page body is capped at 8 MB. A page that cannot be read stays in the brief with the reason ("HTTP
403", "over the cap"); a page whose text only arrives by script is marked as such rather than shown
as zero words. Switch to Firecrawl when many of the top pages are like that.

Dates are the ones the page states (schema.org `datePublished` / `dateModified`, article meta, a
`<time>`), or the date Google showed beside the result. A page that states none says "not stated".

## Environment

```bash
VOCION_SERP_PROVIDER=serper      # serper | dataforseo | serpapi; unset = first with a key
SERPER_API_KEY=
SERPAPI_API_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
```

## Code

`packages/core/src/libs/tools/serp/` (providers, the page reader `pageFacts.ts`, the brief
`brief.ts`, heading and term matching `textMatch.ts`, clustering `cluster.ts`, the directory list
`directories.ts`), the tools in `services/agents/tools/serpResearch.ts`, the grant group in
`services/agents/tools/grantGroups.ts`.

## Related

[Agent tools](./agent-tools.md) · [Budgets](./budgets.md) · [Artifacts](../artifacts.md)
