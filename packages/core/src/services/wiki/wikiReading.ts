import type { WikiReadingPage } from '@/libs/wiki/reading';
import { listArtifacts } from '@/services/ArtifactService';
import { firstParagraph, wikiSlug } from '@/services/wiki/WikiService';

/**
 * The pages of one folder of markdown artifacts, as the `wiki` page archetype
 * reads them. General over the folder, not over the wiki's record type, so a
 * workspace page can put any folder of markdown on the same surface — the
 * wiki plugin's `wiki` folder is the first.
 *
 * A page the repo seeded and later removed is kept as history
 * (`spec.seed.orphanedAt`, `WikiSeedService.markOrphaned`) and left OUT of
 * the reading view: a page nobody maintains is not part of the wiki a person
 * reads, and it is still one move away in the artifact log. Chris, 2026-09-24:
 * "clear our wiki".
 * @param orgId - The project.
 * @param folder - The artifact folder, e.g. `wiki`.
 * @param opts - `withBodyFor`: the slug whose body the page needs in full; the rest ride without one.
 * @param opts.withBodyFor
 */
export async function loadWikiReadingPages(orgId: string, folder: string, opts: { withBodyFor?: string | null } = {}): Promise<WikiReadingPage[]> {
  const items = await listArtifacts({ orgId, folder, kinds: ['markdown'], limit: 500, visibility: 'all' });
  const out: WikiReadingPage[] = [];
  for (const a of items) {
    const spec = (a.spec ?? {}) as { md?: string; summary?: string; seed?: { order?: number; tags?: string[]; orphanedAt?: string } };
    if (typeof spec.seed?.orphanedAt === 'string' && spec.seed.orphanedAt) {
      continue;
    }
    const slug = (a.recordId && String(a.recordId)) || wikiSlug(a.title);
    if (!slug) {
      continue;
    }
    const md = String(spec.md ?? '');
    out.push({
      id: a.id,
      slug,
      title: a.title,
      summary: spec.summary?.trim() || firstParagraph(md),
      md: opts.withBodyFor === undefined || opts.withBodyFor === slug ? md : '',
      order: typeof spec.seed?.order === 'number' && Number.isFinite(spec.seed.order) ? spec.seed.order : null,
      tags: Array.isArray(spec.seed?.tags) ? spec.seed!.tags!.filter((t): t is string => typeof t === 'string') : [],
      version: a.version,
      updatedAt: new Date(a.updatedAt),
      lastAuthorKind: a.authorKind,
    });
  }
  return out;
}
