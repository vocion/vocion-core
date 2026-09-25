/**
 * WikiService — the workspace wiki as markdown ARTIFACTS.
 *
 * A wiki page is not a new noun. It is a `markdown` artifact anchored to the
 * record `{ type: 'wiki', id: <page slug>, role: 'page' }` and filed in the
 * `wiki` folder, so it inherits versions, restore, the preview pane, share,
 * `@mention` and citation for free (design principle 7). What this module
 * adds is the wiki's shape: stable slugs, an index, the mount into every
 * agent's context, and the one write path the `wiki.write_page` action uses.
 *
 * What the wiki is FOR (learned from nine weeks of a hand-run founder wiki):
 * slow-changing, long-term context an agent reads before it acts — the voice,
 * the standing rules, who is who, the decisions that hold. Not a ledger of
 * activity, and never a place a person pastes into: the writer is the agent,
 * the person edits, undoes and asks. Pages that nobody reads are pruned by the
 * curator, not kept because they were once written.
 */

import type { ArtifactRow, Author } from '@/services/ArtifactService';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema } from '@/models/Schema';
import { listArtifactsForRecords, upsertRecordArtifact } from '@/services/ArtifactService';

export const WIKI_FOLDER = 'wiki';
export const WIKI_RECORD_TYPE = 'wiki';
export const WIKI_PAGE_ROLE = 'page';
/** The reserved slug of the index page a repo seed generates (`libs/workspace/wiki-pages.ts`). */
export const WIKI_INDEX_SLUG = 'index';

/** How much of the wiki rides into an agent's context per turn, in characters. Same order as the memory digest. */
export const WIKI_MOUNT_BUDGET_CHARS = 24_000;

export type WikiPage = {
  id: number;
  slug: string;
  title: string;
  /** The page body, markdown. */
  md: string;
  /** One line the index shows; the first paragraph when none was set. */
  summary: string;
  version: number;
  updatedAt: Date;
  createdAt: Date;
  lastAuthorKind: string;
  href: string;
  /** The seeded tags, when the repo set them. `always` mounts the page in full into every turn. */
  tags: string[];
};

/** The tag that mounts a page whole into every agent turn; everything else is read on demand. */
export const WIKI_ALWAYS_TAG = 'always';

/**
 * A page's slug from its title or a proposed slug: lowercase, dashes, no
 * leading digit-only names. `Founder voice` → `founder-voice`.
 * @param raw - A title or a slug someone typed.
 */
export function wikiSlug(raw: string): string {
  const s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s_-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return /^[a-z]/.test(s) ? s : s ? `p-${s}` : '';
}

export function wikiHref(id: number): string {
  return `/dashboard/artifacts/${id}`;
}

/**
 * The first paragraph of a page, for the index. Headings and blank lines are
 * skipped; the result is one line, capped.
 * @param md - The page body.
 */
