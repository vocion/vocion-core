/**
 * THE DOCS FAMILY — a documentation site, named for its constructs.
 *
 * A team's written knowledge lives as pages in spaces (Confluence first; a
 * GitBook or a SharePoint site would be the next provider). The knowledge
 * index holds each page as of the last sync; an agent quoting a runbook or a
 * policy reads the page as it stands now with `docs_read_page`, and finds one
 * with `docs_search`. Reads only: nothing an agent does edits a page.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { FAMILY_LABEL, familySourcesForOrg } from '@/libs/connectors/families';
import { pickFamilySource } from '@/services/connectors/sourceCredentials';

export type DocsPageRow = { id: string; title: string; space: string | null; url: string; updated: string | null; updatedBy: string | null };

export type DocsPage = DocsPageRow & {
  version: number | null;
  /** The pages above it, root first. */
  ancestors: string[];
  text: string;
};

export type DocsProvider = {
  kind: string;
  label: string;
  sourceSlug: string;
  /** The spaces the source is configured for; reads never leave them. */
  spaceKeys: string[];
  /** Pages whose text matches, newest first, inside the configured spaces. */
  searchPages: (query: string, limit: number) => Promise<DocsPageRow[]>;
  /** One page, by id or by its URL. */
  readPage: (idOrUrl: string) => Promise<DocsPage>;
};

/**
 * The provider for the workspace's docs site: the named source, else its one
 * docs source.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source slug, when the workspace has more than one.
 * @param opts.slugs - Only these sources: an agent's own.
 */
export async function docsProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<DocsProvider> {
  const source = pickFamilySource(await familySourcesForOrg(orgId, 'docs', opts.slugs), FAMILY_LABEL.docs, opts.sourceSlug);
  return providerFor(orgId, source);
}

async function providerFor(orgId: string, source: FamilySource): Promise<DocsProvider> {
  if (source.kind === 'confluence') {
    const { confluenceDocsProvider } = await import('./providers/confluence');
    return confluenceDocsProvider(orgId, source);
  }
  throw new Error(`${source.slug} is a ${source.kind} source, which no docs provider serves yet.`);
}
