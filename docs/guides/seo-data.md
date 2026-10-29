# SEO data: volume, difficulty, AI Overviews and what a site already ranks for

A keyword plan needs numbers: how many people search a term, how hard it is to rank for, what it
costs to advertise on, what the searcher wants, and whether Google answers it with an AI Overview
(and whose pages that overview cites). It also needs what the client's own site already gets from
Google. Three sources give these to the SEO agents. None of them is required: research carries on
without any of them, and a number that could not be read is named as missing, never estimated.

| Source | What it gives | How it connects | Cost |
|---|---|---|---|
| **Google Search Console** | The client's own queries and pages: clicks, impressions, CTR, average position, by date range | One Google sign-in, per workspace; the property is picked per client Project | Free |
| **DataForSEO** | Volume and its last 12 months, keyword difficulty (KD), CPC, competition, main intent, SERP features, AI Overview presence; on a results page, the AI Overview and the domains it cites | The server's login (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`), or a workspace's own under API credentials | Pay per call; charged at the cost DataForSEO reports |
| **Ahrefs** (optional) | Volume, KD, traffic potential, CPC, intent, SERP features; a domain's organic keywords; Brand Radar (AI answers that mention a brand) | A workspace's Ahrefs API key (Connectors → Ahrefs) | The workspace's own Ahrefs plan and its API units |

## What the agents call

| Tool | Gives back |
|---|---|
| `keyword_metrics({ keywords[], location?, language?, ideas? })` | Per keyword: `searchVolume`, `monthly` (up to 12 months, newest first), `kd`, `cpc`, `competition`, `intent`, `serpFeatures`, `aiOverview { present, citedDomains, source, checkedAt }`, `trafficPotential` (Ahrefs), and its `source` and `checkedAt`. Plus keyword ideas from DataForSEO. With no source it returns `ok: false`, the list of numbers it could not establish (`missing`) and why. |
| `serp_search(...)` | Google's results page. On DataForSEO it also carries `aiOverview { present, citedDomains }` and `serpFeatures`. On Serper and SerpApi those are absent (unknown), never "none". |
| `search_console_queries({ project_id?, site_url?, start_date?, end_date?, days?, by_page?, query_contains?, page_contains?, country?, device?, limit? })` | The client's queries (and with `by_page`, the page that shows for each), with clicks, impressions, CTR (0–1) and average position. |
| `search_console_pages({ ...same })` | The client's pages with the same numbers, for measuring published pages. |
| `ahrefs_organic_keywords({ domain, country?, limit? })` | The keywords a domain ranks for, by traffic: best position and URL, volume, KD, traffic, CPC. |
| `ahrefs_brand_radar({ brand, competitors?, assistant?, country?, limit? })` | Questions people ask AI assistants whose answers mention the brand, with the links cited. |

All of them come with the `serp` grant (`harness.grantTools: [serp]`), which the SEO strategist and
the SERP analyst hold.

### Which numbers win

`keyword_metrics` asks, in order:

1. **The workspace's Ahrefs**, when it is connected. Its numbers are labelled
   `source: "ahrefs"`. If Ahrefs refuses the call (a plan without API access, units used up), the
   answer says so in Ahrefs' words (`note`) and DataForSEO answers instead.
2. **DataForSEO**: the workspace's own login, else the server's (unless
   `VOCION_KEYWORD_DATA_PROVIDER=none`). DataForSEO Labs' keyword overview gives the numbers for
   up to 700 keywords a call; keywords Labs has not seen are filled from Google Ads search volume
   (up to 1,000 a call). For a city ("Denver, Colorado, United States") the volume and CPC are the
   city's, from Google Ads, and the difficulty and intent are the country's, from Labs.
3. **Nothing**: the answer names every missing number (search volume, keyword difficulty, CPC,
   search intent, AI Overview presence), says why, and recommends Search Console first (free), then
   Ahrefs or DataForSEO. The connect card for Search Console shows in the conversation.

Every keyword carries its `source` and `checkedAt`, the date the vendor measured it (DataForSEO
Labs dates its own snapshot, which can be days older than the call). With the SEO app on, each
keyword lands in the client project's **Keywords register** (`seo_keyword`) as part of the call:
volume and its trend, **Difficulty** (`kd`, 0–100), CPC, intent, SERP features and the AI
Overview, with `metricsSource` and `metricsCheckedAt`. The register's Competition column is Google
Ads competition (how many advertisers bid), not SEO difficulty, and is kept only where Google Ads
data is the source. A vendor's intent never overwrites one a person or a page set.
`keywordRecordOf()` in `libs/tools/serp/types.ts` gives the same numbers flat:
`{ keyword, volume, kd, intent, cpc, serp_features, ai_overview { present, cited_domains }, source, checked_at }`.