export function firstParagraph(md: string): string {
  // Prose only: a heading, a rule, a table row, a list item or a quote is not a summary.
  const para = md
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .find(p => p && !/^(?:[#|>]|---|[-*+]\s|\d+\.\s)/.test(p));
  return (para ?? '').replace(/\s+/g, ' ').slice(0, 200);
}

function toPage(row: ArtifactRow): WikiPage {
  const spec = (row.spec ?? {}) as { md?: string; title?: string; summary?: string; seed?: { tags?: unknown } };
  const tags = Array.isArray(spec.seed?.tags) ? spec.seed!.tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    id: row.id,
    slug: row.recordId ?? wikiSlug(row.title),
    title: row.title,
    md: spec.md ?? '',
    summary: spec.summary?.trim() || firstParagraph(spec.md ?? ''),
    version: row.currentVersion,
    updatedAt: row.updatedAt ?? row.createdAt,
    createdAt: row.createdAt,
    lastAuthorKind: row.lastAuthorKind,
    href: wikiHref(row.id),
    tags,
  };
}

/**
 * Every wiki page's artifact row, most recently updated first — for readers
 * that need the spec as stored (the repo seed reads `spec.seed`).
 * @param orgId - The project.
 */
export async function listWikiPageRows(orgId: string): Promise<ArtifactRow[]> {
  return db
    .select()
    .from(artifactSchema)
    .where(and(
      eq(artifactSchema.orgId, orgId),
      eq(artifactSchema.kind, 'markdown'),
      eq(artifactSchema.recordType, WIKI_RECORD_TYPE),
      eq(artifactSchema.recordRole, WIKI_PAGE_ROLE),
    ))
    .orderBy(desc(artifactSchema.updatedAt), desc(artifactSchema.id))
    .limit(500);
}

/**
 * Every wiki page, most recently updated first.
 * @param orgId - The project.
 */
export async function listWikiPages(orgId: string): Promise<WikiPage[]> {
  return (await listWikiPageRows(orgId)).map(toPage);
}

/**
 * One page by slug, or null.
 * @param orgId - The project.
 * @param slug - The page slug (a title is normalised the same way).
 */
export async function getWikiPage(orgId: string, slug: string): Promise<WikiPage | null> {
  const key = wikiSlug(slug);
  if (!key) {
    return null;
  }
  const [row] = await listArtifactsForRecords({ orgId, recordType: WIKI_RECORD_TYPE, recordIds: [key] });
  return row ? toPage(row) : null;
}

export type WriteWikiPageInput = {
  slug: string;
  title: string;
  /** The whole page. Mutually exclusive with `append`. */
  md?: string;
  /** Add a dated section to the end instead of rewriting: `## <heading> · YYYY-MM-DD` + body. */
  append?: { heading: string; body: string };
  summary?: string;
  author: Author;
  /** Why it changed — the version history reads this back. */
  reason: string;
  now?: Date;
};

export type WriteWikiPageResult = {
  page: WikiPage;
  created: boolean;
  unchanged: boolean;
  /** The version before the write, for undo. 0 when the page was created. */
  previousVersion: number;
};

/**
 * Create or revise a page — the ONE write path. An identical body is a
 * no-op (no version is minted for nothing). `append` adds a dated section so
 * a running page (decisions, a glossary) grows without the agent re-sending
 * the whole thing and without silently rewriting what stood.
 * @param orgId - The project.
 * @param input - The page and the change.
 */
export async function writeWikiPage(orgId: string, input: WriteWikiPageInput): Promise<WriteWikiPageResult> {
  const slug = wikiSlug(input.slug || input.title);
  if (!slug) {
    throw new Error('a wiki page needs a slug or a title with at least one letter');
  }
  const existing = await getWikiPage(orgId, slug);
  let md: string;
  if (input.append) {
    const date = (input.now ?? new Date()).toISOString().slice(0, 10);
    const section = `## ${input.append.heading.trim()} · ${date}\n\n${input.append.body.trim()}\n`;
    // The title renders above the body, so a new page does not start with its own H1.
    md = existing?.md ? `${existing.md.trimEnd()}\n\n${section}` : section;
  } else {
    md = (input.md ?? '').trim();
    if (!md) {
      throw new Error('a wiki page body cannot be empty — pass `md`, or `append` a section');
    }
  }
  const spec = {
    title: input.title.trim(),
    md,
    ...(input.summary?.trim() ? { summary: input.summary.trim().slice(0, 200) } : {}),
  };
  const res = await upsertRecordArtifact({
    orgId,
    kind: 'markdown',
    title: input.title.trim(),
    spec,
    folder: WIKI_FOLDER,
    record: { type: WIKI_RECORD_TYPE, id: slug, role: WIKI_PAGE_ROLE },
    author: input.author,
    changeSummary: input.reason,
    noCollapse: true,
  });
  return {
    page: toPage(res.artifact),
    created: res.created,
    unchanged: res.unchanged,
    previousVersion: res.created ? 0 : res.unchanged ? res.artifact.currentVersion : res.artifact.currentVersion - 1,
  };
}

/**
 * The index page an agent reads first: every page with its one-line summary,
 * when it last changed and by whom, most recent first.
 * @param pages - The pages.
 * @param now - The clock, for "n days ago".
 */
export function renderWikiIndex(pages: WikiPage[], now: Date = new Date()): string {
  const lines = [
    '# Workspace wiki',
    '',
    'Long-term context that changes slowly: the voice, the standing rules, who is who, the decisions that hold. Read the page before acting on a standing fact; cite it when you rely on it. When you learn a durable fact or correct one, write it with `write_wiki_page` (say your confidence and why).',
    '',
  ];
  if (pages.length === 0) {
    lines.push('_No pages yet. The first durable fact you learn starts the wiki._');
    return lines.join('\n');
  }
  for (const p of pages) {
    const days = Math.max(0, Math.round((now.getTime() - p.updatedAt.getTime()) / 86_400_000));
    const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    lines.push(`- **${p.title}** (\`${p.slug}\`, v${p.version}, ${when}, ${p.lastAuthorKind}) — ${p.summary || firstParagraph(p.md) || '_no summary_'}`);
  }
  return lines.join('\n');
}

/**
 * The files the wiki mounts into an agent's virtual filesystem: the index at
 * `/wiki/index.md` always, then whole pages at `/wiki/<slug>.md` until the
 * budget runs out, most recently updated first. A page that did not fit is
 * still one `read_wiki_page` away; the index says it exists.
 * @param pages - The pages.
 * @param budgetChars - How much to mount, in characters.
 */
export function planWikiMount(pages: WikiPage[], budgetChars: number = WIKI_MOUNT_BUDGET_CHARS): Record<string, string> {
  const files: Record<string, string> = {};
  // A seeded or hand-written `index` page is a table of contents in reading
  // order; it leads the mounted index, and the rendered listing (every page,
  // with freshness and author) follows, so neither replaces the other.
  const toc = pages.find(p => p.slug === WIKI_INDEX_SLUG);
  const rendered = renderWikiIndex(pages.filter(p => p.slug !== WIKI_INDEX_SLUG));
  const index = toc ? `# ${toc.title}\n\n${toc.md.trim()}\n\n---\n\n${rendered}` : rendered;
  files['/wiki/index.md'] = index;
  // SELECTIVE, NOT EVERYTHING (Chris, 2026-09-24: "the wiki should get used
  // selectively in context when appropriate"). Until now every page rode
  // into every turn until the budget ran out, newest first — a 21-page plan
  // in the context of an agent answering "what shipped". Now only a page
  // tagged `always` is mounted whole; every other page is one line in the
  // index and one `read_wiki_page` away, and the agent reads it when the
  // turn is about it. The budget still holds for the `always` set.
  let used = index.length;
  const omitted: string[] = [];
  for (const p of pages) {
    if (p.slug === WIKI_INDEX_SLUG || !p.tags.includes(WIKI_ALWAYS_TAG)) {
      continue;
    }
    const body = `# ${p.title}\n\n${p.md}`.trim();
    if (used + body.length > budgetChars) {
      omitted.push(p.slug);
      continue;
    }
    files[`/wiki/${p.slug}.md`] = body;
    used += body.length;
  }
  const onDemand = pages.filter(p => p.slug !== WIKI_INDEX_SLUG && !p.tags.includes(WIKI_ALWAYS_TAG)).map(p => p.slug);
  const notes: string[] = [];
  if (omitted.length > 0) {
    notes.push(`_Tagged always but over the mount budget (read with read_wiki_page): ${omitted.join(', ')}_`);
  }
  if (onDemand.length > 0) {
    notes.push(`_Read on demand with read_wiki_page when the turn is about them: ${onDemand.join(', ')}_`);
  }
  if (notes.length > 0) {
    files['/wiki/index.md'] = `${index}\n\n${notes.join('\n')}`;
  }
  return files;
}

/**
 * The mount for one org — pages read, budgeted, keyed by path.
 * @param orgId - The project.
 */
export async function mountWiki(orgId: string): Promise<Record<string, string>> {
  const pages = await listWikiPages(orgId);
  return planWikiMount(pages);
}
