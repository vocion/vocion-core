/**
 * The brand guide's shape — what `brand.yaml` holds and what an Org's brand
 * is (`services/branding`). Pure (zod only), so the Brand settings page can
 * check a draft in the browser with the same schema the server saves with;
 * reading the file and resolving its logos is `brand.ts`.
 */

import { z } from 'zod';

const Hex = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'a hex colour like #F18700');

export const BrandManifestSchema = z.object({
  /** The company as it appears in prose — "Metacto", capital M. */
  name: z.string().min(1).max(80),
  /** One line under a logo, or in a signature. */
  descriptor: z.string().max(200).optional(),
  website: z.string().url().optional(),
  /** Token → hex. Tokens become `--brand-<token>` custom properties. */
  palette: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), Hex).default({}),
  /**
   * Which palette tokens play which role in a document. Each value names a
   * palette token; the frame's `:root` gets `--ink: var(--brand-<token>)`.
   */
  roles: z.object({
    ink: z.string().optional(),
    body: z.string().optional(),
    accent: z.string().optional(),
    teal: z.string().optional(),
    muted: z.string().optional(),
    background: z.string().optional(),
    rule: z.string().optional(),
  }).partial().default({}),
  fonts: z.object({
    heading: z.string().default('Inter'),
    headingWeight: z.number().int().min(100).max(900).default(700),
    body: z.string().default('Inter'),
    /** A Google Fonts stylesheet URL, when the fonts are hosted there. */
    stylesheet: z.string().url().optional(),
  }).default({ heading: 'Inter', headingWeight: 700, body: 'Inter' }),
  /**
   * Logo files, relative to the workspace root (or data: URIs). `mark` is the
   * small square one for a strip; `wordmark` the full lockup for a cover.
   */
  logos: z.object({
    mark: z.string().optional(),
    wordmark: z.string().optional(),
    markOnDark: z.string().optional(),
    /** The wordmark for dark surfaces (a white lockup), when the light one does not read there. */
    wordmarkOnDark: z.string().optional(),
  }).partial().default({}),
  /**
   * The name outbound mail is sent under ("Northwind" in `Northwind
   * <reports@…>`). Absent: the company `name`.
   */
  senderName: z.string().min(1).max(80).optional(),
  /** The house language rules a writer applies — short, imperative lines. */
  voice: z.array(z.string().min(1).max(300)).max(60).default([]),
  /** Words and phrasings that never appear. */
  banned: z.array(z.string().min(1).max(120)).max(100).default([]),
});
export type BrandManifest = z.infer<typeof BrandManifestSchema>;

export type BrandLogoKey = keyof BrandManifest['logos'];
export const BRAND_LOGO_KEYS: readonly BrandLogoKey[] = ['mark', 'wordmark', 'markOnDark', 'wordmarkOnDark'];

/**
 * A workspace's `brand.yaml` when the Org it belongs to has a brand of its
 * own: the same guide with every field optional, so a workspace can override
 * only what its documents need (a palette for one client team, its own voice
 * rules) and inherit the rest. A field it does not write is the Org's.
 */
export const BrandOverrideSchema = BrandManifestSchema.extend({
  name: z.string().min(1).max(80).optional(),
  fonts: z.object({
    heading: z.string().optional(),
    headingWeight: z.number().int().min(100).max(900).optional(),
    body: z.string().optional(),
    stylesheet: z.string().url().optional(),
  }).optional(),
});
export type BrandOverride = z.infer<typeof BrandOverrideSchema>;

function definedOnly<T extends object>(obj: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

/**
 * ONE GUIDE, TWO LEVELS: the Org's brand, with a workspace's file over it.
 *
 * A field the workspace writes wins; a field it leaves out is the Org's.
 * Palette, roles, fonts and logos merge key by key (a workspace that adds one
 * colour keeps the Org's others); the voice and banned lists are replaced
 * whole when the workspace writes any, since half of one house style and half
 * of another is neither. With no Org brand the file must name the company,
 * exactly as it always had to.
 * @param org - The Org's brand, or null.
 * @param file - The workspace's `brand.yaml`, or null.
 * @returns The guide a document uses, or null with nothing to inherit and no name.
 */
export function inheritBrand(org: BrandManifest | null, file: BrandOverride | null): BrandManifest | null {
  if (!file) {
    return org;
  }
  const name = file.name ?? org?.name;
  if (!name) {
    return null;
  }
  return BrandManifestSchema.parse({
    ...(org ?? {}),
    ...definedOnly({ descriptor: file.descriptor, website: file.website, senderName: file.senderName }),
    name,
    palette: { ...org?.palette, ...file.palette },
    roles: { ...org?.roles, ...definedOnly(file.roles) },
    fonts: { ...(org?.fonts ?? {}), ...definedOnly(file.fonts) },
    logos: { ...org?.logos, ...definedOnly(file.logos) },
    voice: file.voice.length > 0 ? file.voice : (org?.voice ?? []),
    banned: file.banned.length > 0 ? file.banned : (org?.banned ?? []),
  });
}
