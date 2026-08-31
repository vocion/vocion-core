/**
 * Strapi connector — ingest entries from one or more Strapi headless CMS
 * collections as retrievable documents. Built for the Veerio event-ingestion
 * work (VEERIO-235), where partner organisations publish their event listings
 * from their own Strapi instance rather than a purpose-built feed.
 *
 * Auth: a Strapi API token in `ctx.credentials.token`, sent as a Bearer header.
 * Read-only tokens are enough — this connector never writes upstream.
 *
 * Multiple collections, one source: `ensureSource` keys a knowledge_source row
 * on (orgId, connector slug), so an org gets exactly one `strapi` row and a
 * second Strapi source would resolve back to the first. Collections therefore
 * live in this connector's own config rather than in separate sources. They
 * share one instance, one API token and one vault entry, and `externalId` is
 * namespaced `<collection>:<id>` so entries from different collections cannot
 * collide.
 *
 * One failing collection does not sink the rest. A collection that throws is
 * reported through `ctx.onProgress({ kind: 'error' })` and the sync moves on to
 * the next one. That is a deliberate departure from the "throw aborts the whole
 * sync" contract in `types.ts`: a partner instance where one collection is
 * misconfigured should still deliver the collections that work. The reported
 * error is what SourceSyncService counts, logs and persists for the UI — and it
 * also suppresses tombstoning for the whole run, which is the behaviour we
 * want, since a collection we could not read is not a collection whose
 * documents we can safely call deleted.
 *
 * Incremental: when `ctx.since` is set, only entries with `updatedAt > since`
 * are fetched (`filters[updatedAt][$gt]`). Results are always sorted by
 * `updatedAt` ascending so page boundaries stay stable while a sync walks them.
 *
 * Response shapes: Strapi v4 nests fields under `{ id, attributes: { ... } }`
 * while Strapi v5 returns them flattened alongside a `documentId`. Both are
 * normalized here into one flat record, so a source works against either
 * version without the user telling us which one they run.
 *
 * Chunking, embedding and dedup are handled downstream by IngestionService.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const DEFAULT_PAGE_SIZE = 100;

/** Fields Strapi manages itself — surfaced as document metadata, not body text. */
const HOUSEKEEPING_FIELDS = new Set([
  'id',
  'documentId',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'locale',
  'createdBy',
  'updatedBy',
]);

/** Field names checked, in order, when picking a human title for an entry. */
const TITLE_FIELD_CANDIDATES = ['title', 'name', 'heading', 'label', 'slug'];

const strapiConfigSchema = z.object({
  /** Root of the Strapi instance, e.g. `https://cms.partner.org`. */
  baseUrl: z.string().url(),
  /** Plural API ids of the collections to sync, e.g. `["events", "venues"]`. */
  collections: z.array(z.string().min(1)).min(1),
  /**
   * Relations and media to expand. Strapi returns relations as bare ids unless
   * asked to populate them; `*` pulls every first-level relation.
   */
  populate: z.string().default('*'),
  /** Entries requested per page. Strapi caps this at 100 by default. */
  pageSize: z.number().int().positive().max(100).default(DEFAULT_PAGE_SIZE),
});

type StrapiConfig = z.infer<typeof strapiConfigSchema>;

/** One entry as Strapi sends it — v4 nested or v5 flat. */
type StrapiEntry = {
  id?: number | string;
  documentId?: string;
  attributes?: Record<string, unknown>;
  [field: string]: unknown;
};

type StrapiPage = {
  data?: StrapiEntry[];
  meta?: { pagination?: { page?: number; pageCount?: number; total?: number } };
};

/** A single block in Strapi's rich-text ("blocks") field format. */
type RichTextBlock = { children?: { text?: string }[] };

/** Where a resumed run should pick back up. */
type ResumePosition = { collectionIndex: number; page: number };

/**
 * Collapse a v4 (`{ id, attributes }`) or v5 (flat) entry into one flat record
 * of field name to value, with the identifiers kept alongside.
 * @param entry - One raw entry object straight from the Strapi response.
 */
function normalizeEntry(entry: StrapiEntry): { id: string; fields: Record<string, unknown> } {
  const nestedAttributes = entry.attributes;
  const fields: Record<string, unknown> = nestedAttributes
    ? { ...nestedAttributes }
    : { ...entry };

  // `documentId` is the stable identifier in v5; v4 only has the numeric `id`.
  const identifier = entry.documentId ?? entry.id;
  return { id: identifier == null ? '' : String(identifier), fields };
}

