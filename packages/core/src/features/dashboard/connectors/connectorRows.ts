/**
 * The connectors page as a pure model: one row per connector, connected or
 * not, with what a connected row is doing right now. Computed away from
 * React so the states — connected, not connected, syncing, errored with the
 * scopes it is missing — are unit-tested on fixtures.
 *
 * Chris, 2026-09-18, with Claude's connector list beside it: "make it
 * simpler — a flat list, icon, name, one line, plus to add. We're still
 * responsible for what's connected, history, size, progress. Connected ones
 * maybe explorable." So: every connector is a row; a connected row carries
 * its summary inline and opens in place to the rest.
 */

export type SyncStatus = 'running' | 'completed' | 'failed' | 'superseded' | 'abandoned';

export type SourceSync = {
  status: SyncStatus;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  counts: Record<string, number>;
};

/** One configured connector row as `/rpc/sources` returns it. */
export type Source = {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, unknown>;
  lastSyncedAt: string | null;
  enabled: string;
  createdAt: string;
  authKind: 'none' | 'apikey' | 'oauth';
  objectType: string | null;
  documentCount: number;
  /** Chunks in retrieval — absent on cores older than 2026-09-18. */
  chunkCount?: number;
  credentialConnected: boolean;
  credentialUpdatedAt: string | null;
  /**
   * Why the credential this connector points at cannot be used, or null when
   * it can. Distinct from `credentialConnected: false`, which means nobody has
   * connected the source yet — one needs a key, the other needs the key it
   * already names put back in service.
   */
  credentialBroken: 'revoked' | 'expired' | 'missing' | null;
  /** True when this connector ingests nothing, so its row shows Test connection rather than Sync now. */
  syncless: boolean;
  /** True when the connector can look at the service and report what the credential opens. */
  inspectable: boolean;
  /** What a test costs, said before the button is pressed, or null when it costs nothing. */
  inspectNote: string | null;
  /** The latest sync run for this source, whoever started it. Null if never synced. */
  sync: SourceSync | null;
};

/** One connector the server offers, connected or not. */
export type ConnectorTile = {
  slug: string;
  name: string;
  description: string;
  icon: string;
  authKind: 'none' | 'apikey' | 'oauth';
  /**
   * The stored-credential platform this connector authenticates with, or null
   * when it uses an OAuth grant or needs no credential at all.
   */
  credentialPlatform: string | null;
  syncless: boolean;
  inspectable: boolean;
  /** Scopes the third party must grant, when the connector declares them. */
  requiredScopes?: string[] | null;
};

export type ConnectorState = 'not-connected' | 'connected' | 'syncing' | 'attention';

export type ConnectorRow = {
  tile: ConnectorTile;
  /** The configured rows for this connector — several for a multi-instance connector like web. */
  sources: Source[];
  state: ConnectorState;
  /** Why the row needs attention, one line, or null. */
  attention: string | null;
  /** Scopes the last error named as missing (Zoom code 4711 and friends). */
  missingScopes: string[];
  documents: number;
  chunks: number;
  lastSyncedAt: string | null;
};

/**
 * Which connector a configured source belongs to.
 *
 * Sources are all stored with kind `plugin`; the connector is in the config as
 * `_connector`, falling back to the kind, then the slug, for rows written
 * before that key.
 * @param source - The configured source row.
 */
export function connectorSlugFor(source: Pick<Source, 'config' | 'kind' | 'slug'>): string {
  return (source.config?._connector as string | undefined) ?? source.kind ?? source.slug;
}

/**
 * The scopes a third party's error says the token lacks. Zoom's shape is
 * `does not contain scopes:[a, b]`; anything that lists ids after `scopes:`
 * in brackets is read the same way.
 * @param error - The last run's error text, or null.
 */
export function parseMissingScopes(error: string | null | undefined): string[] {
  if (!error) {
    return [];
  }
  const m = /scopes?\s*(?::\s*)?\[([^\]]+)\]/i.exec(error);
  if (!m) {
    return [];
  }
  return m[1]!.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Why a connected row needs a person, or null when it does not.
 * @param sources - The connector's configured rows.
 */
