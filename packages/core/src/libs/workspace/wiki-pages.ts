/**
 * Wiki pages seeded from the workspace repo — `wiki/<slug>.md`.
 *
 * A workspace folder may carry the first pages of its wiki as markdown files
 * with YAML frontmatter, so a wiki starts from what the repo already says
 * (the voice, who is who, the standing rules) rather than from an agent
 * imagining it. On apply each file becomes, or refreshes, the markdown
 * artifact with the same slug in the org's `wiki` folder — the same artifact
 * the `wiki.write_page` action writes, so versions, restore, the mount into
 * every agent's context and `index-artifact` all come free. The FILE is the
 * seed, not the source of truth: a page a person or an agent has edited in
 * the app since the last seed is kept, and the apply says so.
 *
 * This module is the pure half — read, validate, hash, render the index. The
 * database half is `services/wiki/WikiSeedService.ts`; the applier calls it.
 *
 * The contract a file must meet:
 *
 *   wiki/<slug>.md          slug: lowercase letters, digits and dashes, starts
 *                           with a letter; `index` is reserved (see below)
 *   ---
 *   title: Voice            required
 *   summary: One line       optional, ≤ 200 chars; the first paragraph otherwise
 *   order: 10               optional number; sorts the generated index
 *   tags: [voice, style]    optional
 *   managed: true           optional, default true; false seeds once, then never again
 *   ---
 *   The page body, markdown. No `#` title line — the title renders above it.
 *
 * Unknown frontmatter keys fail the load, so a typo cannot be dropped in
 * silence. Files are read as written: no `{{env.NAME}}` substitution, because
 * a wiki page may well document that very syntax. Only top-level `.md` files
 * count; anything else in `wiki/` is left alone.
 *
 * `wiki/index.md`, when present, is a page like any other. When absent, the
 * apply generates the `index` page from every seeded page's order, title and
 * summary (`renderSeededWikiIndex`) and refreshes it whenever they change.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { WorkspaceValidationError } from './loader';

/** The workspace directory the pages live in. */
export const WIKI_PAGES_DIR = 'wiki';

/** The slug of the index page — generated unless `wiki/index.md` is seeded. */
export const WIKI_INDEX_SLUG = 'index';

/** A page slug as the wiki spells it: dashes, no underscores, starts with a letter. */
const WIKI_SLUG_RE = /^[a-z][a-z0-9-]{0,79}$/;

export const WikiPageFrontmatterSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(200),
  summary: z.string().trim().max(200).optional(),
  order: z.number().finite().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  managed: z.boolean().default(true),
}).strict();

export type WikiPageFrontmatter = z.infer<typeof WikiPageFrontmatterSchema>;

export type LoadedWikiPage = WikiPageFrontmatter & {
  slug: string;
  /** The markdown after the frontmatter, trimmed. */
  body: string;
  /** SHA-256 of the whole file as written — frontmatter and body. */
  sha: string;
  /** Absolute path of the file. */
  sourceFile: string;
  /** `wiki/<slug>.md` — what the artifact's `seed.path` records. */
  relPath: string;
};

/**
 * Every `wiki/<slug>.md` in a workspace, validated, A–Z by slug. Missing
 * directory means no pages. Throws {@link WorkspaceValidationError} naming
 * the file on a bad slug, missing frontmatter, an unknown key or an empty body.
 * @param workspaceDir - Absolute workspace directory.
 * @param files - The sha-tracking list; every page file is appended.
 */
export function loadWikiPages(workspaceDir: string, files: string[]): LoadedWikiPage[] {
  const dir = join(workspaceDir, WIKI_PAGES_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  const pages: LoadedWikiPage[] = [];
  for (const name of entries.sort()) {
    const file = join(dir, name);
    if (!name.endsWith('.md') || !statSync(file).isFile()) {
      continue;
    }
    files.push(file);
    pages.push(parseWikiPageFile(file, readFileSync(file, 'utf8')));
  }
  return pages;
}

/**
 * One file's text as a page. Exported for the tests and the service; the
 * loader goes through {@link loadWikiPages}.
 * @param file - Absolute path (its basename is the slug).
 * @param text - The file as written.
 */
export function parseWikiPageFile(file: string, text: string): LoadedWikiPage {
  const slug = basename(file, '.md');
  if (!WIKI_SLUG_RE.test(slug)) {
    throw new WorkspaceValidationError(file, 'wiki page', [
      `filename "${slug}" is not a wiki slug — lowercase letters, digits and dashes, starting with a letter (e.g. who-is-who.md)`,
    ]);
  }
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new WorkspaceValidationError(file, 'wiki page', ['missing YAML frontmatter — the file starts with `---`, then at least `title:`, then `---`']);
  }
  const [, yamlText, rest] = match;
  let data: unknown;
  try {
    data = parseYaml(yamlText ?? '') ?? {};
  } catch (err) {
    throw new WorkspaceValidationError(file, 'wiki page', [`invalid YAML frontmatter — ${(err as Error).message}`]);
  }
  const parsed = WikiPageFrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.length > 0 ? issue.path.map(String).join('.') : '(frontmatter)'}: ${issue.message}`);
    throw new WorkspaceValidationError(file, 'wiki page', issues);
  }
  const body = (rest ?? '').trim();
  if (!body) {
    throw new WorkspaceValidationError(file, 'wiki page', ['the page body is empty — write the page under the frontmatter']);
  }
  return {
    ...parsed.data,
    slug,
    body,
    sha: wikiPageSha(text),
    sourceFile: file,
    relPath: `${WIKI_PAGES_DIR}/${slug}.md`,
  };
}

/**
 * The content hash a seed records — of the file as written, so a changed
 * summary or order is a change too.
 * @param text - The whole file.
 */
export function wikiPageSha(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * The generated `index` page: every seeded page by `order` (unordered pages
 * last, A–Z by title), each with its one-line summary. Rendered from the
 * files alone, so a dry run can say what it would write. Pages an agent
 * wrote are not listed here — the mount's own index (`/wiki/index.md`, from
 * `WikiService.renderWikiIndex`) lists everything with freshness and author.
 * @param pages - The seeded pages, `index` itself excluded by the caller.
 * @param summaryOf - The summary for a page when its frontmatter has none.
 */
export function renderSeededWikiIndex(pages: LoadedWikiPage[], summaryOf: (page: LoadedWikiPage) => string): string {
  const ordered = [...pages]
    .filter(p => p.slug !== WIKI_INDEX_SLUG)
    .sort((a, b) => {
      const ao = a.order ?? Number.POSITIVE_INFINITY;
      const bo = b.order ?? Number.POSITIVE_INFINITY;
      return ao !== bo ? ao - bo : a.title.localeCompare(b.title);
    });
  const lines = [
    'The pages this workspace seeds from its repo (`wiki/<slug>.md`), in reading order. Pages the agents wrote since are listed on the Wiki page and in the mounted index.',
    '',
  ];
  for (const p of ordered) {
    const summary = (p.summary ?? '').trim() || summaryOf(p).trim();
    lines.push(`- **${p.title}** (\`${p.slug}\`)${summary ? ` — ${summary}` : ''}`);
  }
  return lines.join('\n');
}
