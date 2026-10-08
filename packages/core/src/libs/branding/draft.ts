/**
 * A BRAND DRAFTED FROM A COMPANY'S OWN SITE — what `propose_brand` shows.
 *
 * `brand_lookup` (Firecrawl's `branding` extractor) reads the colours actually
 * painted on the site, its logo and favicon, and its fonts. A draft is those
 * facts mapped onto the fields an Org's brand has, choosing as a person would:
 *
 * - the accent is the first of the site's primary, accent, link and
 *   secondary colours that can be worn readably (`accentTokens`), a colour
 *   with a hue before a grey; none at all keeps Vocion's own;
 * - the heading font is kept only when the app serves it (`fonts.ts`);
 * - the logo is the site's logo, the mark its favicon when that is an SVG or
 *   a PNG (an `.ico` cannot be kept);
 * - the mail goes out under the company's name.
 *
 * Every choice left out is said in `notes`, in a line, so the card never
 * claims more than the site gave. Pure: no fetch, the logos stay URLs until
 * the person applies the draft (`org.brand_apply` keeps them).
 */

import type { OrgBrandApplyInput } from '@/libs/actions/org-brand-apply';
import type { BrandProfile } from '@/libs/tools/brand/firecrawlBrand';
import { accentTokens, colorDistance, normalizeHex } from './contrast';
import { headingFontFor } from './fonts';

export type BrandDraft = { input: OrgBrandApplyInput; notes: string[] };

/**
 * "Northwind | Home" → "Northwind": a page title is not a company name.
 * @param raw - The name the site gave.
 */
export function cleanBrandName(raw: string): string {
  const cut = raw.split(/\s+[|–—·]\s+|\s+-\s+/)[0] ?? raw;
  return cut.trim().slice(0, 80) || raw.trim().slice(0, 80);
}

/**
 * Whether a URL is worth trying as a logo: an https address that is not an
 * `.ico` (which the store cannot keep). Anything else is tried — the fetch
 * reads the bytes, not the name, and converts a raster to PNG.
 * @param url - The URL.
 */
function logoCandidate(url: string | undefined): string | undefined {
  if (!url || !/^https:\/\//i.test(url) || /\.ico(?:$|[?#])/i.test(url)) {
    return undefined;
  }
  return url;
}

/**
 * The accent a site's colours suggest, and why the others were passed over.
 * @param profile - The lookup.
 */
function pickAccent(profile: BrandProfile): { accent: string | null; note?: string } {
  const c = profile.colors ?? {};
  const background = normalizeHex(c.background ?? '');
  const candidates = [c.primary, c.accent, c.link, c.secondary]
    .map(v => (v ? normalizeHex(v) : null))
    .filter((v): v is string => Boolean(v))
    // A colour the page is painted with, or barely different from it, is not an accent.
    .filter(v => !background || colorDistance(v, background) > 0.08);
  const unique = [...new Set(candidates)];
  const wearable = unique.filter(v => accentTokens(v).ok);
  const chroma = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return Math.max(r, g, b) - Math.min(r, g, b);
  };
  const pick = wearable.find(v => chroma(v) > 24) ?? wearable[0] ?? null;
  if (pick) {
    return { accent: pick };
  }
  if (unique.length > 0) {
    const refusal = accentTokens(unique[0]!);
    return { accent: null, note: `None of the site's colours reads on both light and dark pages${refusal.ok ? '' : ` (${refusal.reason})`}, so the accent stays Vocion's. Set one in Brand settings.` };
  }
  return { accent: null, note: 'The site gave no colours, so the accent stays Vocion\'s.' };
}

/**
 * The draft for a looked-up brand.
 * @param profile - What `brand_lookup` read off the site.
 * @param fallbackName - The name to use when the site gave none (the Org's own).
 */
export function draftFromProfile(profile: BrandProfile, fallbackName: string): BrandDraft {
  const notes: string[] = [];
  const name = cleanBrandName(profile.name ?? fallbackName);
  const { accent, note } = pickAccent(profile);
  if (note) {
    notes.push(note);
  }
  const headingFamily = profile.fonts?.heading ?? profile.fonts?.primary ?? profile.fonts?.body;
  const font = headingFontFor(headingFamily);
  if (headingFamily && !font) {
    notes.push(`Their heading font, ${headingFamily}, isn't one the app serves, so headings stay in the app's own face.`);
  }
  const logo = logoCandidate(profile.logoUrl);
  const mark = logoCandidate(profile.faviconUrl);
  if (!logo) {
    notes.push('The site gave no logo the app can keep (an SVG or a PNG); upload one in Brand settings.');
  }
  if (profile.faviconUrl && !mark) {
    notes.push('Their favicon is an .ico, which the app can\'t keep, so the browser tab keeps Vocion\'s mark until a square SVG or PNG is uploaded.');
  }
  return {
    input: {
      name,
      accent,
      headingFont: font && font.id !== 'inter' ? font.family : null,
      senderName: name,
      logos: { ...(logo ? { wordmark: logo } : {}), ...(mark ? { mark } : {}) },
      website: profile.url,
    },
    notes,
  };
}

/**
 * A draft as the `draft` parameter of the Brand settings page, so "Adjust"
 * opens the page with the draft in it — base64url JSON, nothing stored.
 * @param input - The draft.
 */
export function encodeDraft(input: OrgBrandApplyInput): string {
  const json = JSON.stringify(input);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The draft a `draft` parameter carries, or null when it is not one.
 * @param param - The parameter.
 */
export function decodeDraft(param: string | null | undefined): Partial<OrgBrandApplyInput> | null {
  if (!param) {
    return null;
  }
  try {
    const bin = atob(param.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === 'object' ? value as Partial<OrgBrandApplyInput> : null;
  } catch {
    return null;
  }
}
