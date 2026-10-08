import { connectorOfSource } from './connectorOf';
import { getConnector } from './registry';

/**
 * A lookup from a source's slug to the brand of the connector behind it
 * (`libs/brands/catalog.ts`), for a list that names sources by slug — an
 * agent's integrations, the workspace's connectors. A slug with no source row
 * yet is read as a connector slug, which is what an agent naming a source
 * before it is added usually means. Null when the connector is not one vendor.
 * @param sources - The workspace's source rows, as `listSources` returns them.
 */
export function sourceBrandLookup(sources: ReadonlyArray<{ slug: string; kind: string | null; config: Record<string, unknown> }>): (slug: string) => string | null {
  const connectorBySlug = new Map(sources.map(source => [source.slug, connectorOfSource(source)]));
  return slug => getConnector(connectorBySlug.get(slug) ?? slug)?.brand ?? null;
}
