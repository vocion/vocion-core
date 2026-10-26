# Marketing — paid search run by an agent, approved by you

**Marketing** is a prebuilt app: a Marketing lead who reads the Google Ads account every morning, says what was spent and what it bought, and proposes every change as a card a person approves. Nothing that spends changes without a person.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/marketing/app.yaml` |
| **Plugin** | `marketing` (`packages/core/templates/plugins/marketing/`): the Marketing lead, the team, the daily update mission, its two automations, two skills |
| **Pages** | `/dashboard/marketing` (campaigns), `/dashboard/marketing/<campaign id>` (one campaign), `/dashboard/marketing/search-terms` — one route, `app/[locale]/(auth)/dashboard/marketing/[[...path]]` |
| **Reads** | `services/marketing/marketingReads.ts` → `services/ads/googleReports.ts`, live on every load; nothing stored |
| **Connection** | the `google-ads` source on the `google` platform (`libs/sources/googleAds.ts`, `services/ads/providers/google.ts`, `libs/googleAds/client.ts`) |
| **Writes** | `libs/actions/google-ads.ts`, plus the ads family's `ads.set_status` |

## Connecting Google Ads

One Google login, on the Connectors page, with the `adwords` scope (Google's only Ads scope; it reads and writes). After the login, **pick the account** from the list of accounts the login can run (`connect.googleAdsAccounts`, `libs/googleAds/client.ts` `listGoogleAdsAccounts`): the ones it reaches directly, and the client accounts under each manager account it reaches. Picking an account under a manager fills the **Manager account ID** too. A login that runs exactly one account picks it. With no login yet, the typed Customer ID stays as the fallback.

**Developer tokens are retired.** Since 2026-09-09 the Google Ads API decides access by the Google Cloud project that owns the OAuth client, not by a token from a manager account's API Center. The project needs **Explorer** access (automatic in most cases, about 2,880 operations a day on real accounts) or **Basic / Standard** (brand verification, then a review), applied for in Cloud Console → *Google Ads API Overview*. A project still on Test access is refused on a real account; the refusal says so and names that page. A `developerToken` a credential still carries is sent and ignored.

A pasted credential (OAuth client ID, secret and refresh token) works too, and authenticates every Google connector at once.

## Installing it on Vocion Cloud

Adding Marketing to a Vocion Cloud workspace sets the whole app up: the Marketing lead (who becomes the workspace lead when the workspace has only the generic one), the team, the daily update mission and its automations in the workspace's time zone, the guard and the alerts. See `docs/plugins.md`, *Installing an app on Vocion Cloud*. Then connect Google Ads with one Google login and pick the account.

## What the Marketing lead reads

| Tool | What it answers |
|---|---|
| `ads_campaigns`, `ads_performance` | The ads family's shared pair: campaigns and ad groups with status and budget; impressions, clicks, spend and conversions over a range |
| `ads_report` | Named Google Ads reports with typed dates, never model-written GAQL: `campaigns`, `campaign_daily`, `keywords`, `search_terms` (with whether each is already a keyword or a negative), `ads` (approval and policy topics), `conversions` (by action, and which actions exist), `budget_pacing` (month to date against budget) |

## What it changes, and only with you

Every Google Ads write is `approvalRequired`: whoever proposes it, it waits in Review. A person's own tap on the Marketing pages (Exclude, Add keyword) is that approval and runs at once (`review.actAsPerson`). Each execute asks Google to validate the whole batch first, applies it atomically, reads the result back, and records what Undo needs.

| Action | Undo |
|---|---|
| `google_ads.set_budget` | the old budget back (refused for a shared budget) |
| `google_ads.add_negatives` | removes exactly the negatives added |
| `google_ads.add_keywords` | removes exactly the keywords added |
| `google_ads.set_keyword_status` | the keyword's old status |
| `google_ads.edit_ad_text` | the old headlines and descriptions (Google reviews either) |
| `google_ads.create_search_campaign` | removes the campaign |
| `ads.set_status` (campaign or ad group) | the old status |

`google_ads.create_search_campaign` builds a whole Search campaign in one atomic batch: budget, campaign (Google Search only, Maximize clicks with an optional bid ceiling), locations and language, negatives, one ad group with its keywords and one responsive search ad, callouts and sitelinks. With `conversion_action_ids` it also gives the campaign its own goal, so an account whose default goals count another product's leads does not judge it by them.

## The daily update

`missions/daily-marketing-update.yaml`, run at 6:30am on weekdays by `automations/marketing-daily-update.yaml` (`when.timezone: workspace`: 6:30 on the workspace's own clock, across daylight saving) and published with `publish_briefing`, so it is on the Briefings page. It covers spend yesterday and this week against budget, what it bought, wasted search terms, ads Google limited, the proposals waiting, and one recommendation.

The mission's `deliver: {email: true}` mails the briefing to the workspace's accountable person when the check finishes (ADR 0008; mail needs `VOCION_MAIL_ENABLED=1`). On Vocion Cloud that is the admin who installed the app, unless an admin names someone else on the Members page; with nobody set, the update asks an admin to choose instead of going nowhere. A check that published nothing sends nothing; one that failed sends a short note with the reason and the run, never an older update.

Between mornings:

- **Saturday 9am** — `marketing-weekend-summary.yaml` checks the same mission with a five-line brief on the week.
- **Every four hours** — `marketing-guard.yaml` runs the `ads-guard` job: three GAQL reads, no model. It raises `ads.ad_limited` (an enabled ad disapproved or limited), `ads.pacing_off` (yesterday under a quarter or over 1.5× the daily budget, or today already over 1.5×) and `ads.first_conversion` (a campaign younger than 60 days records its first conversion). Each rings once (its dedupe key).
- **On those events** — `marketing-alert.yaml` has the lead say what happened in three lines and propose the fix as a card; the alert is mailed when that check finishes.

## The skills

- `search-terms-review`: waste becomes negatives on its campaign (phrase match on the shortest words that catch it); winners become exact keywords; every proposal carries its clicks, spend and conversions.
- `launch-search-campaign`: a landing page becomes one `google_ads.create_search_campaign` card — keywords, negatives, an ad whose every claim is on the page, tracking, and the conversion action the page is for.
