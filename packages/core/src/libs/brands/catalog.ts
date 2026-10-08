/**
 * Brand marks — the logos an integration is drawn with, keyed by the `brand`
 * a descriptor carries (a credential platform in `libs/platforms/registry.ts`,
 * a source connector in `libs/sources/*.ts`).
 *
 * This is the one place that knows which brands have a mark and where it came
 * from. Nothing in UI code names a brand: a surface reads its descriptor's
 * `brand` and hands it to `IntegrationLogo`, which draws the mark when there is
 * one and the tile's icon or monogram when there is not.
 *
 * Two kinds of entry:
 *
 *   - **A mark** (`{ icon }`), from simple-icons (CC0-1.0,
 *     https://simpleicons.org). Each is a named import, so the bundle carries
 *     only the marks listed here.
 *   - **No mark** (`{ title, fallback }`), for a brand simple-icons does not
 *     carry. A vendor's own file is vendored only when its guidelines let a
 *     third party show the logo to say "this connects to us"; none of these
 *     did when checked (2026-10-08), so each says why, here and in
 *     `ATTRIBUTION.md`, and the tile falls back. The brand stays a key anyway,
 *     so a descriptor names it today and the mark lands here, once, the day it
 *     is allowed.
 *
 * Logos are trademarks of their owners and are shown only to identify the
 * service an integration connects to. `ATTRIBUTION.md` lists every entry's
 * source and licence; `catalog.test.ts` fails when the two disagree.
 */

import type { MarkFills } from './contrast';
import {
  siAnthropic,
  siAtlassian,
  siBox,
  siBrave,
  siConfluence,
  siDropbox,
  siElevenlabs,
  siGithub,
  siGitlab,
  siGmail,
  siGoogle,
  siGoogleads,
  siGoogleanalytics,
  siGooglecalendar,
  siGooglecloud,
  siGoogledrive,
  siGusto,
  siHubspot,
  siIntercom,
  siJira,
  siLinear,
  siNotion,
  siPagerduty,
  siPosthog,
  siQuickbooks,
  siSentry,
  siStrapi,
  siStripe,
  siXero,
  siZendesk,
  siZoom,
} from 'simple-icons';
import { markFills } from './contrast';

/** The slice of a simple-icons entry a tile draws: a 24×24 single path and its colour. */
type SimpleIconMark = { title: string; hex: string; path: string; source: string; guidelines?: string };

/**
 * A catalog entry: a simple-icons mark, or a brand with no mark and the
 * reason it has none (mirrored in `ATTRIBUTION.md`).
 *
 * Plain data, no calls: an entry nobody resolves costs nothing at load, and a
 * bundle that never draws a logo can drop the table whole.
 */
type BrandEntry
  = | { icon: SimpleIconMark }
    | { title: string; fallback: string };

/**
 * Every brand a descriptor may name. Keys are simple-icons slugs where
 * simple-icons has the brand, so a mark that lands upstream later drops in
 * without renaming anything.
 */