/**
 * Render one Strapi field value as plain text. Scalars pass through, rich-text
 * blocks are flattened to their text runs, and relations or media objects are
 * reduced to whatever human-readable label they carry.
 * @param value - A single field value — scalar, array, rich-text block, relation or media object.
 */
function renderFieldValue(value: unknown): string {
  if (value == null || value === '') {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const renderedItems = value.map(renderFieldValue).filter(text => text !== '');
    return renderedItems.join(', ');
  }
  const objectValue = value as Record<string, unknown>;

  // Rich-text blocks arrive as `{ children: [{ text }] }` and are handled by the
  // array branch above; a lone block still needs flattening here.
  const blockChildren = (objectValue as RichTextBlock).children;
  if (Array.isArray(blockChildren)) {
    return blockChildren.map(child => child?.text ?? '').join('');
  }

  // Relations and media: keep the label a reader would recognise, drop the rest.
  for (const candidate of TITLE_FIELD_CANDIDATES) {
    const label = objectValue[candidate];
    if (typeof label === 'string' && label !== '') {
      return label;
    }
  }
  return '';
}

/**
 * Pick the most human-readable title available on an entry.
 * @param collection - Plural API id of the collection, used for the fallback title.
 * @param fields - The entry's flattened field map.
 * @param id - The entry's identifier, used for the fallback title.
 */
