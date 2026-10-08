# Integration logos — sources and licences

The logos Vocion draws for the services it connects to are **trademarks of
their respective owners**. They are shown only to identify the service an
integration connects to, and imply no endorsement of Vocion by, or partnership
with, any of them.

Every brand a descriptor can name is listed here, one row per key in
`catalog.ts`. `catalog.test.ts` fails when a key has no row, so this file and
the catalog cannot drift.

## Marks

The SVG path data comes from [simple-icons](https://simpleicons.org)
(`simple-icons` on npm), released under **CC0-1.0**. simple-icons' own
[disclaimer](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)
applies: CC0 covers the drawing, not the trademark, and the owner's brand
guidelines govern how the mark may be used. Where simple-icons records those
guidelines they are linked below.

Colour: a mark is drawn in its brand colour where that colour reaches the
WCAG 2.2 AA non-text contrast of 3:1 against the tile (`--card`, in each
theme), and in the tile's ink where it does not (`contrast.ts`). Nothing else
about a mark is altered.

| Key | Brand | Source | Licence | Owner's guidelines |
| --- | --- | --- | --- | --- |
| `anthropic` | Anthropic | simple-icons, from https://www.anthropic.com | CC0-1.0 (drawing) | — |
| `atlassian` | Atlassian | simple-icons, from https://atlassian.design/resources/logo-library | CC0-1.0 (drawing) | https://atlassian.design/foundations/logos |
| `brave` | Brave | simple-icons, from https://brave.com/brave-branding-assets | CC0-1.0 (drawing) | https://brave.com/brave-branding-assets |
| `elevenlabs` | ElevenLabs | simple-icons, from https://elevenlabs.io/brand | CC0-1.0 (drawing) | https://elevenlabs.io/brand |
| `github` | GitHub | simple-icons, from https://github.com/logos | CC0-1.0 (drawing) | https://github.com/logos |
| `gmail` | Gmail | simple-icons, from Google's product logo set | CC0-1.0 (drawing) | https://about.google/brand-resource-center/brand-elements/ |
| `google` | Google | simple-icons, from https://partnermarketinghub.withgoogle.com | CC0-1.0 (drawing) | https://about.google/brand-resource-center/brand-elements/ |
| `googleads` | Google Ads | simple-icons, from https://ads.google.com/home/ | CC0-1.0 (drawing) | https://about.google/brand-resource-center/brand-elements/ |
| `googleanalytics` | Google Analytics | simple-icons, from https://marketingplatform.google.com/about/analytics/ | CC0-1.0 (drawing) | https://about.google/brand-resource-center/brand-elements/ |
| `googlecalendar` | Google Calendar | simple-icons, from Google's product logo set | CC0-1.0 (drawing) | https://about.google/brand-resource-center/brand-elements/ |
| `googlecloud` | Google Cloud | simple-icons, from https://cloud.google.com | CC0-1.0 (drawing) | https://about.google/brand-resource-center/brand-elements/ |
| `googledrive` | Google Drive | simple-icons, from https://developers.google.com/drive/web/branding | CC0-1.0 (drawing) | https://developers.google.com/drive/web/branding |
| `gusto` | Gusto | simple-icons, from https://gusto.com | CC0-1.0 (drawing) | — |
| `hubspot` | HubSpot | simple-icons, from https://www.hubspot.com/style-guide | CC0-1.0 (drawing) | https://www.hubspot.com/style-guide |
| `jira` | Jira | simple-icons, from https://atlassian.design/resources/logo-library | CC0-1.0 (drawing) | https://atlassian.design/foundations/logos/ |
| `notion` | Notion | simple-icons, from https://www.notion.so | CC0-1.0 (drawing) | — |
| `posthog` | PostHog | simple-icons, from https://posthog.com/handbook/company/brand-assets | CC0-1.0 (drawing) | https://posthog.com/handbook/company/brand-assets |
| `quickbooks` | QuickBooks | simple-icons, from https://design.intuit.com/quickbooks/brand | CC0-1.0 (drawing) | https://design.intuit.com/quickbooks/brand |
| `sentry` | Sentry | simple-icons, from https://sentry.io/branding/ | CC0-1.0 (drawing) | https://sentry.io/branding/ |
| `strapi` | Strapi | simple-icons, from https://handbook.strapi.io/strapi-brand-book-2022/strapi-logo | CC0-1.0 (drawing) | https://handbook.strapi.io/strapi-brand-book-2022 |
| `stripe` | Stripe | simple-icons, from https://stripe.com/newsroom/information | CC0-1.0 (drawing) | — |
| `xero` | Xero | simple-icons, from https://www.xero.com/uk/about/media/downloads | CC0-1.0 (drawing) | — |
| `zoom` | Zoom | simple-icons, from https://brand.zoom.us/media-library/ | CC0-1.0 (drawing) | https://brand.zoom.us/usage-legal/ |
| `box` | Box | simple-icons, from https://www.box.com/en-gb/about-us/press | CC0-1.0 (drawing) | https://www.box.com/en-gb/about-us/press |
| `confluence` | Confluence | simple-icons, from https://www.atlassian.com/company/news/press-kit | CC0-1.0 (drawing) | https://atlassian.design/foundations/logos/ |
| `dropbox` | Dropbox | simple-icons, from https://www.dropbox.com/branding | CC0-1.0 (drawing) | https://www.dropbox.com/branding |
| `gitlab` | GitLab | simple-icons, from https://about.gitlab.com/press/press-kit/ | CC0-1.0 (drawing) | https://about.gitlab.com/handbook/marketing/corporate-marketing/brand-activation/trademark-guidelines/ |
| `intercom` | Intercom | simple-icons, from https://www.intercom.com/press | CC0-1.0 (drawing) | https://www.intercom.com/press |
| `linear` | Linear | simple-icons, from https://linear.app | CC0-1.0 (drawing) | — |
| `pagerduty` | PagerDuty | simple-icons, from https://www.pagerduty.com/brand/ | CC0-1.0 (drawing) | https://www.pagerduty.com/brand/ |
| `zendesk` | Zendesk | simple-icons, from https://brandland.zendesk.com | CC0-1.0 (drawing) | https://brandland.zendesk.com |

## Brands drawn without a logo

These brands are not in simple-icons. A vendor's own SVG is vendored only when
its brand guidelines explicitly let a third party show the logo to indicate an
integration; none below met that bar when checked on 2026-10-08, so each tile
draws the integration's icon or initials instead. To add one later, vendor the
official file, cite the sentence that permits it here, and give its catalog
entry a mark.

| Key | Brand | Logo | Why |
| --- | --- | --- | --- |
| `amazons3` | Amazon S3 | No logo | AWS's trademark guidelines allow a plain-text reference only, no logos: https://aws.amazon.com/trademark-guidelines/. simple-icons dropped AWS marks in v15. |
| `amazonwebservices` | Amazon Web Services | No logo | As above. Covers Amazon Bedrock and the AWS credential. |
| `apolloio` | Apollo.io | No logo | Apollo.io's terms forbid using its logos without prior written permission: https://www.apollo.io/terms. Not to be confused with simple-icons' `apollographql`, a different company. |
| `bill` | BILL | No logo | BILL publishes no terms for third-party use of its logo. |
| `firecrawl` | Firecrawl | No logo | Firecrawl's brand page covers how to treat the marks, not third-party or integration use: https://www.firecrawl.dev/brand. |
| `freshdesk` | Freshdesk | No logo | Not in simple-icons, and Freshworks' brand terms have not been checked for third-party integration use; no mark is vendored until they are. |
| `granola` | Granola | No logo | Granola publishes a press kit but no terms for third-party use of its logo: https://grano.la/press. |
| `microsoftazure` | Microsoft Azure | No logo | Microsoft requires an express licence for its logos and product icons (Azure icons are for architecture diagrams and documentation only): https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks. simple-icons removed Microsoft marks in v13 at Microsoft's request. |
| `netsuite` | NetSuite | No logo | Oracle's trademark guidelines do not permit third parties to use its logos: https://www.oracle.com/legal/trademarks.html. |
| `openai` | OpenAI | No logo | OpenAI's brand guidelines ask products built on its API to be free of its logos and to ask permission first: https://openai.com/brand/. simple-icons dropped the mark in v16. |
| `ramp` | Ramp | No logo | Ramp publishes no terms for third-party use of its logo. |
| `rippling` | Rippling | No logo | Rippling publishes no terms for third-party use of its logo. |
| `slack` | Slack | No logo | Slack's brand terms require a written licence for most logo use and allow an integration to be stated in text only: https://slack.com/terms-of-service/slack-brand. simple-icons dropped Salesforce marks in v16. The "Sign in with Slack" button is Slack's own sign-in asset and is a separate matter. |
| `slate` | Slate | No logo | Slate publishes no brand guidelines. |
| `tavily` | Tavily | No logo | Tavily's brand page allows its marks in a compatibility statement but not alongside other companies' without formal permission, which a catalog of tools is: https://www.tavily.com/brand. Ask Tavily before adding it. |
| `workday` | Workday | No logo | Workday's trademark guidelines require permission to use its logos: https://www.workday.com/en-us/legal/trademarks.html. |
