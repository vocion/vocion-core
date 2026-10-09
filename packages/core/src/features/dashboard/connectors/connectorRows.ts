import type { GrantSummary } from '@/libs/connect/provider';
import type { ConnectorCategory } from '@/libs/sources/types';
/**
 * The Connectors page as a pure model, computed away from React so every
 * state is unit-tested on fixtures.
 *
 * Founder, 2026-10-09: "simplify the connections page — clear, concise,
 * simple, easy to use." So the page is three short parts:
 *
 * - **Connected** — one row per connection: its status in words (Working,
 *   Needs attention with a plain reason, Paused) and at most one fix on the
 *   row. Rows that need a person sort first.
 * - **Recommended** — at most three, each with one reason (server-side,
 *   `services/connect/connectionsOverview.ts`).
 * - **All connectors** — the catalog, searchable and filed by category.
 *
 * Earlier (2026-09-18): "We're still responsible for what's connected,
 * history, size, progress." That detail is still here, one move away, in a
 * connection's Manage panel and its Details.
 */

export type SyncStatus = 'running' | 'completed' | 'failed' | 'superseded' | 'abandoned';

export type SourceSync = {
  status: SyncStatus;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  counts: Record<string, number>;
  /**
   * What the run read and did not keep, by rule, with the reason — a sample;
   * `counts.skipped` is the total. Absent on cores older than 2026-10-01.
   */
  skipped?: Array<{ uri?: string; message: string; at: string }>;
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
   * The account the stored grant is on and what it granted, by name — set for
   * a row a vendor flow connected (GitHub App installation, Slack workspace,
   * Atlassian site); null for a pasted token. Absent on cores older than
   * 2026-10-01.
   */
  grant?: GrantSummary | null;
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
  /**
   * The vendor's brand (`libs/brands/catalog.ts`), drawn as the tile's logo.
   * Null for a connector that is not one vendor; absent on cores older than
   * 2026-10-08.
   */
  brand?: string | null;
  /** The catalog shelf it is filed on; absent on cores older than 2026-10-09. */
  category?: ConnectorCategory;
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
 * Whether a row with a working credential offers Reconnect beside its other
 * actions: when its last sync failed, and always on a connector that never
 * syncs. A refused login says "An admin needs to log in with HubSpot again
 * on the Connectors page", and Edit never runs a login again, so without
 * this the row would name a fix it has no button for. It shows for any
 * failed sync, since the row cannot tell a dead credential from a vendor
 * outage, and connecting again over a good credential loses nothing. A
 * connector that never syncs (Apollo) records no failed run at all; Test
 * connection is where it finds a dead login, so Reconnect has to be there
 * already. A revoked or expired credential counts as not connected, so its
 * row already shows Connect.
 * @param source - The configured row.
 */
export function offersReconnect(source: Source): boolean {
  if (source.authKind === 'none' || !source.credentialConnected) {
    return false;
  }
  return source.syncless || source.sync?.status === 'failed';
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

/** A connection's status, in the three words the page uses. */
export type ConnectionStatus = 'working' | 'attention' | 'paused';

/**
 * Why a connection needs a person, as a key the page words plainly
 * ("Needs attention: sign-in expired"). The vendor's own error text stays in
 * the connection's Details.
 */
export type ConnectionProblem
  = | 'revoked'
    | 'expired'
    | 'not-connected'
    | 'missing-permissions'
    | 'sync-failed'
    | 'sync-stopped'
    | 'items-not-saved';

/** The one fix a row offers, or null when it needs none. */
export type ConnectionFix = 'reconnect' | 'connect' | 'retry' | null;

/** One connection on the page. */
export type ConnectionRow = {
  source: Source;
  tile: ConnectorTile;
  status: ConnectionStatus;
  problem: ConnectionProblem | null;
  fix: ConnectionFix;
  /** A sync is running now, whoever started it. */
  syncing: boolean;
  /** Scopes the last error named as missing (Zoom code 4711 and friends). */
  missingScopes: string[];
};

/**
 * What is wrong with one connection, the most fundamental thing first: a
 * credential that cannot be used comes before a sync that failed on it.
 * @param source - The configured row.
 */
export function problemOf(source: Source): ConnectionProblem | null {
  if (source.credentialBroken === 'revoked') {
    return 'revoked';
  }
  if (source.credentialBroken === 'expired') {
    return 'expired';
  }
  if (source.authKind !== 'none' && !source.credentialConnected) {
    return 'not-connected';
  }
  const sync = source.sync;
  if (sync?.status === 'failed') {
    return parseMissingScopes(sync.error).length > 0 ? 'missing-permissions' : 'sync-failed';
  }
  if (sync?.status === 'abandoned') {
    return 'sync-stopped';
  }
  if (sync?.status === 'completed' && (sync.counts.errors ?? 0) > 0) {
    return 'items-not-saved';
  }
  return null;
}

/**
 * The one fix a problem gets on the row: sign in again where the credential
 * is the problem (or may be — a failed sync on a stored login), Connect where
 * nothing was ever stored, and otherwise run it again.
 * @param source - The configured row.
 * @param problem - What is wrong with it.
 */
export function fixFor(source: Source, problem: ConnectionProblem | null): ConnectionFix {
  switch (problem) {
    case null:
      return null;
    case 'revoked':
    case 'expired':
    case 'missing-permissions':
      return 'reconnect';
    case 'not-connected':
      return 'connect';
    case 'sync-failed':
      return offersReconnect(source) ? 'reconnect' : 'retry';
    default:
      return 'retry';
  }
}

/**
 * A tile made from what a source row knows, for a connector this build no longer registers.
 * @param slug
 */
function orphanTile(slug: string): ConnectorTile {
  return { slug, name: slug, description: '', icon: 'Plug', authKind: 'none', credentialPlatform: null, syncless: false, inspectable: false };
}

/**
 * One row per configured connection: the ones that need a person first, then
 * the rest, each part A–Z by connector name. A source whose connector is no
 * longer registered still shows, rather than hiding its documents.
 * @param tiles - The connectors the server offers.
 * @param sources - The workspace's configured rows.
 */
export function buildConnections(tiles: ConnectorTile[], sources: Source[]): ConnectionRow[] {
  const bySlug = new Map(tiles.map(t => [t.slug, t]));
  const rows = sources.map((source): ConnectionRow => {
    const tile = bySlug.get(connectorSlugFor(source)) ?? orphanTile(connectorSlugFor(source));
    const paused = source.enabled === 'false';
    const problem = paused ? null : problemOf(source);
    return {
      source,
      tile,
      status: paused ? 'paused' : problem ? 'attention' : 'working',
      problem,
      fix: paused ? null : fixFor(source, problem),
      syncing: source.sync?.status === 'running',
      missingScopes: source.sync?.status === 'failed' ? parseMissingScopes(source.sync.error) : [],
    };
  });
  const rank = (r: ConnectionRow) => (r.status === 'attention' ? 0 : r.status === 'working' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || a.tile.name.localeCompare(b.tile.name) || a.source.slug.localeCompare(b.source.slug));
}

/**
 * What tells two connections of one connector apart on their rows — the site
 * a crawl reads, the repositories — or null when the connector has only one.
 * @param row - The connection.
 * @param rows - Every connection on the page.
 */
export function instanceLabel(row: ConnectionRow, rows: ConnectionRow[]): string | null {
  const siblings = rows.filter(r => r.tile.slug === row.tile.slug);
  if (siblings.length < 2) {
    return null;
  }
  const described = describeSourceConfig(row.source.config);
  return described === 'Configured connector' ? row.source.slug : described;
}

/** One connector in the catalog. */
export type CatalogEntry = {
  tile: ConnectorTile;
  /** The workspace already has at least one connection to it. */
  connected: boolean;
  /** This server cannot connect it (a login with no app configured, and nothing to paste). */
  unavailable: boolean;
};

/**
 * The catalog: every connector A–Z, marked connected or unavailable. Only an
 * admin sees an unavailable one, so they know why it cannot be added; anyone
 * else never sees a door that will not open.
 * @param tiles - The connectors the server offers.
 * @param sources - The workspace's configured rows.
 * @param opts - What the server said.
 * @param opts.unavailable - Connector slugs this server cannot connect.
 * @param opts.isAdmin - Whether the viewer is an admin.
 */
export function catalogEntries(tiles: ConnectorTile[], sources: Source[], opts: { unavailable: string[]; isAdmin: boolean }): CatalogEntry[] {
  const connected = new Set(sources.map(connectorSlugFor));
  const unavailable = new Set(opts.unavailable);
  return tiles
    .map(tile => ({ tile, connected: connected.has(tile.slug), unavailable: unavailable.has(tile.slug) }))
    .filter(entry => opts.isAdmin || !entry.unavailable)
    .sort((a, b) => a.tile.name.localeCompare(b.tile.name));
}

/**
 * Catalog entries whose name, slug or description contains every word typed,
 * in any order, within one category when one is chosen.
 * @param entries - The catalog.
 * @param query - What was typed.
 * @param category - The chosen shelf, or null for all.
 */
export function filterCatalog(entries: CatalogEntry[], query: string, category: ConnectorCategory | null): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (category && (e.tile.category ?? 'other') !== category) {
      return false;
    }
    const hay = `${e.tile.name} ${e.tile.slug} ${e.tile.description}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/**
 * The categories that hold at least one entry, in the page's order.
 * @param entries - The catalog.
 * @param order - Every category, in display order.
 */
export function categoriesIn(entries: CatalogEntry[], order: readonly ConnectorCategory[]): ConnectorCategory[] {
  const present = new Set(entries.map(e => e.tile.category ?? 'other'));
  return order.filter(c => present.has(c));
}

/**
 * "2 hours ago", in the page's language. Coarse on purpose; the exact time is
 * in Details.
 * @param iso - When.
 * @param locale - The page's locale.
 * @param now - Now.
 */
export function relativeTime(iso: string, locale: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) {
    return fmt.format(0, 'second');
  }
  if (abs < 3600) {
    return fmt.format(Math.round(seconds / 60), 'minute');
  }
  if (abs < 86_400) {
    return fmt.format(Math.round(seconds / 3600), 'hour');
  }
  return fmt.format(Math.round(seconds / 86_400), 'day');
}
