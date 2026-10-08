/**
 * AN ORG'S BRAND — the brand guide, worn by the app.
 *
 * One shape (design principle 6): an Org's brand IS a brand guide
 * (`BrandManifestSchema`, the schema a workspace's `brand.yaml` is read
 * with), stored on the Org with its logos kept in the media store. A
 * workspace's file inherits from it for documents (`inheritBrand`). What the
 * app wears is read off the guide:
 *
 * - the name — the browser title ("Northwind · Vocion") and the sender of mail;
 * - the logos — `wordmark` (and `wordmarkOnDark`) in the sidebar and on
 *   sign-in, `mark` (and `markOnDark`) in the rail and as the favicon;
 * - the accent — the palette token `roles.accent` names, checked and, where
 *   needed, adjusted per theme (`contrast.ts`);
 * - the heading font — `fonts.heading`, when it is on the allowlist
 *   (`fonts.ts`); otherwise headings stay in the app's own face;
 * - `senderName` — the display name outbound mail goes under.
 *
 * Pure: the server builds the view and the CSS from a stored guide; the
 * Brand settings page builds the same view from a draft for its live preview.
 */

import type { AccentTokens } from './contrast';
import type { BrandManifest } from '@/libs/workspace/brandSchema';
import { BrandManifestSchema } from '@/libs/workspace/brandSchema';
import { accentTokens, normalizeHex } from './contrast';
import { headingFontFor } from './fonts';

/** What follows the Org's name in the browser title. */
export const PRODUCT_NAME = 'Vocion';

/** The palette token a brand's accent is written to when it names none. */
const ACCENT_TOKEN = 'accent';

/** The fields a person edits on the Brand page, and a draft carries. */
export type OrgBrandFields = {
  name: string;
  /** `#rrggbb`, or null for Vocion's own accent. */
  accent: string | null;
  /** A heading font family; null for the app's own face. */
  headingFont: string | null;
  /** The display name outbound mail goes under; null uses `name`. */
  senderName: string | null;
  /** Media-store URLs (`/api/media/brand/…`), each optional. */
  logos: { wordmark?: string; wordmarkOnDark?: string; mark?: string; markOnDark?: string };
  /** Where the brand was read from, when it was drafted from a site. */
  website?: string | null;
};

/**
 * The accent colour a guide names: the palette token `roles.accent` points at.
 * @param brand - The guide.
 */
export function brandAccent(brand: BrandManifest): string | null {
  const token = brand.roles.accent;
  const hex = token ? brand.palette[token] : undefined;
  return hex ? normalizeHex(hex) : null;
}

/**
 * The editable fields of a stored guide.
 * @param brand - The guide.
 */
export function fieldsOf(brand: BrandManifest): OrgBrandFields {
  return {
    name: brand.name,
    accent: brandAccent(brand),
    headingFont: brand.fonts.heading && headingFontFor(brand.fonts.heading) ? brand.fonts.heading : null,
    senderName: brand.senderName ?? null,
    logos: { ...brand.logos },
    website: brand.website ?? null,
  };
}

/**
 * A guide with these fields written into it — everything else the guide holds
 * (the rest of the palette, the voice rules) kept as it was. The accent goes
 * to the palette token `roles.accent` already names, or to `accent`.
 * @param base - The guide being edited, or null for a first brand.
 * @param fields - What the person set.
 */
export function withFields(base: BrandManifest | null, fields: OrgBrandFields): BrandManifest {
  const palette = { ...(base?.palette ?? {}) };
  const roles = { ...(base?.roles ?? {}) };
  if (fields.accent) {
    const token = roles.accent && palette[roles.accent] ? roles.accent : ACCENT_TOKEN;
    palette[token] = normalizeHex(fields.accent) ?? fields.accent;
    roles.accent = token;
  } else {
    delete roles.accent;
  }
  const fonts = { ...(base?.fonts ?? { heading: 'Inter', headingWeight: 700, body: 'Inter' }) };
  if (fields.headingFont) {
    fonts.heading = fields.headingFont;
  } else if (headingFontFor(fonts.heading)) {
    // "The app's own face": back to Inter. A face off the allowlist was never
    // in the picker, so it stays in the guide for documents.
    fonts.heading = 'Inter';
  }
  const logos = Object.fromEntries(Object.entries(fields.logos).filter(([, v]) => typeof v === 'string' && v.length > 0));
  return BrandManifestSchema.parse({
    ...(base ?? {}),
    name: fields.name.trim(),
    palette,
    roles,
    fonts,
    logos,
    ...(fields.senderName?.trim() ? { senderName: fields.senderName.trim() } : { senderName: undefined }),
    ...(fields.website ? { website: fields.website } : {}),
  });
}

/** One theme's accent as the app draws it. */
export type ViewAccent = Pick<AccentTokens, 'fill' | 'foreground' | 'notes'> & {
  light: { ink: string; inkForeground: string };
  dark: { ink: string; inkForeground: string };
};

/** What a page needs to wear an Org's brand. Serialisable: it crosses to the client. */
export type OrgBrandView = {
  name: string;
  /** The wordmark per theme; `dark` falls back to `light`. */
  logo: { light?: string; dark?: string };
  /** The square mark per theme (`dark` falls back to `light`); absent when the brand has none, and the rail keeps Vocion's. */
  mark: { light?: string; dark?: string };
  accent: ViewAccent | null;
  headingFont: { family: string; stack: string } | null;
  /** Show the small "Powered by Vocion" mark (false only when an extension white-labels). */
  poweredBy: boolean;
};