function titleFor(collection: string, fields: Record<string, unknown>, id: string): string {
  for (const candidate of TITLE_FIELD_CANDIDATES) {
    const value = fields[candidate];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return `${collection} ${id}`;
}

/**
 * Serialize the entry's content fields as `field: value` lines.
 * @param fields - The entry's flattened field map.
 */
function contentFor(fields: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [fieldName, value] of Object.entries(fields)) {
    if (HOUSEKEEPING_FIELDS.has(fieldName)) {
      continue;
    }
    const rendered = renderFieldValue(value);
    if (rendered !== '') {
      lines.push(`${fieldName}: ${rendered}`);
    }
  }
  return lines.join('\n');
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Build one entry's IngestDoc.
 * @param config - The parsed connector config for this source.
 * @param collection - Plural API id of the collection the entry came from.
 * @param entry - One raw entry object straight from the Strapi response.
 */
function toDoc(config: StrapiConfig, collection: string, entry: StrapiEntry): IngestDoc {
  const { id, fields } = normalizeEntry(entry);
  const updatedAt = fields.updatedAt;
  const content = contentFor(fields);
  return {
    externalId: `${collection}:${id}`,
    title: titleFor(collection, fields, id),
    content: content || `${collection} ${id}`,
    uri: `${trimTrailingSlash(config.baseUrl)}/api/${collection}/${id}`,
    lastModifiedAt: typeof updatedAt === 'string' ? new Date(updatedAt) : null,
    metadata: {
      collection,
      strapiId: id,
      ...(typeof fields.locale === 'string' ? { locale: fields.locale } : {}),
    },
  };
}

/**
 * Build the query string for one page of a collection request.
 * @param config - The parsed connector config for this source.
 * @param page - 1-based page number to request.
 * @param since - Incremental watermark — when set, only entries updated after it are fetched.
 */
function buildPageQuery(config: StrapiConfig, page: number, since?: Date | null): string {
  const params = new URLSearchParams();
  params.set('pagination[page]', String(page));
  params.set('pagination[pageSize]', String(config.pageSize));
  params.set('sort[0]', 'updatedAt:asc');
  if (config.populate !== '') {
    params.set('populate', config.populate);
  }
  if (since) {
    params.set('filters[updatedAt][$gt]', since.toISOString());
  }
  return params.toString();
}

/**
 * Decode the `<collectionIndex>:<page>` resume position a prior run left behind.
 * Anything unparseable, out of range, or below the first page starts from the
 * beginning rather than silently skipping collections.
 * @param cursor - The opaque cursor string from the prior run's checkpoint.
 * @param collectionCount - How many collections this source is configured with.
 */
function parseCursor(cursor: string | null | undefined, collectionCount: number): ResumePosition {
  const start: ResumePosition = { collectionIndex: 0, page: 1 };
  if (!cursor) {
    return start;
  }
  const [rawIndex, rawPage] = cursor.split(':');
  const collectionIndex = Number.parseInt(rawIndex ?? '', 10);
  const page = Number.parseInt(rawPage ?? '', 10);
  if (Number.isNaN(collectionIndex) || collectionIndex < 0 || collectionIndex >= collectionCount) {
    return start;
  }
  if (Number.isNaN(page) || page < 1) {
    return { collectionIndex, page: 1 };
  }
  return { collectionIndex, page };
}

/**
 * Walk one collection page by page, yielding a document per entry.
 *
 * Throws on the first failed request. The caller decides whether that ends the
 * whole sync or just this collection.
 * @param config - The parsed connector config for this source.
 * @param collection - Plural API id of the collection to walk.
 * @param headers - Request headers carrying the bearer token.
 * @param since - Incremental watermark, or null for a full walk.
 * @param startPage - 1-based page to begin at.
 * @param onProgress - Progress callback from the SourceContext, when the caller supplied one.
 * @yields One IngestDoc per entry in the collection.
 */
async function* syncOneCollection(
  config: StrapiConfig,
  collection: string,
  headers: Record<string, string>,
  since: Date | null | undefined,
  startPage: number,
  onProgress: SourceContext['onProgress'],
): AsyncIterable<IngestDoc> {
  const collectionUrl = `${trimTrailingSlash(config.baseUrl)}/api/${collection}`;
  let page = startPage;
  let pageCount = startPage;

  do {
    const query = buildPageQuery(config, page, since);
    const response = await fetch(`${collectionUrl}?${query}`, { headers });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Strapi ${collection} fetch failed: ${response.status} ${errorBody}`);
    }
    const body = (await response.json()) as StrapiPage;
    for (const entry of body.data ?? []) {
      const doc = toDoc(config, collection, entry);
      onProgress?.({ kind: 'fetched', uri: doc.uri });
      yield doc;
    }
    // A missing pageCount means the instance returned an unpaginated payload;
    // treat what we got as the only page rather than looping forever.
    pageCount = body.meta?.pagination?.pageCount ?? page;
    page += 1;
  } while (page <= pageCount);
}

export const strapiConnector: SourceConnector<typeof strapiConfigSchema> = {
  slug: 'strapi',
  name: 'Strapi',
  description: 'Ingest entries from one or more Strapi CMS collections — incremental by updatedAt.',
  icon: 'Database',
  authKind: 'apikey',
  configSchema: strapiConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const config = strapiConfigSchema.parse(ctx.config);
    const token = (ctx.credentials?.token ?? ctx.credentials?.apiToken) as string | undefined;
    if (!token) {
      throw new Error('Strapi connector requires an API token in credentials.token');
    }
    const headers = { authorization: `Bearer ${token}` };
    const resume = parseCursor(ctx.cursor, config.collections.length);

    for (let index = resume.collectionIndex; index < config.collections.length; index++) {
      const collection = config.collections[index]!;
      // Only the collection we resumed into starts mid-way; the rest start at 1.
      const startPage = index === resume.collectionIndex ? resume.page : 1;
      try {
        yield* syncOneCollection(config, collection, headers, ctx.since, startPage, ctx.onProgress);
      } catch (error) {
        // One bad collection must not cost us the others. Reporting rather than
        // throwing also tells SourceSyncService to skip tombstoning this run,
        // since documents we failed to read are not documents we know are gone.
        ctx.onProgress?.({
          kind: 'error',
          uri: `${trimTrailingSlash(config.baseUrl)}/api/${collection}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },
};

/** What a single collection check found on the instance. */
export type StrapiCollectionCheck = {
  collection: string;
  status: 'ok' | 'not-found' | 'forbidden' | 'unauthorized' | 'error';
  entryCount: number | null;
  message: string | null;
  /**
   * True when the collection answers without any credential. Strapi lets a role
   * make a collection public, and a public collection returns 200 for a stale or
   * mistyped token too — so a read here proves nothing about the token.
   */
  publiclyReadable?: boolean;
};

/** What an inspect pass learned about a Strapi instance. */
export type StrapiInspection = {
  reachable: boolean;
  /** True when the instance answered a content request with the given token. */
  authorized: boolean;
  /** `4`, `5`, or null when no entry was available to tell them apart. */
  detectedVersion: 4 | 5 | null;
  /**
   * Collections read off the instance, when it let us enumerate them. Null means
   * enumeration is not available — see `enumerationNote` for why — and the
   * caller should fall back to asking for names and checking them.
   */
  collections: string[] | null;
  enumerationNote: string | null;
  /** Per-collection results for whatever names the caller asked about. */
  checks: StrapiCollectionCheck[];
  /** Set when the instance could not be reached or answered at all. */
  error: string | null;
};

/**
 * Ask a Strapi instance what collections it exposes.
 *
 * Strapi keeps the content-type list on an ADMIN route: an API token is a
 * content-API credential, so `/api/content-type-builder/content-types` answers
 * 403 for most instances and there is no token-visible catalogue to replace it.
 * We try it anyway — some deployments do expose it, and when they do the
 * operator gets a pick-list instead of typing plural ids from memory. There is
 * no second-best listing route to fall back on either: checked against
 * api-dev.veerio.app on 2026-08-31, the Documentation plugin's OpenAPI spec
 * (`/documentation/v1.0.0/full_documentation.json`) is a 404 and `/api/content-types`
 * does not exist, so a closed 403 means the operator types the ids.
 * @param baseUrl - Instance root, e.g. `https://cms.partner.org`.
 * @param token - A Strapi API token.
 * @returns The plural api ids, or null with a note when the route is closed.
 */
async function enumerateCollections(
  baseUrl: string,
  token: string,
): Promise<{ collections: string[] | null; note: string | null; tokenRejected?: boolean }> {
  const url = `${trimTrailingSlash(baseUrl)}/api/content-type-builder/content-types`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    return { collections: null, note: error instanceof Error ? error.message : String(error) };
  }
  if (response.status === 401) {
    return {
      collections: null,
      note: 'This instance rejected the token (401). Check it was copied whole and has not been revoked.',
      tokenRejected: true,
    };
  }
  if (!response.ok) {
    return {
      collections: null,
      note: `Nothing wrong with your token — Strapi keeps the list of collections behind its admin API (${response.status}), which no API token can reach whatever its scope. Type the plural ids below instead and each one will be checked against this instance. They are the api ids in Strapi under Content-Type Builder, e.g. \`events\`, \`venues\`.`,
    };
  }

  let body: { data?: { uid?: string; schema?: { kind?: string; pluralName?: string } }[] };
  try {
    body = (await response.json()) as typeof body;
  } catch (error) {
    return { collections: null, note: error instanceof Error ? error.message : String(error) };
  }

  const collections: string[] = [];
  for (const entry of body.data ?? []) {
    const isApiCollection = (entry.uid ?? '').startsWith('api::') && entry.schema?.kind === 'collectionType';
    const pluralName = entry.schema?.pluralName;
    if (isApiCollection && pluralName) {
      collections.push(pluralName);
    }
  }
  collections.sort((left, right) => left.localeCompare(right));
  return { collections, note: null };
}