const BRANDS = {
  anthropic: { icon: siAnthropic },
  atlassian: { icon: siAtlassian },
  brave: { icon: siBrave },
  elevenlabs: { icon: siElevenlabs },
  github: { icon: siGithub },
  gmail: { icon: siGmail },
  google: { icon: siGoogle },
  googleads: { icon: siGoogleads },
  googleanalytics: { icon: siGoogleanalytics },
  googlecalendar: { icon: siGooglecalendar },
  googlecloud: { icon: siGooglecloud },
  googledrive: { icon: siGoogledrive },
  gusto: { icon: siGusto },
  hubspot: { icon: siHubspot },
  jira: { icon: siJira },
  notion: { icon: siNotion },
  posthog: { icon: siPosthog },
  quickbooks: { icon: siQuickbooks },
  sentry: { icon: siSentry },
  strapi: { icon: siStrapi },
  stripe: { icon: siStripe },
  xero: { icon: siXero },
  zoom: { icon: siZoom },
  // The prebuilt support, engineering, docs and files connectors.
  box: { icon: siBox },
  confluence: { icon: siConfluence },
  dropbox: { icon: siDropbox },
  gitlab: { icon: siGitlab },
  intercom: { icon: siIntercom },
  linear: { icon: siLinear },
  pagerduty: { icon: siPagerduty },
  zendesk: { icon: siZendesk },

  amazons3: { title: 'Amazon S3', fallback: 'AWS\'s trademark guidelines allow a plain-text reference only, no logos (aws.amazon.com/trademark-guidelines); simple-icons dropped AWS marks in v15.' },
  amazonwebservices: { title: 'Amazon Web Services', fallback: 'AWS\'s trademark guidelines allow a plain-text reference only, no logos (aws.amazon.com/trademark-guidelines); simple-icons dropped AWS marks in v15.' },
  bill: { title: 'BILL', fallback: 'BILL publishes no terms for third-party use of its logo; not in simple-icons.' },
  apolloio: { title: 'Apollo.io', fallback: 'Apollo.io\'s terms forbid using its logos without prior written permission (apollo.io/terms); not in simple-icons.' },
  firecrawl: { title: 'Firecrawl', fallback: 'Firecrawl\'s brand page covers how to treat the marks, not third-party or integration use (firecrawl.dev/brand); not in simple-icons.' },
  granola: { title: 'Granola', fallback: 'Granola publishes no terms for third-party use of its logo (grano.la/press); not in simple-icons.' },
  netsuite: { title: 'NetSuite', fallback: 'Oracle\'s trademark guidelines do not permit third parties to use its logos (oracle.com/legal/trademarks); not in simple-icons.' },
  microsoftazure: { title: 'Microsoft Azure', fallback: 'Microsoft requires an express licence for its logos and product icons (microsoft.com/legal/intellectualproperty/trademarks); simple-icons removed Microsoft marks in v13 at Microsoft\'s request.' },
  openai: { title: 'OpenAI', fallback: 'OpenAI\'s brand guidelines ask products built on its API to be free of its logos (openai.com/brand); simple-icons dropped the mark in v16.' },
  ramp: { title: 'Ramp', fallback: 'Ramp publishes no terms for third-party use of its logo; not in simple-icons.' },
  rippling: { title: 'Rippling', fallback: 'Rippling publishes no terms for third-party use of its logo; not in simple-icons.' },
  slack: { title: 'Slack', fallback: 'Slack\'s brand terms require a written licence for most logo use and allow an integration to be stated in text only (slack.com/terms-of-service/slack-brand); simple-icons dropped Salesforce marks in v16.' },
  slate: { title: 'Slate', fallback: 'Slate publishes no brand guidelines; not in simple-icons.' },
  workday: { title: 'Workday', fallback: 'Workday\'s trademark guidelines require permission to use its logos (workday.com/en-us/legal/trademarks); not in simple-icons.' },
  freshdesk: { title: 'Freshdesk', fallback: 'Not in simple-icons, and Freshworks\' brand terms have not been checked for integration use; no mark is vendored until they are.' },
  tavily: { title: 'Tavily', fallback: 'Tavily\'s brand page allows its marks in a compatibility statement but not alongside other companies\' without formal permission, which a catalog of tools is (tavily.com/brand); not in simple-icons.' },
} as const satisfies Record<string, BrandEntry>;

/** A brand a descriptor may name. */
export type BrandKey = keyof typeof BRANDS;

/**
 * Whether `value` names a brand in the catalog.
 * @param value - Candidate key, typically off the wire.
 */
export function isBrandKey(value: unknown): value is BrandKey {
  return typeof value === 'string' && Object.hasOwn(BRANDS, value);
}

/** One catalog entry, normalised: its mark (simple-icons) or the reason it has none. */
export type BrandInfo = {
  key: BrandKey;
  title: string;
  mark: { path: string; hex: string; source: string; guidelines: string | null } | null;
  fallback: string | null;
};

/**
 * One brand, normalised.
 * @param key - A catalog key.
 */
function brandInfo(key: BrandKey): BrandInfo {
  const entry: BrandEntry = BRANDS[key];
  if ('icon' in entry) {
    const { icon } = entry;
    return { key, title: icon.title, mark: { path: icon.path, hex: `#${icon.hex}`, source: icon.source, guidelines: icon.guidelines ?? null }, fallback: null };
  }
  return { key, title: entry.title, mark: null, fallback: entry.fallback };
}

/** Every brand, in key order: for the story, the attribution check and the tests. */
export function listBrands(): BrandInfo[] {
  return (Object.keys(BRANDS) as BrandKey[]).sort().map(brandInfo);
}

/** A mark ready to draw: its path and how to fill it in each theme. */
export type ResolvedMark = { title: string; path: string; fills: MarkFills };

/**
 * The mark to draw for a brand, or null when there is none — an unknown key,
 * no key at all, or a brand that falls back to its monogram.
 * @param brand - A descriptor's `brand`, possibly off the wire.
 */
export function resolveBrandMark(brand: string | null | undefined): ResolvedMark | null {
  if (!isBrandKey(brand)) {
    return null;
  }
  const { title, mark } = brandInfo(brand);
  return mark ? { title, path: mark.path, fills: markFills(mark.hex) } : null;
}

/**
 * Whether a brand has a mark to draw — false for an unknown key, no key, or a
 * brand that falls back.
 * @param brand - A descriptor's `brand`, possibly off the wire.
 */
export function hasBrandMark(brand: string | null | undefined): boolean {
  return resolveBrandMark(brand) !== null;
}
