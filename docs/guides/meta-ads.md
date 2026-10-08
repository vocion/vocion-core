# Meta Ads

A workspace connects one Meta (Facebook and Instagram) ad account and its
agents read it live — campaigns, ad sets, what they spent and delivered — and
may propose pausing or resuming one. Nothing is copied into Vocion.

## What it reads

- **`ads_campaigns`** — campaigns or ad sets with status (and delivery status
  when it differs), objective or optimization goal, and daily or lifetime
  budget in the account's currency.
- **`ads_performance`** — impressions, clicks, spend, conversions (Meta's
  `conversions` field, summed), CTR, CPC and CPM by account, campaign or ad
  set, over a date range, per day if asked (default: the last 30 days ending
  yesterday), from the Insights API.

## The one write: `ads.set_status`

Pause or resume a campaign or ad set (`level`, `id`, `state`, `reason`). It
is a card a person decides (medium risk on the trust ladder, until a
workspace's `trust.yaml` promotes it). The state it left is recorded on the
run, and **Undo** sets it back. Budgets, bids, audiences and ads are never
touched. It needs the token to carry `ads_management`; without it Meta
refuses and the agent is told exactly that.

## Connecting it

No OAuth app: a Business Manager **system user token**.

1. Business settings → Users → [System users](https://business.facebook.com/settings/system-users)
   → Add; assign it the ad account.
2. Generate a token with `ads_read` — and `ads_management` only if agents may
   pause and resume. A system user token does not expire unless you set it to.
3. At `/dashboard/connectors` → Meta Ads (or the card an agent offers in chat),
   paste the token. Settings: **Ad account ID** (`act_…` or the digits) and,
   under Advanced, the **Graph API version** (default `v23.0`; move it forward
   as Meta retires versions).

**Test connection** reads the account (name, currency, status), one page of
campaigns, and the token's granted permissions — so it says whether pausing
will work without ever trying a write.

## Notes

- The token is sent as `Authorization: Bearer`, never in a URL; paging follows
  the `after` cursor rather than Meta's `next` links.
- Budgets come back from Meta in minor units and are divided by 100, except
  for Meta's offset-1 currencies (CLP, COP, CRC, HUF, ISK, IDR, JPY, KRW, PYG,
  TWD, VND).
- Throttling (HTTP 429 or codes 4, 17, 32, 613, 80000–80014) is retried once.
- Code: `libs/meta/client.ts`, `services/ads/providers/meta.ts`,
  `libs/sources/metaAds.ts`, `libs/actions/ads-set-status.ts`.
