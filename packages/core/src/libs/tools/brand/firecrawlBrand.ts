import process from 'node:process';
import { resolveToolProviderKey } from '../orgKey';
import { ProviderNotConfiguredError } from '../types';

/**
 * Brand lookup — from a company name, or a sentence containing one, to that
 * company's own site and the design facts on it.
 *
 * Two Firecrawl calls, answering different questions. `/v1/search` finds the
 * official site, which is the part a model gets wrong from memory: it will
 * confidently produce a plausible domain belonging to somebody else.
 * `/v1/scrape` then reads THAT page with Firecrawl's own `branding` format —
 * a purpose-built extractor that returns the brand name, logo, favicon, the
 * colour roles, the font stacks, the spacing scale, and its own confidence in
 * the result.
 *
 * Using their extractor rather than a hand-written JSON schema is the whole
 * point of picking this provider: it reads rendered CSS, so the colours are
 * the ones actually painted rather than the ones a model inferred from
 * screenshots or prose.
 *
 * Everything returned carries the URL it was read from. The alternative —
 * asking a model what a company does and what its colours are — produces an
 * answer that looks identical and cannot be checked, which is the failure
 * design principle 10 exists to stop.
 *
 * Billing: a stored org key spends that org's Firecrawl account, with the
 * server's key as the fallback — the rule every tool provider here follows.
 */

const REQUIRED_ENV = ['FIRECRAWL_API_KEY'];
const SEARCH_URL = 'https://api.firecrawl.dev/v1/search';
const SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape';

/** Colour roles, as Firecrawl reports them. Any may be absent. */
export type BrandColors = {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  textPrimary?: string;
  link?: string;
};

/**
 * What a brand lookup returns. Every field but `url` is optional, deliberately:
 * an absent tagline means the site did not state one, and that is a more useful
 * answer than a plausible invention.
 */
export type BrandProfile = {
  /** The site everything else was read from. Always present. */
  url: string;
  name?: string;
  description?: string;
  logoUrl?: string;
  faviconUrl?: string;
  socialImageUrl?: string;
  colors?: BrandColors;
  /** `light` or `dark`, as the site presents itself. */
  colorScheme?: string;
  /** Font families by role, e.g. `{ heading: 'Acumin Pro', body: 'Roboto' }`. */
  fonts?: Record<string, string>;
  /** Base spacing unit in px and the border radius the site uses. */
  spacing?: { baseUnit?: number; borderRadius?: string };
  /** Firecrawl's own adjectives for the brand's voice and look. */
  personality?: string[];
  /** Firecrawl's confidence in the extraction, 0..1, when it reports one. */
  confidence?: number;
  /** Other candidates the search returned, for when the first is wrong. */
  alternates?: Array<{ url: string; title?: string }>;
};

async function apiKeyFor(orgId: string | null): Promise<string> {
  const orgKey = orgId ? await resolveToolProviderKey('firecrawl', orgId) : null;
  const key = orgKey ?? process.env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new ProviderNotConfiguredError('brand lookup', 'firecrawl', REQUIRED_ENV);
  }
  return key;
}

async function post<T>(url: string, key: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`firecrawl ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
  }
  return (await res.json()) as T;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/**
 * A hex colour normalised to `#rrggbb`, or undefined when it is not one.
 * @param value
 */
function hex(value: unknown): string | undefined {
  const s = str(value);
  const m = s ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s) : null;
  if (!m) {
    return undefined;
  }
  const raw = m[1]!.toLowerCase();
  return `#${raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw}`;
}

function pick<T extends object>(obj: T): T | undefined {
  return Object.values(obj).some(v => v !== undefined) ? obj : undefined;
}

/**
 * Find a company's site and read its brand off it.
 * @param query - A company name, a bare domain, or a sentence containing one.
 * @param opts - Key resolution and how many alternates to keep.
 * @param opts.orgId - The org whose Firecrawl key should be spent.
 * @param opts.alternates - How many other candidate sites to return (0-5).
 * @returns The profile, or null when the search found no site at all.
 */
export async function lookupBrand(
  query: string,
  opts: { orgId?: string | null; alternates?: number } = {},
): Promise<BrandProfile | null> {
  const key = await apiKeyFor(opts.orgId ?? null);
  const keep = Math.min(Math.max(opts.alternates ?? 3, 0), 5);

  // A bare domain IS the answer; searching for it spends a credit and can rank
  // a directory listing above the company itself.
  const bare = /^(?:https?:\/\/)?((?:[\w-]+\.)+[a-z]{2,})(?:\/|$)/i.exec(query.trim());

  let url: string;
  let alternates: BrandProfile['alternates'] = [];

  if (bare) {
    url = `https://${bare[1]}`;
  } else {
    const found = await post<{ data?: Array<{ url?: string; title?: string }> }>(
      SEARCH_URL,
      key,
      { query: `${query} official site`, limit: keep + 1 },
    );
    const hits = (found.data ?? []).filter((h): h is { url: string; title?: string } => typeof h.url === 'string');
    if (hits.length === 0) {
      return null;
    }
    url = hits[0]!.url;
    alternates = hits.slice(1, keep + 1).map(h => ({ url: h.url, title: h.title }));
  }

  const scraped = await post<{
    data?: { branding?: Record<string, unknown>; metadata?: Record<string, unknown> };
  }>(SCRAPE_URL, key, { url, formats: ['branding'] });

  const b = scraped.data?.branding ?? {};
  const meta = scraped.data?.metadata ?? {};
  const images = (b.images ?? {}) as Record<string, unknown>;
  const rawColors = (b.colors ?? {}) as Record<string, unknown>;
  const typography = (b.typography ?? {}) as Record<string, unknown>;
  const families = (typography.fontFamilies ?? {}) as Record<string, unknown>;
  const spacing = (b.spacing ?? {}) as Record<string, unknown>;

  const fonts: Record<string, string> = {};
  for (const [role, family] of Object.entries(families)) {
    const f = str(family);
    if (f) {
      fonts[role] = f;
    }
  }

  return {
    url,
    name: str(b.brandName) ?? str(meta.ogSiteName) ?? str(meta.title),
    description: str(meta.description) ?? str(meta.ogDescription),
    logoUrl: str(b.logo) ?? str(images.logo),
    faviconUrl: str(images.favicon),
    socialImageUrl: str(images.ogImage) ?? str(meta.ogImage),
    colors: pick({
      primary: hex(rawColors.primary),
      secondary: hex(rawColors.secondary),
      accent: hex(rawColors.accent),
      background: hex(rawColors.background),
      textPrimary: hex(rawColors.textPrimary),
      link: hex(rawColors.link),
    }),
    colorScheme: str(b.colorScheme),
    ...(Object.keys(fonts).length > 0 ? { fonts } : {}),
    spacing: pick({
      baseUnit: typeof spacing.baseUnit === 'number' ? spacing.baseUnit : undefined,
      borderRadius: str(spacing.borderRadius),
    }),
    ...(Array.isArray(b.personality)
      ? { personality: b.personality.map(str).filter((x): x is string => Boolean(x)) }
      : {}),
    ...(typeof b.confidence === 'number' ? { confidence: b.confidence } : {}),
    ...(alternates.length > 0 ? { alternates } : {}),
  };
}
