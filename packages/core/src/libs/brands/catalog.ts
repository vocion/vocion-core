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
 *   - **A vendored file** (`{ title, vendored }`), the vendor's own SVG from
 *     its brand or press kit, committed unmodified under
 *     `public/brand/integrations/` and drawn as is on a neutral tile — used
 *     only where the vendor's terms allow it (quoted in `ATTRIBUTION.md`).
 *   - **No mark** (`{ title, fallback }`), for a brand whose owner's terms do
 *     not let a third party show its logo to say "this connects to us". Each
 *     says why, here and in `ATTRIBUTION.md`, and the tile falls back to its
 *     icon or monogram. The brand stays a key anyway, so a descriptor names it
 *     today and the logo lands here, once, the day it is allowed.
 *
 * Logos are trademarks of their owners and are shown only to identify the
 * service an integration connects to. `ATTRIBUTION.md` lists every entry's
 * source and licence; `catalog.test.ts` fails when the two disagree.
 */

import type { MarkFills } from './contrast';
import {
  siAnthropic,
  siAtlassian,
  siBrave,
  siElevenlabs,
  siGithub,
  siGmail,
  siGoogle,
  siGoogleads,
  siGoogleanalytics,
  siGooglecalendar,
  siGooglecloud,
  siGoogledrive,
  siGusto,
  siHubspot,
  siJira,
  siNotion,
  siPosthog,
  siQuickbooks,
  siSentry,
  siStrapi,
  siStripe,
  siXero,
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
    | { title: string; vendored: VendoredMark }
    | { title: string; fallback: string };

/**
 * The vendor's own logo file, served unmodified from `public/brand/integrations/`
 * on a neutral tile — never recoloured, so the tile's contrast rule does not
 * apply to it. `dark` is the kit's variant for dark backgrounds; without one the
 * tile stays white in both themes, the background the file was drawn for.
 */
type VendoredMark = {
  /** Public path of the file for light backgrounds. */
  light: string;
  /** Public path of the kit's variant for dark backgrounds, when it has one. */
  dark?: string;
  /** Where the file was downloaded from. */
  source: string;
  /** The page whose terms allow this use (quoted in `ATTRIBUTION.md`). */
  terms: string;
};

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

  amazons3: { title: 'Amazon S3', fallback: 'AWS allows a plain-text reference (no logos), its "Powered by AWS" badge for a customer\'s own software, and architecture icons in diagrams (aws.amazon.com/trademark-guidelines).' },
  amazonwebservices: { title: 'Amazon Web Services', fallback: 'AWS allows a plain-text reference (no logos), its "Powered by AWS" badge for a customer\'s own software, and architecture icons in diagrams (aws.amazon.com/trademark-guidelines).' },
  apolloio: { title: 'Apollo.io', fallback: 'Apollo.io\'s terms forbid using its logos without prior written permission, and it publishes no brand kit (apollo.io/terms).' },
  bill: { title: 'BILL', fallback: 'BILL publishes no terms for third-party use of its logo; not in simple-icons.' },
  firecrawl: { title: 'Firecrawl', vendored: { light: '/brand/integrations/firecrawl/firecrawl-logo.svg', dark: '/brand/integrations/firecrawl/firecrawl-logo.svg', source: 'https://www.firecrawl.dev/brand/brand-assets.zip', terms: 'https://www.firecrawl.dev/press-brand' } },
  granola: { title: 'Granola', vendored: { light: '/brand/integrations/granola/logo-square.svg', dark: '/brand/integrations/granola/logo-square.svg', source: 'https://grano.la/press', terms: 'https://grano.la/press' } },
  microsoftazure: { title: 'Microsoft Azure', fallback: 'Microsoft allows Azure icons only in architecture diagrams, training and documentation, and never to represent another product (learn.microsoft.com/azure/architecture/icons).' },
  netsuite: { title: 'NetSuite', fallback: 'Oracle\'s trademark guidelines do not permit third parties to use its logos (oracle.com/legal/trademarks); not in simple-icons.' },
  openai: { title: 'OpenAI', fallback: 'OpenAI\'s brand page lets API developers name the OpenAI technology they use but asks for permission before using the logo (openai.com/brand); simple-icons dropped the mark in v16.' },
  ramp: { title: 'Ramp', fallback: 'Ramp publishes no terms for third-party use of its logo; not in simple-icons.' },
  rippling: { title: 'Rippling', fallback: 'Rippling publishes no terms for third-party use of its logo; not in simple-icons.' },
  slack: { title: 'Slack', fallback: 'Slack\'s brand terms need a written licence for logo use and forbid redistributing its logos; an app may say in text that it integrates with Slack (slack.com/terms-of-service/slack-brand).' },
  slate: { title: 'Slate', vendored: { light: '/brand/integrations/slate/slate-icon.svg', dark: '/brand/integrations/slate/slate-icon.svg', source: 'https://slatevideo.com/favicon.svg', terms: 'https://slatevideo.com/terms' } },
  tavily: { title: 'Tavily', vendored: { light: '/brand/integrations/tavily/tavily-mark-black.svg', dark: '/brand/integrations/tavily/tavily-mark-offwhite.svg', source: 'https://www.tavily.com/logos/', terms: 'https://www.tavily.com/brand' } },
  workday: { title: 'Workday', fallback: 'Workday\'s trademark guidelines require permission to use its logos (workday.com/en-us/legal/trademarks); not in simple-icons.' },
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
  mark:
    | { kind: 'path'; path: string; hex: string; source: string; guidelines: string | null }
    | { kind: 'file'; light: string; dark: string | null; source: string; terms: string }
    | null;
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
    return { key, title: icon.title, mark: { kind: 'path', path: icon.path, hex: `#${icon.hex}`, source: icon.source, guidelines: icon.guidelines ?? null }, fallback: null };
  }
  if ('vendored' in entry) {
    const { vendored } = entry;
    return { key, title: entry.title, mark: { kind: 'file', light: vendored.light, dark: vendored.dark ?? null, source: vendored.source, terms: vendored.terms }, fallback: null };
  }
  return { key, title: entry.title, mark: null, fallback: entry.fallback };
}

/** Every brand, in key order: for the story, the attribution check and the tests. */
export function listBrands(): BrandInfo[] {
  return (Object.keys(BRANDS) as BrandKey[]).sort().map(brandInfo);
}

/**
 * A mark ready to draw: a simple-icons path and how to fill it in each theme,
 * or the vendor's own file (and its dark variant, when the kit has one).
 */
export type ResolvedMark
  = | { kind: 'path'; title: string; path: string; fills: MarkFills }
    | { kind: 'file'; title: string; light: string; dark: string | null };

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
  if (!mark) {
    return null;
  }
  return mark.kind === 'path'
    ? { kind: 'path', title, path: mark.path, fills: markFills(mark.hex) }
    : { kind: 'file', title, light: mark.light, dark: mark.dark };
}

/**
 * Whether a brand has a mark to draw — false for an unknown key, no key, or a
 * brand that falls back.
 * @param brand - A descriptor's `brand`, possibly off the wire.
 */
export function hasBrandMark(brand: string | null | undefined): boolean {
  return resolveBrandMark(brand) !== null;
}
