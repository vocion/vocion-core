/**
 * Which connector a source row belongs to. A source added in the UI is
 * stored as `kind: 'plugin'` with the connector in `config._connector`
 * (`addSource`, SourceSyncService.ts); one applied from workspace YAML
 * carries the connector as its `kind`. Reading only `kind` reported every
 * UI-added source as "not connected" (#1080).
 * @param source - The source row as `listSources` returns it.
 * @param source.slug
 * @param source.kind
 * @param source.config
 * @returns The connector slug, e.g. "github".
 */
export function connectorOfSource(source: { slug: string; kind: string | null; config: Record<string, unknown> }): string {
  const stored = source.config._connector;
  if (typeof stored === 'string' && stored.length > 0) {
    return stored;
  }
  if (source.kind && source.kind !== 'plugin') {
    return source.kind;
  }
  return source.slug;
}