### The 7-day cache

Numbers bought for a keyword, location and language are reused for 7 days
(`keyword_metric_cache`, `libs/tools/serp/keywordCache.ts`): only the keywords the cache lacks are
bought. DataForSEO's market data is shared across workspaces; Ahrefs numbers stay with the workspace
whose plan bought them. A cached keyword keeps the date the vendor measured it; the result says how
many were reused (`cachedKeywords`).

### AI Overviews

Whether an AI Overview shows comes from the vendor's last look at the page (`serpFeatures`
includes `ai_overview`); which domains it cites needs the page read live. DataForSEO's results page
is read with `load_async_ai_overview`, so an overview that loads late is still seen; DataForSEO
charges one more read for it and refunds it when the page has none. So for citations, read the
page with `serp_search` on DataForSEO.

## Configure

### DataForSEO (platform)

```bash
DATAFORSEO_LOGIN=            # API login from app.dataforseo.com → API Access
DATAFORSEO_PASSWORD=         # API password (not the account password)
VOCION_KEYWORD_DATA_PROVIDER=dataforseo   # or none: buy no keyword numbers on the server's account
```

With `VOCION_KEYWORD_DATA_PROVIDER=dataforseo` and `VOCION_SERP_PROVIDER` unset, results pages are
read on DataForSEO too (so they carry the AI Overview), with Serper as the fallback. A deployment
that keeps `VOCION_SERP_PROVIDER=serper` reads results pages on Serper and still gets keyword
numbers from DataForSEO. A workspace can store its own DataForSEO login under API credentials and
spend its own balance.

### Google Search Console

Connectors → Google Search Console → Log in with Google. The login asks for
`webmasters.readonly` alone: it is its own connector on the Google app, so it reads no mail,
files or calendar, and a Gmail login reads no rankings. The deployment needs the Google OAuth app
(`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`) with the Search Console API enabled in its
Cloud project.

The property is the client's. The first time a project's work reads Search Console, the agent lists
the properties the login can read and asks which is the client's; the one picked is kept on the
project (`searchConsoleProperty`, with when and by whom), and every later read for that project uses
it. A default property on the connector serves work with no project. Until connectors can belong
to one project, the property on the project is what keeps one client's work off another's site.

### Ahrefs

Connectors → Ahrefs → paste the API key from Ahrefs → Account settings → API keys. Test connection
reads the plan and its API units without spending any. Ahrefs offers no sign-in for API access, so
the key is the way to connect it. API access comes with Ahrefs' Enterprise plan (and as API units on
some others); a call the plan does not cover is answered with Ahrefs' own words, and keyword numbers
then come from DataForSEO.

## Cost notes

- **Search Console** is free. Google's quota is generous (about 1,200 queries a minute per site).
- **DataForSEO** (list prices read 2026-10-29): Labs keyword overview about $0.01 a call plus
  $0.0001 a keyword; Google Ads search volume about $0.075 a call (up to 1,000 keywords); a results
  page $0.002 per 10 results, plus $0.002 when an AI Overview loads late. Keyword numbers are
  charged to `platform:seo.research` at the cost DataForSEO reports for the call
  (`serp/dataforseo-usd`), so the budget shows what was really spent. The 7-day cache means a
  keyword is paid for at most once a week.
- **Ahrefs** spends the workspace's API units: Ahrefs counts them per field per row (10 for most
  fields), with a minimum per request. Nothing is charged to the Vocion budget for it.

## Code

`libs/tools/serp/dataforseo.ts` (Labs, Google Ads, the AI Overview), `libs/tools/serp/ahrefs.ts`,
`libs/tools/serp/keywordCache.ts`, the precedence in `libs/tools/serp/registry.ts`
(`keywordMetrics`), `libs/searchConsole/client.ts`, `services/seo/searchConsole.ts` (the login and
the project's property), the tools in `services/agents/tools/serpResearch.ts` and
`services/agents/tools/seoData.ts`, the connectors in `libs/sources/searchConsole.ts` and
`libs/sources/ahrefs.ts`.

## Related

[SEO research](./seo-research.md) · [The SEO app](../apps/seo.md) · [Budgets](./budgets.md)