export function attentionFor(sources: Source[]): string | null {
  for (const s of sources) {
    if (s.credentialBroken === 'revoked') {
      return 'Credential revoked — reconnect to store a fresh one.';
    }
    if (s.credentialBroken === 'expired') {
      return 'Credential expired — reconnect to store a fresh one.';
    }
    if (s.authKind !== 'none' && !s.credentialConnected) {
      return 'Needs credentials — nothing has been connected yet.';
    }
  }
  for (const s of sources) {
    if (s.sync?.status === 'failed') {
      const scopes = parseMissingScopes(s.sync.error);
      return scopes.length > 0
        ? `Last sync failed: the token is missing ${scopes.length} scope${scopes.length === 1 ? '' : 's'}.`
        : `Last sync failed: ${s.sync.error ?? 'no reason was recorded'}`;
    }
    if (s.sync?.status === 'abandoned') {
      return 'A sync never finished — its process stopped. Sync now takes over.';
    }
    if ((s.sync?.counts.errors ?? 0) > 0) {
      return `Last sync could not save ${s.sync!.counts.errors} document${s.sync!.counts.errors === 1 ? '' : 's'}.`;
    }
  }
  return null;
}

/**
 * Every connector as a row, connected ones first (A–Z), then the rest (A–Z).
 * A configured source whose connector is no longer registered still shows,
 * under a tile made from what the row knows, rather than vanishing.
 * @param tiles - The connectors the server offers.
 * @param sources - The org's configured rows.
 */
export function buildConnectorRows(tiles: ConnectorTile[], sources: Source[]): ConnectorRow[] {
  const bySlug = new Map<string, Source[]>();
  for (const s of sources) {
    const slug = connectorSlugFor(s);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), s]);
  }
  const knownSlugs = new Set(tiles.map(t => t.slug));
  const orphanTiles: ConnectorTile[] = [...bySlug.keys()].filter(slug => !knownSlugs.has(slug)).map(slug => ({
    slug,
    name: slug,
    description: 'A connector this build no longer registers; its rows and documents are still here.',
    icon: 'Plug',
    authKind: 'none',
    credentialPlatform: null,
    syncless: false,
    inspectable: false,
  }));
  const rows = [...tiles, ...orphanTiles].map((tile): ConnectorRow => {
    const own = bySlug.get(tile.slug) ?? [];
    const syncing = own.some(s => s.sync?.status === 'running');
    const attention = attentionFor(own);
    const missingScopes = [...new Set(own.flatMap(s => (s.sync?.status === 'failed' ? parseMissingScopes(s.sync.error) : [])))];
    const last = own.map(s => s.lastSyncedAt).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
    return {
      tile,
      sources: own,
      state: own.length === 0 ? 'not-connected' : syncing ? 'syncing' : attention ? 'attention' : 'connected',
      attention,
      missingScopes,
      documents: own.reduce((n, s) => n + s.documentCount, 0),
      chunks: own.reduce((n, s) => n + (s.chunkCount ?? 0), 0),
      lastSyncedAt: last,
    };
  });
  const byName = (a: ConnectorRow, b: ConnectorRow) => a.tile.name.localeCompare(b.tile.name);
  return [
    ...rows.filter(r => r.state !== 'not-connected').sort(byName),
    ...rows.filter(r => r.state === 'not-connected').sort(byName),
  ];
}

/**
 * Rows whose name, slug or description contains every word in the query.
 * Word-at-a-time so "google ads" finds Google Ads whichever order the words
 * are typed. An empty query keeps everything, in the order given.
 * @param rows
 * @param query
 */
export function filterConnectorRows(rows: ConnectorRow[], query: string): ConnectorRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return rows;
  }
  return rows.filter((r) => {
    const hay = `${r.tile.name} ${r.tile.slug} ${r.tile.description}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/**
 * One line saying what a configured row points at — the crawl URL, the URL
 * count — for the row's subline.
 * @param config - The row's config blob.
 */
export function describeSourceConfig(config: Record<string, unknown>): string {
  const c = config as { urls?: string[]; crawl?: { startUrl?: string; maxPages?: number } };
  if (c.crawl?.startUrl) {
    return `Crawl ${c.crawl.startUrl} · up to ${c.crawl.maxPages ?? 50} pages`;
  }
  if (c.urls?.length) {
    return c.urls.length === 1 ? c.urls[0]! : `${c.urls.length} URLs`;
  }
  return 'Configured connector';
}

/**
 * "2h ago" — coarse on purpose; the exact instant is on the detail page.
 * @param date
 * @param now - Injectable for tests.
 */
export function formatRelative(date: Date, now: number = Date.now()): string {
  const diff = now - date.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) {
    return 'just now';
  }
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