/**
 * Check one collection: does it exist, does the token reach it, how many entries
 * does it hold, and which response shape does it use.
 * @param baseUrl - Instance root.
 * @param token - A Strapi API token.
 * @param collection - Plural api id to check.
 * @param probePublicAccess - Re-request without the token to tell public from private. Skipped when the catalogue already proved the token.
 */
async function checkOneCollection(
  baseUrl: string,
  token: string,
  collection: string,
  probePublicAccess: boolean,
): Promise<{ check: StrapiCollectionCheck; detectedVersion: 4 | 5 | null }> {
  const url = `${trimTrailingSlash(baseUrl)}/api/${collection}?pagination[pageSize]=1`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  } catch (error) {
    return {
      check: {
        collection,
        status: 'error',
        entryCount: null,
        message: error instanceof Error ? error.message : String(error),
      },
      detectedVersion: null,
    };
  }

  if (response.status === 404) {
    return {
      check: { collection, status: 'not-found', entryCount: null, message: 'No such collection on this instance.' },
      detectedVersion: null,
    };
  }
  if (response.status === 401) {
    return {
      check: {
        collection,
        status: 'unauthorized',
        entryCount: null,
        message: 'The token was rejected — check it was copied whole and has not been revoked.',
      },
      detectedVersion: null,
    };
  }
  if (response.status === 403) {
    return {
      check: {
        collection,
        status: 'forbidden',
        entryCount: null,
        message: 'The token cannot read this collection — give it find + findOne permission.',
      },
      detectedVersion: null,
    };
  }
  if (!response.ok) {
    return {
      check: { collection, status: 'error', entryCount: null, message: `Strapi answered ${response.status}.` },
      detectedVersion: null,
    };
  }

  let body: StrapiPage;
  try {
    body = (await response.json()) as StrapiPage;
  } catch (error) {
    return {
      check: {
        collection,
        status: 'error',
        entryCount: null,
        message: error instanceof Error ? error.message : String(error),
      },
      detectedVersion: null,
    };
  }

  const firstEntry = (body.data ?? [])[0];
  const detectedVersion = firstEntry ? (firstEntry.attributes ? 4 : 5) : null;

  // Ask again with no credential. If that also succeeds the collection is
  // public, so the successful read above says nothing about the token.
  let publiclyReadable = false;
  if (probePublicAccess) {
    try {
      const anonymous = await fetch(url);
      publiclyReadable = anonymous.ok;
    } catch {
      // A failed anonymous probe only means we cannot prove the collection is
      // public; the authenticated read above already succeeded, so carry on.
      publiclyReadable = false;
    }
  }

  return {
    check: {
      collection,
      status: 'ok',
      entryCount: body.meta?.pagination?.total ?? (body.data ?? []).length,
      message: null,
      publiclyReadable,
    },
    detectedVersion,
  };
}

