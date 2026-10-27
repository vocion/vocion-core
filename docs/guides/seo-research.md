# SEO research: what Google ranks, and why

Before anyone plans or writes an SEO page, someone has to read what Google already ranks for the
keyword: the top ten pages, how long they are, what they cover, what they leave out, and what
people also ask. These three agent tools do that reading and leave it as evidence a person can check.

| Tool | What it gives back |
|---|---|
| `serp_search({ query, location?, language?, country?, device?, num? })` | Google's results page: the organic top results (position, URL, domain, title, snippet, the date Google showed), the featured snippet, People Also Ask, related searches, the ads count, the provider that read it and `retrievedAt`. Plus a `serpResultId` for `serp_compare`. |
| `serp_compare({ query \| serp_result_id, top?: 5..10 })` | Reads the top pages and lays them side by side: title, meta description, H1 to H3 outline, word count, schema.org types, FAQ present, images, internal and external links, published and updated dates when the page states them. Files a **SERP brief** artifact in the `seo/serp` folder, every row linked and dated. |
| `serp_compare({ brief_id, synthesis })` | Writes the agent's synthesis into that brief: the search intent, the subtopics every top page covers and the gaps a new page could fill, each point citing the pages that show it. The facts above it are not rewritten. |
| `keyword_metrics({ keywords[], location?, language? })` | Monthly search volume, CPC, competition and the last twelve months, from Google Ads data via DataForSEO. Without DataForSEO it says it could not establish volume, and why. It never estimates. |

All three are paid per call, so they are **granted, not default**: an agent gets them with
`harness.grantTools: [serp]` (or any one by name). Every call is charged to the budget scope
`platform:seo.research`, to the agent, and to the workspace, at the vendor's list price
(`libs/pricing.ts`, rows `serp/*`).

In chat the steps read as what they did: "Read Google's top 10 for “wide hiking boots”",
"Read the top 10 pages for …", "Looked up search volume for 3 keywords".

## Providers

`VOCION_SERP_PROVIDER` picks the vendor that reads the results page. Unset, the tools use the first
one the server holds a key for, Serper first, then any a workspace stored its own key for.

| Provider | Key | Results page | People Also Ask, related | Ads count | Device | Search volume |
|---|---|---|---|---|---|---|
| `serper` (default) | `SERPER_API_KEY` | yes; `gl`, `hl`, `location`, `num` passed through | yes | not reported | desktop only (says so when mobile was asked) | no |
| `dataforseo` | `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | Google Organic Live Advanced | yes | yes | desktop or mobile | yes (Google Ads search volume) |
| `serpapi` | `SERPAPI_API_KEY` | yes | yes | yes | desktop or mobile | no |

`keyword_metrics` asks DataForSEO whenever a DataForSEO login is held (the workspace's or the
server's), whichever vendor reads the results page. So a workspace on Serper can add DataForSEO for
volume alone.

**A workspace's own key wins.** None of these vendors offers a sign-in an app could use, so a key
is the way to connect them: a workspace admin opens the tool on `/dashboard/tools` and saves the
key (DataForSEO takes its API login and API password from app.dataforseo.com → API Access, not the
account password). Searches then bill the workspace's own account; with no key stored, the
server's env var is used. A stored key that cannot be read stops the call rather than spending the
server's account (`libs/tools/orgKey.ts`).

**With no SERP provider at all**, `serp_search` and `serp_compare` fall back to the configured
`web_search` provider (Tavily or Brave) and say so in the result and in the brief: "Brave results,
not Google's ranking". There are no People Also Ask or related searches on that path, and its order
is that engine's.

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
`brief.ts`), the tools in `services/agents/tools/serpResearch.ts`, the grant group in
`services/agents/tools/grantGroups.ts`.

## Related

[Agent tools](./agent-tools.md) · [Budgets](./budgets.md) · [Artifacts](../artifacts.md)
