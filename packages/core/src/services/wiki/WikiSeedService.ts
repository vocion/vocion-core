/**
 * WikiSeedService — `wiki/<slug>.md` files become wiki pages on apply.
 *
 * The pure half (read, validate, hash, render the index) is
 * `libs/workspace/wiki-pages.ts`; this is the half that touches the
 * database, called once per `workspace:apply` by the applier.
 *
 * The rules, in order, per file:
 *
 *   - no page with that slug          → CREATE it (author: system, the seed)
 *   - `managed: false` and a page     → leave it, whatever it says (seeded once)
 *   - the recorded sha equals the     → UNCHANGED, nothing written
 *     file's
 *   - the page is still the seed's    → UPDATE it: a new version, the file's
 *     (no edit since the seed wrote     content, the new sha
 *     its version)
 *   - anyone edited it in the app     → KEEP it and warn: the file was not
 *                                       applied; edit the file to match, or set
 *                                       `managed: false`
 *
 * "Still the seed's" is `artifact.currentVersion === spec.seed.version` — the
 * version the seed wrote is the head — which is exact whoever the editor was
 * and needs no second history. A page that predates seeding (no `seed` block)
 * is the seed's only while its head author is `system`.
 *
 * A file that is gone does not take its page with it: a page is what people
 * read and cite, and deleting it is a person's call from the Wiki page. The
 * apply says once that the page is orphaned, by writing `seed.orphanedAt` as
 * a system version whose change summary names the removal — the same "the
 * git answer beside the in-app ones" the source mirrors record.
 *
 * Every write goes through `upsertRecordArtifact`, so it is a version like
 * any other (undo, restore, history) and `artifact.saved` fires — the wiki
 * plugin's `index-artifact` automation indexes the page for search.
 *
 * A dry run classifies and warns but writes nothing; offline it can only say
 * how many pages there are (`unknown`), per #500.
 */

import type { LoadedWikiPage } from '@/libs/workspace/wiki-pages';
import type { ArtifactRow, Author } from '@/services/ArtifactService';
import { renderSeededWikiIndex, WIKI_INDEX_SLUG, wikiPageSha } from '@/libs/workspace/wiki-pages';
import { upsertRecordArtifact } from '@/services/ArtifactService';
import { firstParagraph, listWikiPageRows, WIKI_FOLDER, WIKI_PAGE_ROLE, WIKI_RECORD_TYPE } from '@/services/wiki/WikiService';

/** Who the seed writes as. `system`, so a page nobody has touched reads as the repo's. */
export const WIKI_SEED_AUTHOR: Author = { kind: 'system', id: 'workspace-seed' };

/** What the generated index records as its path — there is no file behind it. */
export const GENERATED_INDEX_PATH = '(generated from wiki/*.md)';

export type WikiSeedOutcome = 'created' | 'updated' | 'unchanged' | 'kept' | 'unknown';

export type WikiSeedWarning = { resource: 'wikiPage'; slug: string; message: string };

export type WikiSeedResult = {
  outcomes: Array<{ slug: string; outcome: WikiSeedOutcome }>;
  warnings: WikiSeedWarning[];
};

export type WikiSeedOptions = {
  /** Classify and warn, write nothing. */
  dryRun: boolean;
  /** A dry run with no database: every page is `unknown`. */
  offline: boolean;
  /** The workspace sha being applied — recorded on each seed for provenance. */
  workspaceSha: string;
  now?: Date;
};

type SeedMeta = {
  sha: string;
  path: string;
  appliedAt: string;
  version: number;
  managed: boolean;
  workspaceSha?: string;
  order?: number;
  tags?: string[];
  orphanedAt?: string;
};

/** A page about to be seeded — a file, or the index rendered from the files. */
type Candidate = Pick<LoadedWikiPage, 'slug' | 'title' | 'summary' | 'order' | 'tags' | 'managed' | 'body' | 'sha'> & { path: string; generated: boolean };

function seedOf(row: ArtifactRow): SeedMeta | null {
  const seed = (row.spec as { seed?: unknown }).seed;
  return seed && typeof seed === 'object' && typeof (seed as SeedMeta).sha === 'string' ? (seed as SeedMeta) : null;
}

/**
 * Whether the head of a page is still what the seed wrote — nobody edited,
 * restored or rewrote it in the app since.
 * @param row - The page's artifact row.
 * @param seed - Its seed block, when it has one.
 */
function seedOwned(row: ArtifactRow, seed: SeedMeta | null): boolean {
  return seed ? row.currentVersion === seed.version : row.lastAuthorKind === 'system';
}

function editorOf(row: ArtifactRow): string {
  return row.lastAuthorKind === 'human' ? 'a person' : row.lastAuthorKind === 'agent' ? 'an agent' : 'the system';
}

/**
 * Seed (or refresh) the wiki from a workspace's `wiki/<slug>.md` files, and
 * the generated index unless `wiki/index.md` is one of them.
 * @param orgId - The project.
 * @param pages - The loaded pages (`LoadedWorkspace.wikiPages`).
 * @param opts - Dry-run / offline mode and the workspace sha.
 */
