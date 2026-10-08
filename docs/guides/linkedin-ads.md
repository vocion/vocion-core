# LinkedIn Ads

A workspace connects one LinkedIn ad account and its agents read it live:
which campaigns are running, what they cost and what they delivered. Nothing
is copied into Vocion and nothing on LinkedIn is changed — the connection is
read-only by design.

## What it reads

LinkedIn's levels map onto the ads family's two words:

| Family word | LinkedIn calls it | What it is |
|---|---|---|
| campaign | campaign group | spend toward one objective |
| ad set | campaign | budget, schedule, audience |

Tools (present for an agent whose sources include the LinkedIn Ads source):

- **`ads_campaigns`** — campaign groups or campaigns, with status, objective
  and daily or total budget.
- **`ads_performance`** — impressions, clicks, spend (`costInLocalCurrency`),
  conversions (`externalWebsiteConversions`), CTR, CPC and CPM by account,
  campaign group or campaign, over a date range, per day if asked (default:
  the last 30 days ending yesterday).

**Actions: none.** The login asks for `r_ads` and `r_ads_reporting` only, so
`ads.set_status` (pause / resume) refuses on this connection before anything
is queued and says why. Pause in Campaign Manager.

## Connecting it

At `/dashboard/connectors` → LinkedIn Ads, or ask an agent ("connect LinkedIn
Ads") and use the card it offers. Setting: **Ad account ID** — the number in
Campaign Manager's URL after `/accounts/`.

Two ways to authenticate:

1. **Connect with LinkedIn** (OAuth, scopes `r_ads r_ads_reporting`). Needs a
   LinkedIn app with the **Advertising API** product — see below. When
   LinkedIn issues the app a refresh token the login renews itself; otherwise
   it lasts LinkedIn's 60 days and Test connection says when to log in again.
2. **Paste an access token** with the same two scopes, for a member with a
   role on the ad account (Viewer is enough) — from the developer portal's
   [token generator](https://www.linkedin.com/developers/tools/oauth/token-generator).
   Works today without registering anything; lasts 60 days.

**Test connection** reads the ad account (name, currency, status), its
campaign groups and yesterday's account totals. Read-only and free.

## Registering the LinkedIn app (for Connect with LinkedIn)

1. At [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps),
   create an app and request the **Advertising API** product (LinkedIn reviews it).
2. Under **Auth**, add the redirect URL
   `https://<your host>/api/connect/linkedin/callback`.
3. Either set the server's env —

   ```bash
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   ```

   — or have a workspace admin save the client ID and secret as a **LinkedIn
   login app** on the Developers page (used before the env; see
   [login-apps.md](./login-apps.md)). Until one exists the Connectors page
   says what is missing and offers the paste form.

## Notes

- Calls use LinkedIn's versioned Marketing API (`LinkedIn-Version: 202609`);
  move `LINKEDIN_API_VERSION` in `libs/linkedin/client.ts` forward before
  LinkedIn sunsets it (about a year after release).
- A throttled call (429) is retried once, then the agent is told to try later.
- Code: `libs/connect/providers/linkedin.ts`, `libs/linkedin/client.ts`,
  `services/ads/providers/linkedin.ts`, `libs/sources/linkedinAds.ts`.