/**
 * How many collection checks run at once. An instance with forty collections
 * would take forty round trips one at a time; a small pool keeps the dialog
 * responsive without hammering a partner's CMS.
 */
const COLLECTION_CHECK_CONCURRENCY = 8;

/**
 * Run `worker` over `items` with at most `limit` in flight, keeping results in
 * the input's order.
 * @param items - Inputs to process.
 * @param limit - Maximum number of workers running at once.
 * @param worker - Called once per item.
 */
async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  limit: number,
  worker: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = Array.from({ length: items.length });
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

/**
 * Look at a Strapi instance with a candidate URL + token, before any source row
 * or credential exists. Powers the Add-source dialog's "Load collections": it
 * confirms the instance is reachable and the token works, lists the collections
 * when the instance allows it, and reports on any names the operator typed.
 *
 * Runs server-side because the browser cannot call a partner's Strapi directly
 * (cross-origin), and because the token should not be handed to another origin.
 * @param input
 * @param input.baseUrl - Instance root as typed by the operator.
 * @param input.token - A Strapi API token.
 * @param input.collections - Names to check; enumeration alone needs none.
 */
export async function inspectStrapiInstance(input: {
  baseUrl: string;
  token: string;
  collections?: string[];
}): Promise<StrapiInspection> {
  const baseUrl = trimTrailingSlash(input.baseUrl.trim());
  const requested = input.collections ?? [];

  const { collections, note, tokenRejected } = await enumerateCollections(baseUrl, input.token);

  // Every collection gets checked, so the picker can show each one's entry count
  // beside its name. The catalogue itself already proved the token, so those runs
  // skip the extra public probe — one request per collection, not two.
  const toCheck = collections ?? requested;
  const probePublicAccess = collections === null;

  const results = await mapWithConcurrency(
    toCheck,
    COLLECTION_CHECK_CONCURRENCY,
    collection => checkOneCollection(baseUrl, input.token, collection, probePublicAccess),
  );

  const checks = results.map(result => result.check);
  const detectedVersion = results.reduce<4 | 5 | null>(
    (found, result) => found ?? result.detectedVersion,
    null,
  );

  const anyAnswered = checks.some(check => check.status !== 'error');
  const anyRejected = checks.some(check => check.status === 'unauthorized');
  // A read only proves the token when the same collection is NOT public.
  const provenByToken = checks.some(check => check.status === 'ok' && check.publiclyReadable !== true);
  const readablePublicly = checks.some(check => check.status === 'ok' && check.publiclyReadable === true);
  const reachable = collections !== null || anyAnswered;

  // Enumerating the catalogue needs the token, so it proves the token outright.
  // Otherwise a 401 on a collection is decisive the other way, and a run of
  // public-only reads is decisive neither way — say which it is rather than
  // reporting a green tick the operator cannot rely on.
  const authorized = collections !== null || provenByToken;
  let tokenNote: string | null = null;
  if (anyRejected) {
    tokenNote = 'The token was rejected by this instance (401). Check it was copied whole and has not been revoked.';
  } else if (!authorized && readablePublicly) {
    tokenNote = 'These collections are readable without a credential, so the token could not be confirmed here. The sync still sends it.';
  } else if (!authorized && tokenRejected === true) {
    tokenNote = 'The token was rejected by this instance (401). Check it was copied whole and has not been revoked.';
  }

  return {
    reachable,
    authorized,
    detectedVersion,
    collections,
    enumerationNote: note,
    checks,
    error: reachable
      ? tokenNote
      : (checks[0]?.message ?? note ?? 'Could not reach this Strapi instance.'),
  };
}