export async function seedWikiPages(orgId: string, pages: LoadedWikiPage[], opts: WikiSeedOptions): Promise<WikiSeedResult> {
  const result: WikiSeedResult = { outcomes: [], warnings: [] };
  const candidates: Candidate[] = pages.map(p => ({ ...p, path: p.relPath, generated: false }));
  const generateIndex = pages.length > 0 && !pages.some(p => p.slug === WIKI_INDEX_SLUG);

  if (opts.offline) {
    for (const c of candidates) {
      result.outcomes.push({ slug: c.slug, outcome: 'unknown' });
    }
    if (generateIndex) {
      result.outcomes.push({ slug: WIKI_INDEX_SLUG, outcome: 'unknown' });
    }
    return result;
  }

  const now = opts.now ?? new Date();
  const rows = await listWikiPageRows(orgId);
  const bySlug = new Map(rows.filter(r => r.recordId).map(r => [r.recordId!, r]));

  // The pages as they will stand after this apply: the file's title and
  // summary where the file is applied, the page's own where it is kept —
  // so the generated index describes what a reader will find, not a file
  // that was not applied.
  const standing: LoadedWikiPage[] = [];

  const seedOne = async (c: Candidate): Promise<WikiSeedOutcome> => {
    const existing = bySlug.get(c.slug);
    if (!existing) {
      if (!opts.dryRun) {
        await write(orgId, c, null, now, opts.workspaceSha);
      }
      return 'created';
    }
    const seed = seedOf(existing);
    if (!c.managed) {
      // Seeded once — or written by someone else first — and never touched again.
      return 'unchanged';
    }
    if (seed && seed.sha === c.sha && !seed.orphanedAt) {
      return 'unchanged';
    }
    if (!seedOwned(existing, seed)) {
      result.warnings.push({
        resource: 'wikiPage',
        slug: c.slug,
        message: c.generated
          ? `edited in the app since it was generated (v${existing.currentVersion} by ${editorOf(existing)}); the index was not regenerated. Seed your own wiki/index.md to take it over, or restore the generated version from its history.`
          : `edited in the app since the last seed (v${existing.currentVersion} by ${editorOf(existing)}); ${c.path} was not applied. Edit the file to match the page, or set managed: false to stop seeding it.`,
      });
      return 'kept';
    }
    if (!opts.dryRun) {
      await write(orgId, c, existing, now, opts.workspaceSha, seed?.orphanedAt ? `${c.path} is back in the workspace` : undefined);
    }
    return 'updated';
  };

  for (const [i, c] of candidates.entries()) {
    const outcome = await seedOne(c);
    result.outcomes.push({ slug: c.slug, outcome });
    const existing = bySlug.get(c.slug);
    const page = pages[i]!;
    if (existing && (outcome === 'unchanged' || outcome === 'kept')) {
      const spec = existing.spec as { summary?: string; md?: string };
      standing.push({ ...page, title: existing.title, summary: spec.summary?.trim() || firstParagraph(spec.md ?? '') });
    } else {
      standing.push(page);
    }
  }

  if (generateIndex) {
    const body = renderSeededWikiIndex(standing, p => firstParagraph(p.body));
    const index: Candidate = {
      slug: WIKI_INDEX_SLUG,
      title: 'Index',
      summary: 'The seeded pages, in reading order.',
      order: undefined,
      tags: [],
      managed: true,
      body,
      sha: wikiPageSha(body),
      path: GENERATED_INDEX_PATH,
      generated: true,
    };
    candidates.push(index);
    result.outcomes.push({ slug: index.slug, outcome: await seedOne(index) });
  }

  // Pages the repo seeded whose file is gone. Said once, and only for a page
  // still the seed's — one a person or an agent has since edited is theirs
  // now, and the file's job was done.
  const seeded = new Set(candidates.map(c => c.slug));
  for (const row of rows) {
    const seed = seedOf(row);
    if (!seed || !row.recordId || seeded.has(row.recordId) || seed.managed === false || seed.orphanedAt || !seedOwned(row, seed)) {
      continue;
    }
    result.warnings.push({
      resource: 'wikiPage',
      slug: row.recordId,
      message: `${seed.path} is gone from the workspace; the page is kept (v${row.currentVersion}). Delete it from the Wiki page if it should go, or restore the file to seed it again.`,
    });
    if (!opts.dryRun) {
      await markOrphaned(orgId, row, seed, now);
    }
  }

  return result;
}

async function write(orgId: string, c: Candidate, existing: ArtifactRow | null, now: Date, workspaceSha: string, changeSummary?: string): Promise<void> {
  const version = existing ? existing.currentVersion + 1 : 1;
  const seed: SeedMeta = {
    sha: c.sha,
    path: c.path,
    appliedAt: now.toISOString(),
    version,
    managed: c.managed,
    workspaceSha,
    ...(c.order === undefined ? {} : { order: c.order }),
    ...(c.tags.length > 0 ? { tags: c.tags } : {}),
  };
  const summary = c.summary?.trim();
  await upsertRecordArtifact({
    orgId,
    kind: 'markdown',
    title: c.title,
    spec: { title: c.title, md: c.body, ...(summary ? { summary } : {}), seed },
    folder: WIKI_FOLDER,
    record: { type: WIKI_RECORD_TYPE, id: c.slug, role: WIKI_PAGE_ROLE },
    author: WIKI_SEED_AUTHOR,
    changeSummary: changeSummary ?? (c.generated
      ? `Generated from the seeded pages (workspace ${workspaceSha.slice(0, 12)})`
      : `Seeded from ${c.path} (${c.sha.slice(0, 12)}, workspace ${workspaceSha.slice(0, 12)})`),
    noCollapse: true,
  });
}

async function markOrphaned(orgId: string, row: ArtifactRow, seed: SeedMeta, now: Date): Promise<void> {
  const spec = row.spec as Record<string, unknown>;
  await upsertRecordArtifact({
    orgId,
    kind: 'markdown',
    title: row.title,
    spec: { ...spec, seed: { ...seed, version: row.currentVersion + 1, orphanedAt: now.toISOString() } },
    folder: WIKI_FOLDER,
    record: { type: WIKI_RECORD_TYPE, id: row.recordId!, role: WIKI_PAGE_ROLE },
    author: WIKI_SEED_AUTHOR,
    changeSummary: `${seed.path} was removed from the workspace; page kept`,
    noCollapse: true,
  });
}
