/**
 * CONFLUENCE — the first docs provider (`../provider.ts`), on the auth and
 * client the `confluence` source syncs with (`libs/sources/confluence.ts`).
 *
 * Search is CQL `text ~` inside the configured spaces; a page read by id or
 * URL is refused when it sits in a space the source does not list, so a read
 * never reaches past what the workspace connected. A login refreshed here is
 * saved to the source's credential, as a sync would.
 */

import type { DocsPage, DocsPageRow, DocsProvider } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import type { ConfluencePage } from '@/libs/sources/confluence';
import { orThrow } from '@/libs/connectors/vendorRequest';
import { confluenceApi, confluencePageText, confluencePageUrl, confluenceSearch, cqlQuote, resolveConfluenceAuth } from '@/libs/sources/confluence';
import { credentialsForSource } from '@/services/connectors/sourceCredentials';

/**
 * The page id a URL or id names: `…/pages/123456/Title`, `?pageId=123456`, or the id itself.
 * @param idOrUrl - What the agent passed.
 */
export function confluencePageId(idOrUrl: string): string | null {
  const s = idOrUrl.trim();
  if (/^\d+$/.test(s)) {
    return s;
  }
  return /\/pages\/(\d+)/.exec(s)?.[1] ?? /[?&]pageId=(\d+)/.exec(s)?.[1] ?? null;
}

/**
 * The Confluence provider for one docs source.
 * @param orgId - The workspace.
 * @param source - The `confluence` source row (site, space keys, credential).
 */
export async function confluenceDocsProvider(orgId: string, source: FamilySource): Promise<DocsProvider> {
  const baseUrl = typeof source.config.baseUrl === 'string' ? source.config.baseUrl : '';
  if (!baseUrl) {
    throw new Error(`The ${source.slug} source names no Confluence site (baseUrl).`);
  }
  const spaceKeys = Array.isArray(source.config.spaceKeys) ? (source.config.spaceKeys as unknown[]).map(k => String(k).trim()).filter(Boolean) : [];
  const auth = await resolveConfluenceAuth({
    baseUrl,
    credentials: await credentialsForSource(orgId, source),
    persistence: { kind: 'persist', orgId, sourceId: source.id, warn: message => console.warn('[docs/confluence]', message) },
  });
  const row = (p: ConfluencePage): DocsPageRow => ({ id: p.id, title: p.title, space: p.space?.key ?? null, url: confluencePageUrl(auth, p), updated: p.version?.when ?? null, updatedBy: p.version?.by?.displayName ?? null });

  return {
    kind: 'confluence',
    label: 'Confluence',
    sourceSlug: source.slug,
    spaceKeys,

    async searchPages(query, limit) {
      if (spaceKeys.length === 0) {
        throw new Error(`The ${source.slug} source lists no space keys, so there is nothing to search.`);
      }
      const spaces = `space in (${spaceKeys.map(cqlQuote).join(', ')}) and type = page`;
      const cql = query.trim() ? `${spaces} and text ~ ${cqlQuote(query.trim())} order by lastmodified desc` : `${spaces} order by lastmodified desc`;
      const page = orThrow(await confluenceSearch(auth, cql, { limit: Math.min(limit, 50), expand: 'space,version' }));
      return (page.results ?? []).slice(0, limit).map(row);
    },

    async readPage(idOrUrl) {
      const id = confluencePageId(idOrUrl);
      if (!id) {
        throw new Error(`${idOrUrl} is not a Confluence page id or page URL.`);
      }
      const page = orThrow(await confluenceApi<ConfluencePage>(auth, `/content/${encodeURIComponent(id)}?expand=body.storage,version,space,ancestors`));
      const space = page.space?.key ?? null;
      if (spaceKeys.length > 0 && (!space || !spaceKeys.some(k => k.toUpperCase() === space.toUpperCase()))) {
        throw new Error(`Page ${id} is in space ${space ?? 'unknown'}, which the ${source.slug} source is not configured for (${spaceKeys.join(', ')}). A space is added on the source, not here.`);
      }
      const out: DocsPage = { ...row(page), version: page.version?.number ?? null, ancestors: (page.ancestors ?? []).map(a => a.title ?? '').filter(Boolean), text: confluencePageText(page) };
      return out;
    },
  };
}
