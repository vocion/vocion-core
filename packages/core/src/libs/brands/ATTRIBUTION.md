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

## Vendored official files

Each file is the vendor's own, downloaded on 2026-10-08 and committed byte for
byte under `packages/core/public/brand/integrations/`. It is never recoloured:
it sits on a neutral tile, and where the kit ships a variant for dark
backgrounds the tile switches to it in dark mode. Each row names where the file
came from, the page whose terms were read, and the sentence on that page the
use rests on.

| Key | Brand | Logo | Source | Terms, and the sentence relied on |
| --- | --- | --- | --- | --- |
| `firecrawl` | Firecrawl | Vendored `firecrawl/firecrawl-logo.svg` (the symbol, both themes) | https://www.firecrawl.dev/brand/brand-assets.zip | https://www.firecrawl.dev/press-brand — offers every logo to download and asks only "Avoid stretching, recoloring, or modifying the wordmark"; the symbol "should be used when square or minimal versions of the logo are required." It names no restriction on who may use them. |
| `granola` | Granola | Vendored `granola/logo-square.svg` (app icon, both themes) | The "Logos" folder of Granola's press kit | https://grano.la/press — Granola's own address for its press kit, a public folder of logos to download. It publishes no usage terms, and its terms of service have no logo clause, so nothing restricts this use. |
| `slate` | Slate | Vendored `slate/slate-icon.svg` (app icon, both themes) | https://slatevideo.com/favicon.svg | https://slatevideo.com/terms — "the Slate name and the clapper mark, is owned by MetaCTO LLC or its licensors"; Slate is a Metacto product, and its owner approves this use. |
| `tavily` | Tavily | Vendored `tavily/tavily-mark-black.svg`, dark `tavily/tavily-mark-offwhite.svg` | https://www.tavily.com/logos/ | https://www.tavily.com/brand — "Third parties may refer to Tavily assets to identify Tavily products or services (e.g. in compatibility statements)." The same page asks not to use them "alongside other entities without obtaining formal permission"; a catalog of tools may count, so this is flagged for confirmation with Tavily. |

## Brands drawn without a logo

These brands are not in simple-icons, and their owners' own terms do not let a
third party show the logo to say an integration exists, or permit it only in
another form (a badge, a sign-in button, an architecture diagram). Each tile
draws the integration's icon or initials instead. Re-checked against each
vendor's own page on 2026-10-08. To add one later, vendor the official file,
quote the sentence that permits it above, and give its catalog entry a
`vendored` mark.

| Key | Brand | Logo | Why |
| --- | --- | --- | --- |
| `amazons3` | Amazon S3 | No logo | https://aws.amazon.com/trademark-guidelines/ — fair use "should be in plain text only (no logos)". The "Powered by AWS" badge is licensed to a customer for its own software and cannot be passed on, and the Architecture Icons are "to create architecture diagrams". |
| `amazonwebservices` | Amazon Web Services | No logo | As above. Covers Amazon Bedrock and the AWS credential. |
| `apolloio` | Apollo.io | No logo | https://www.apollo.io/terms — "The Apollo names and logos … may not be copied, imitated, or used, in whole or in part, without Apollo's prior written permission." No brand kit is published. Not to be confused with simple-icons' `apollographql`, a different company. |
| `bill` | BILL | No logo | BILL publishes no terms for third-party use of its logo. |
| `microsoftazure` | Microsoft Azure | No logo | https://learn.microsoft.com/en-us/azure/architecture/icons/ — "Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation" and "Don't use Microsoft product icons to represent your product or service." Microsoft's logos otherwise "can never be used without an express license". |
| `netsuite` | NetSuite | No logo | Oracle's trademark guidelines do not permit third parties to use its logos: https://www.oracle.com/legal/trademarks.html. |
| `openai` | OpenAI | No logo | https://openai.com/brand/ — API developers "may truthfully identify the OpenAI technology you use", but "Don't: Use the logo without permission or outside OpenAI's terms"; permission is requested from partnercomms@openai.com. |
| `ramp` | Ramp | No logo | Ramp publishes no terms for third-party use of its logo. |
| `rippling` | Rippling | No logo | Rippling publishes no terms for third-party use of its logo. |
| `slack` | Slack | No logo | https://slack.com/terms-of-service/slack-brand — "Most uses require a specific written license", "Don't use the Slack logo (with or without your company logo)" and "Don't distribute or otherwise make available our logos", which committing the file to a public repository would do. An app may say in text that it is integrated with Slack. |
| `workday` | Workday | No logo | Workday's trademark guidelines require permission to use its logos: https://www.workday.com/en-us/legal/trademarks.html. |
