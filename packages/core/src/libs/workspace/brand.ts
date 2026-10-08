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
 * Each apply stores the file and the logos it names with the project
 * (`workspace_file`), so a project reads its own brand on a host with no
 * folder for it — `services/workspace/WorkspaceFileService.ts`
 * `readBrandForOrg` reads the database first and this folder only for a
 * project with nothing stored. Both go through {@link loadBrand}. A missing
 * or invalid file reads as "no brand" with the issue reported, never a crash.
 * Seed one from a company's own site with the `brand_lookup` tool, then
 * correct it by hand; the values here beat anything recalled.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, posix, resolve } from 'node:path';
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

/** The brand file's names, in the order they are looked for. */
export const BRAND_FILES = ['brand.yaml', 'brand.yml'] as const;

/**
 * The image type a logo file is inlined as, or undefined for a file that is
 * not one of the types a document can carry.
 * @param file - The logo's path or name.
 */
export function logoMimeType(file: string): string | undefined {
  return MIME[extname(file).toLowerCase()];
}

/**
 * Where a relative logo reference points inside the workspace, `/`-separated —
 * the key the logo is stored under — or null for a data URI, an absolute path,
 * or a path that climbs out of the workspace root.
 * @param ref - The reference as `brand.yaml` writes it.
 */
export function logoRefPath(ref: string): string | null {
  if (ref.startsWith('data:') || isAbsolute(ref) || ref.includes('\0')) {
    return null;
  }
  const path = posix.normalize(ref);
  return path === '..' || path.startsWith('../') || path.startsWith('/') || path === '.' ? null : path;
}

/**
 * The logo references a brand file names, read leniently: whatever the
 * `logos:` block holds as text, valid or not. What an apply stores beside the
 * brand file; validation is {@link loadBrand}'s job.
 * @param text - The brand file's text, tokens resolved.
 */
export function brandLogoRefs(text: string): string[] {
  try {
    const raw = parseYaml(text) as { logos?: unknown } | null;
    const logos = raw && typeof raw.logos === 'object' && raw.logos !== null ? Object.values(raw.logos) : [];
    return logos.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

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
  const mime = logoMimeType(abs);
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
 * Where a brand is read from, whichever store holds it: the file's name for an
 * issue, its text, and how a logo reference becomes a data URI.
 */
export type BrandSource = {
  /** Names the brand in an issue: the file on disk, or the stored path. */
  file: string;
  /** The brand file's text with `{{env.NAME}}` tokens resolved. A token that cannot be resolved throws, and is reported as an issue. */
  read: () => string;
  /** A relative logo reference as a data URI, or undefined when it is not a readable image under the workspace. */
  logo: (ref: string) => string | undefined;
};

/**
 * Parse and validate a brand from wherever it lives. A data-URI logo is used
 * as written; any other is resolved through the source.
 * @param source - See {@link BrandSource}.
 */
export function loadBrand(source: BrandSource): { brand: LoadedBrand | null; issues: BrandLoadIssue[] } {
  const { file } = source;
  try {
    const raw = parseYaml(source.read()) as unknown;
    const parsed = BrandManifestSchema.safeParse(raw);
    if (!parsed.success) {
      return { brand: null, issues: [{ file, message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }] };
    }
    const brand = parsed.data;
    const inline = (ref: string) => (ref.startsWith('data:') ? ref : source.logo(ref));
    const logos = {
      ...(brand.logos.mark ? { mark: inline(brand.logos.mark) } : {}),
      ...(brand.logos.wordmark ? { wordmark: inline(brand.logos.wordmark) } : {}),
      ...(brand.logos.markOnDark ? { markOnDark: inline(brand.logos.markOnDark) } : {}),
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
 * Read `brand.yaml` from a workspace directory.
 * @param root - The workspace root; default `WORKSPACE_PATH`.
 */
export function readWorkspaceBrand(root: string | null = getWorkspacePath()): { brand: LoadedBrand | null; issues: BrandLoadIssue[] } {
  if (!root) {
    return { brand: null, issues: [] };
  }
  // turbopackIgnore: this path is only known at runtime, so the build must not
  // trace it, or Next copies the whole project into the image (next.config.ts, #832).
  const file = BRAND_FILES.map(f => join(/* turbopackIgnore: true */ root, f)).find(f => existsSync(f));
  if (!file) {
    return { brand: null, issues: [] };
  }
  const base = dirname(file);
  return loadBrand({ file, read: () => readWorkspaceTextFile(file), logo: ref => logoDataUri(ref, base) });
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
