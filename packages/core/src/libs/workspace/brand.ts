/**
 * The brand guide — `brand.yaml` in the workspace directory.
 *
 * Everything a client-facing document needs to look like it came from this
 * company and nowhere else: the palette as CSS tokens, the fonts, the logos
 * (inlined as data URIs so a document stays self-contained), and the voice
 * rules the writer applies. It is workspace-authored because it is the one
 * thing that is true of exactly one company (design principle 12: the
 * specifics stay at the edge); the core's job is to read it and hand it to
 * the agent in the shape a document uses.
 *
 * File-only, like pages: `workspace:apply` does not touch it, and a missing
 * or invalid file reads as "no brand" with the issue reported, never a crash.
 * Seed one from a company's own site with the `brand_lookup` tool, then
 * correct it by hand; the values here beat anything recalled.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { readWorkspaceTextFile } from '@/libs/workspace/template-vars';

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
  }).partial().default({}),
  /** The house language rules a writer applies — short, imperative lines. */
  voice: z.array(z.string().min(1).max(300)).max(60).default([]),
  /** Words and phrasings that never appear. */
  banned: z.array(z.string().min(1).max(120)).max(100).default([]),
});
export type BrandManifest = z.infer<typeof BrandManifestSchema>;

export type BrandLoadIssue = { file: string; message: string };

export type LoadedBrand = {
  brand: BrandManifest;
  /** Logos resolved to data URIs, ready to inline. */
  logos: { mark?: string; wordmark?: string; markOnDark?: string };
  /** A `:root { … }` block: `--brand-<token>` per palette entry plus the role aliases. */
  cssRoot: string;
  file: string;
};

const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * A logo reference as a data URI: already one, or a file under the workspace.
 * A file outside the workspace root is refused — the brand cannot be used to
 * read arbitrary paths off the server.
 * @param ref - `data:` URI or a path relative to the workspace root.
 * @param root - The workspace root.
 */
export function logoDataUri(ref: string | undefined, root: string): string | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.startsWith('data:')) {
    return ref;
  }
  const abs = isAbsolute(ref) ? ref : resolve(root, ref);
  if (!abs.startsWith(resolve(root)) || !existsSync(abs)) {
    return undefined;
  }
  const mime = MIME[extname(abs).toLowerCase()];
  if (!mime) {
    return undefined;
  }
  return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
}

/**
 * The palette and role aliases as one `:root` block.
 * @param brand - The manifest.
 */
export function brandCssRoot(brand: BrandManifest): string {
  const lines = Object.entries(brand.palette).map(([token, hex]) => `  --brand-${token}:${hex};`);
  for (const [role, token] of Object.entries(brand.roles)) {
    if (token && brand.palette[token]) {
      lines.push(`  --${role}:var(--brand-${token});`);
    }
  }
  lines.push(`  --font-heading:"${brand.fonts.heading}",sans-serif;`, `  --font-body:"${brand.fonts.body}",-apple-system,sans-serif;`);
  return `:root{\n${lines.join('\n')}\n}`;
}

/**
 * Read `brand.yaml` from a workspace directory.
 * @param root - The workspace root; default `WORKSPACE_PATH`.
 */
export function readWorkspaceBrand(root: string | null = getWorkspacePath()): { brand: LoadedBrand | null; issues: BrandLoadIssue[] } {
  if (!root) {
    return { brand: null, issues: [] };
  }
  const file = ['brand.yaml', 'brand.yml'].map(f => join(root, f)).find(f => existsSync(f));
  if (!file) {
    return { brand: null, issues: [] };
  }
  try {
    const raw = parseYaml(readWorkspaceTextFile(file)) as unknown;
    const parsed = BrandManifestSchema.safeParse(raw);
    if (!parsed.success) {
      return { brand: null, issues: [{ file, message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }] };
    }
    const brand = parsed.data;
    const base = dirname(file);
    const logos = {
      ...(brand.logos.mark ? { mark: logoDataUri(brand.logos.mark, base) } : {}),
      ...(brand.logos.wordmark ? { wordmark: logoDataUri(brand.logos.wordmark, base) } : {}),
      ...(brand.logos.markOnDark ? { markOnDark: logoDataUri(brand.logos.markOnDark, base) } : {}),
    };
    const issues: BrandLoadIssue[] = [];
    for (const [k, v] of Object.entries(brand.logos)) {
      if (v && !(logos as Record<string, string | undefined>)[k]) {
        issues.push({ file, message: `logos.${k}: "${v}" is not a readable image under the workspace` });
      }
    }
    return { brand: { brand, logos, cssRoot: brandCssRoot(brand), file }, issues };
  } catch (err) {
    return { brand: null, issues: [{ file, message: (err as Error).message }] };
  }
}

/**
 * The brand as the agent reads it before writing a document: the CSS block
 * to paste into `:root`, the fonts, the logos as data URIs (truncated in the
 * text, whole in the payload), and the voice rules.
 * @param loaded - A loaded brand.
 */
export function brandForAgent(loaded: LoadedBrand): string {
  const b = loaded.brand;
  const lines = [
    `Brand: ${b.name}${b.descriptor ? ` — ${b.descriptor}` : ''}${b.website ? ` (${b.website})` : ''}`,
    '',
    'CSS tokens (paste into the document\'s :root, then use var(--ink), var(--accent)… in the framework):',
    loaded.cssRoot,
    '',
    `Fonts: headings ${b.fonts.heading} ${b.fonts.headingWeight}, body ${b.fonts.body}.${b.fonts.stylesheet ? ` Stylesheet: ${b.fonts.stylesheet}` : ''}`,
  ];
  const logoLines = Object.entries(loaded.logos).filter(([, v]) => v).map(([k, v]) => `- ${k}: data URI, ${Math.round((v!.length * 3) / 4 / 1024)} KB — inline it as the <img src> exactly; it is returned whole below.`);
  if (logoLines.length) {
    lines.push('', 'Logos:', ...logoLines);
  }
  if (b.voice.length) {
    lines.push('', 'Voice rules:', ...b.voice.map(r => `- ${r}`));
  }
  if (b.banned.length) {
    lines.push('', `Never write: ${b.banned.join(' · ')}`);
  }
  for (const [k, v] of Object.entries(loaded.logos)) {
    if (v) {
      lines.push('', `LOGO ${k}:`, v);
    }
  }
  return lines.join('\n');
}