export type BrandCheck = { ok: true; brand: BrandManifest; notes: string[] } | { ok: false; reason: string };

/**
 * Whether a guide can be an Org's brand: it parses, and its accent (if any)
 * can be worn readably on light and dark pages. The refusal is a sentence for
 * the person; the notes say what was adjusted.
 * @param raw - The guide, as stored or as submitted.
 */
export function checkOrgBrand(raw: unknown): BrandCheck {
  const parsed = BrandManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, reason: `${issue.path.join('.') || 'brand'}: ${issue.message}` };
  }
  const brand = parsed.data;
  const token = brand.roles.accent;
  if (token && brand.palette[token]) {
    const tokens = accentTokens(brand.palette[token]!);
    if (!tokens.ok) {
      return { ok: false, reason: tokens.reason };
    }
    return { ok: true, brand, notes: tokens.notes };
  }
  return { ok: true, brand, notes: [] };
}

/**
 * The view a page wears, from a guide. An accent that cannot be worn (a guide
 * stored before the check, or edited by hand) is left out rather than drawn
 * unreadably.
 * @param brand - The guide.
 * @param opts - What the installation says.
 * @param opts.whiteLabel - True when an extension removes the "Powered by Vocion" mark.
 */
export function brandView(brand: BrandManifest, opts: { whiteLabel: boolean }): OrgBrandView {
  const hex = brandAccent(brand);
  const tokens = hex ? accentTokens(hex) : null;
  const font = headingFontFor(brand.fonts.heading);
  const wordmark = brand.logos.wordmark;
  const mark = brand.logos.mark;
  return {
    name: brand.name,
    logo: { ...(wordmark ? { light: wordmark } : {}), ...((brand.logos.wordmarkOnDark ?? wordmark) ? { dark: brand.logos.wordmarkOnDark ?? wordmark } : {}) },
    mark: { ...(mark ? { light: mark } : {}), ...((brand.logos.markOnDark ?? mark) ? { dark: brand.logos.markOnDark ?? mark } : {}) },
    accent: tokens?.ok
      ? {
          fill: tokens.fill,
          foreground: tokens.foreground,
          notes: tokens.notes,
          light: { ink: tokens.light.ink, inkForeground: tokens.light.inkForeground },
          dark: { ink: tokens.dark.ink, inkForeground: tokens.dark.inkForeground },
        }
      : null,
    // Inter is the app's own face: naming it changes nothing, so it is not an override.
    headingFont: font && font.id !== 'inter' ? { family: font.family, stack: font.stack } : null,
    poweredBy: !opts.whiteLabel,
  };
}

/**
 * The CSS that layers an Org's brand over the app's tokens
 * (`styles/global.css` § Org brand): the accent's fill and its text, the ink
 * per theme, and the heading face. The app tints are untouched. Every value
 * is a normalised hex or an allowlisted stack, so nothing a person typed
 * reaches the stylesheet as written.
 * @param view - The brand view.
 */
export function brandCss(view: OrgBrandView): string {
  const root: string[] = [];
  const dark: string[] = [];
  if (view.accent) {
    const a = view.accent;
    root.push(`--org-accent:${a.fill}`, `--org-accent-foreground:${a.foreground}`, `--org-accent-ink:${a.light.ink}`, `--org-accent-ink-foreground:${a.light.inkForeground}`);
    dark.push(`--org-accent:${a.fill}`, `--org-accent-foreground:${a.foreground}`, `--org-accent-ink:${a.dark.ink}`, `--org-accent-ink-foreground:${a.dark.inkForeground}`);
  }
  if (view.headingFont) {
    root.push(`--org-font-heading:${view.headingFont.stack}`);
  }
  if (root.length === 0) {
    return '';
  }
  // `:root.dark` outranks the app's own `.dark` block wherever the theme
  // class is on <html>; `.dark` covers a dark island inside a light page.
  return `:root{${root.join(';')}}${dark.length > 0 ? `:root.dark,.dark{${dark.join(';')}}` : ''}`;
}

/**
 * "Northwind · Vocion" — the browser title of an Org's app.
 * @param name - The Org's name in its brand, or null for Vocion alone.
 */
export function brandTitle(name: string | null | undefined): string {
  return name ? `${name} · ${PRODUCT_NAME}` : PRODUCT_NAME;
}

/**
 * The view a draft would wear — for a preview of a brand not yet applied
 * (the brand card in chat, Brand settings while editing). An accent that
 * cannot be worn previews as none; the page says why beside it.
 * @param fields - The draft.
 * @param opts - What the installation says.
 * @param opts.poweredBy - Whether the "Powered by Vocion" mark shows (default yes).
 */
export function previewViewOf(fields: OrgBrandFields, opts: { poweredBy?: boolean } = {}): OrgBrandView {
  const accent = fields.accent && normalizeHex(fields.accent) ? fields.accent : null;
  const brand = withFields(null, { ...fields, name: fields.name.trim() || 'Your company', accent });
  return brandView(brand, { whiteLabel: opts.poweredBy === false });
}
