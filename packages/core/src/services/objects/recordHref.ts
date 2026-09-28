import type { PageManifest } from '@/libs/workspace/pageFields';
import type { RecordLinker, RecordLinkRef, RecordLinks } from '@/libs/workspace/recordHref';
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/libs/DB';
import { readWorkspacePages } from '@/libs/workspace/pages';
import { NO_RECORD_PAGES, recordHrefFrom, recordLinker, recordLinksOf } from '@/libs/workspace/recordHref';
import { projectSchema } from '@/models/Schema';
import { enabledPluginsForOrg } from '@/services/PluginService';
import { mountedWorkspaceIsProjects, projectPagesFolder } from '@/services/WorkspaceMountService';

/**
 * The server half of ONE LINK FOR EVERY RECORD (`libs/workspace/recordHref.ts`):
 * which page opens each object type in THIS workspace, read from the pages it
 * has on — the same list the shell draws its nav from, so a link and the nav
 * never disagree about which pages exist — and the workspace's slug, so every
 * link is canonical (`/w/<slug>/…`).
 *
 * Read once per request: React's `cache` dedupes the read across every
 * surface a server render draws. Outside a render (a route handler, the
 * worker) it is a plain call, so a caller drawing many links builds the
 * linker once ({@link recordLinkerForOrg}) and hands it down.
 */

/**
 * This org's record pages and slug. Never throws: a workspace whose pages
 * cannot be read links every record to the generic view, which still works.
 * @param orgId - The project.
 */
export const recordLinksForOrg = cache(async (orgId: string): Promise<RecordLinks> => {
  try {
    const [enabledPlugins, mounted, [project]] = await Promise.all([
      enabledPluginsForOrg(orgId),
      mountedWorkspaceIsProjects(orgId).catch(() => false),
      db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1),
    ]);
    const dir = mounted ? null : await projectPagesFolder(orgId).catch(() => null);
    const { pages } = readWorkspacePages({ enabledPlugins, mounted, dir });
    return recordLinksOf(pages, project?.slug ?? null);
  } catch (error) {
    console.warn('[recordHref] could not read the workspace pages; records open the generic view', { orgId, error: (error as Error).message });
    return NO_RECORD_PAGES;
  }
});

/**
 * One resolver bound to this org, for a surface that draws many links.
 * @param orgId - The project.
 */
export async function recordLinkerForOrg(orgId: string): Promise<RecordLinker> {
  return recordLinker(await recordLinksForOrg(orgId));
}

/**
 * The link to one record: the page the workspace declares for its type, else
 * `/dashboard/objects/<id>`. Given an org, workspace-prefixed; given
 * manifests (a test, a caller that already read them), bare.
 * @param scope - The org id, or the manifests to read the pages from.
 * @param ref - The record's type and id.
 */
export async function recordHref(scope: string | readonly PageManifest[], ref: RecordLinkRef): Promise<string> {
  const links = typeof scope === 'string' ? await recordLinksForOrg(scope) : recordLinksOf(scope);
  return recordHrefFrom(links, ref);
}
