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

import type { BrandLogoKey, BrandManifest, BrandOverride } from '@/libs/workspace/brandSchema';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { BRAND_LOGO_KEYS, BrandOverrideSchema, inheritBrand } from '@/libs/workspace/brandSchema';
import { getWorkspacePath } from '@/libs/workspace/reader';
import { readWorkspaceTextFile } from '@/libs/workspace/template-vars';

export { BRAND_LOGO_KEYS, BrandManifestSchema, BrandOverrideSchema, inheritBrand } from '@/libs/workspace/brandSchema';
export type { BrandLogoKey, BrandManifest, BrandOverride } from '@/libs/workspace/brandSchema';

export type BrandLoadIssue = { file: string; message: string };

export type LoadedBrand = {
  brand: BrandManifest;
  /** Logos resolved to data URIs, ready to inline. */
  logos: Partial<Record<BrandLogoKey, string>>;
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
 * The `brand.yaml` a workspace directory holds, read as written — every field
 * optional, since a workspace whose Org has a brand may write only what it
 * overrides — or why it could not be read. No file is no brand, not an issue.
 * @param root - The workspace root; default `WORKSPACE_PATH`.
 */
export function readWorkspaceBrandFile(root: string | null = getWorkspacePath()): { file: string | null; override: BrandOverride | null; issues: BrandLoadIssue[] } {
  if (!root) {
    return { file: null, override: null, issues: [] };
  }
  // turbopackIgnore: this path is only known at runtime, so the build must not
  // trace it, or Next copies the whole project into the image (next.config.ts, #832).
  const file = ['brand.yaml', 'brand.yml'].map(f => join(/* turbopackIgnore: true */ root, f)).find(f => existsSync(f));
  if (!file) {
    return { file: null, override: null, issues: [] };
  }
  try {
    const raw = parseYaml(readWorkspaceTextFile(file)) as unknown;
    const parsed = BrandOverrideSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return { file, override: null, issues: [{ file, message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }] };
    }
    return { file, override: parsed.data, issues: [] };
  } catch (err) {
    return { file, override: null, issues: [{ file, message: (err as Error).message }] };
  }
}

/**
 * A guide with its logos resolved to data URIs and its CSS block, ready for a
 * document. Each logo is resolved by `resolve` — a workspace file against its
 * folder, an Org's uploaded logo from the media store — and a logo that could
 * not be read is an issue, never a broken image.
 * @param brand - The guide.
 * @param file - Where it was read from, for the issues.
 * @param resolveLogo - A logo reference to a data URI, or undefined.
 */
export async function loadBrand(brand: BrandManifest, file: string, resolveLogo: (key: BrandLogoKey, ref: string) => string | undefined | Promise<string | undefined>): Promise<{ brand: LoadedBrand; issues: BrandLoadIssue[] }> {
  const logos: LoadedBrand['logos'] = {};
  const issues: BrandLoadIssue[] = [];
  for (const key of BRAND_LOGO_KEYS) {
    const ref = brand.logos[key];
    if (!ref) {
      continue;
    }
    const uri = await resolveLogo(key, ref);
    if (uri) {
      logos[key] = uri;
    } else {
      issues.push({ file, message: `logos.${key}: "${ref}" is not a readable image` });
    }
  }
  return { brand: { brand, logos, cssRoot: brandCssRoot(brand), file }, issues };
}

/**
 * Read `brand.yaml` from a workspace directory, on its own: the file has to
 * name the company. (A workspace in an Org with a brand inherits it instead —
 * `services/branding/OrgBrandService.ts` `documentBrandFor`.)
 * @param root - The workspace root; default `WORKSPACE_PATH`.
 */
export function readWorkspaceBrand(root: string | null = getWorkspacePath()): { brand: LoadedBrand | null; issues: BrandLoadIssue[] } {
  const read = readWorkspaceBrandFile(root);
  if (!read.file || !read.override) {
    return { brand: null, issues: read.issues };
  }
  const brand = inheritBrand(null, read.override);
  if (!brand) {
    return { brand: null, issues: [{ file: read.file, message: 'name: Required — name the company, or give the Org a brand for this file to inherit' }] };
  }
  const base = dirname(read.file);
  const logos: LoadedBrand['logos'] = {};
  const issues: BrandLoadIssue[] = [];
  for (const key of BRAND_LOGO_KEYS) {
    const ref = brand.logos[key];
    if (ref) {
      const uri = logoDataUri(ref, base);
      if (uri) {
        logos[key] = uri;
      } else {
        issues.push({ file: read.file, message: `logos.${key}: "${ref}" is not a readable image under the workspace` });
      }
    }
  }
  return { brand: { brand, logos, cssRoot: brandCssRoot(brand), file: read.file }, issues };
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
