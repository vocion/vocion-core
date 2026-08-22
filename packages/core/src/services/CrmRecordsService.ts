/**
 * CRM records — the STRUCTURED read path over synced HubSpot data.
 *
 * The mirror is the single source of truth for CRM reads. There is
 * deliberately no live-API read: two read paths means two answers to the
 * same question, and the first disagreement between a count here and what
 * the discovery matcher saw would make both untrustworthy. Freshness is a
 * separate concern, handled by `freshen_source` before the read.
 *
 * Semantic search (`RetrievalService`) answers "what was said". This module
 * answers "how many" and "which ones" — with a real COUNT(*), facet counts,
 * and pages. Never a relevance top-k dressed up as a result set.
 *
 * Everything is scoped by org AND by the hubspot-kind `knowledge_source`
 * rows the caller may reach, so the per-user connection ACL applies to
 * structured reads exactly as it does to retrieval.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

export type CrmObjectType = 'contacts' | 'deals' | 'companies';

/** Metadata keys usable as filters/facets, per object type. */
const FACET_KEYS: Record<CrmObjectType, string[]> = {
  contacts: ['lifecycleStage'],
  deals: ['dealStageLabel', 'pipelineLabel'],
  companies: ['industry'],
};

/** Metadata keys projected onto a returned row, per object type. */
const ROW_KEYS: Record<CrmObjectType, string[]> = {
  contacts: ['primaryEmail', 'company', 'jobTitle', 'lifecycleStage', 'ownerId', 'createdAt'],
  deals: ['amount', 'dealStageLabel', 'pipelineLabel', 'dealClosed', 'closeDate', 'ownerId', 'createdAt'],
  companies: ['domain', 'industry', 'employees', 'ownerId', 'createdAt'],
};

/** Free-text `query` searches these, plus the document title. */
const QUERY_KEYS = ['primaryEmail', 'emailDomain', 'domain', 'name', 'company', 'hubspotId'];

export type CrmFilter = {
  ownerIds?: string[];
  /** contacts only */
  lifecycleStages?: string[];
  /** deals only */
  dealStages?: string[];
  /** deals only */
  pipelines?: string[];
  /** companies only */
  industries?: string[];
  /**
   * deals only: restrict to open or closed deals. Resolved from the pipeline
   * definitions, so it is correct for custom pipelines whose stage ids carry
   * no hint of closed-ness.
   */
  dealStatus?: 'open' | 'closed';
  /** ISO date (or datetime); records created at or after it. */
  createdAfter?: string;
  /** ISO date (or datetime); records created strictly before it. */
  createdBefore?: string;
  /** Case-insensitive substring over title, email, domain, company, HubSpot id. */
  query?: string;
};

export type CrmQueryOptions = CrmFilter & {
  limit?: number;
  offset?: number;
  /**
   * Per-user connection ACL for this request. When set, only hubspot sources
   * whose slug appears here are read. Unset = the agent's full scope.
   */
  allowedSourceSlugs?: string[];
};

export type CrmRecord = {
  ref: string;
  hubspotId: string | null;
  name: string | null;
  [key: string]: unknown;
};

export type CrmQueryResult = {
  objectType: CrmObjectType;
  /** True COUNT(*) of matching records — NOT the length of `records`. */
  total: number;
  returned: number;
  offset: number;
  hasMore: boolean;
  /** Counts grouped by each facet key, so filter values are discoverable. */
  facets: Record<string, Record<string, number>>;
  /** Sum of deal amounts across ALL matches (deals only, when synced). */
  totalAmount?: number;
  /**
   * Summed deal value per facet value (deals only). Without this, a
   * "what is the pipeline worth by stage" question forces the caller to page
   * every record and add the amounts up by hand.
   */
  facetAmounts?: Record<string, Record<string, number>>;
  /** Metadata keys the mirror does not carry for these rows — cannot be filtered or summed. */
  unavailableFields: string[];
  /**
   * Requested filter values that do not exist in the data, per filter key.
   * A non-empty entry means the count EXCLUDES what the caller asked for, so
   * the number must not be reported until the value is corrected.
   */
  unknownFilterValues: Record<string, { requested: string[]; notFound: string[] }>;
  /** Newest `last_synced_at` across the sources read. Null = never synced. */
  asOf: Date | null;
  /** Source slugs actually read. Empty = no hubspot source connected/permitted. */
  sources: string[];
  records: CrmRecord[];
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * A HubSpot-connector source. `kind` is always `plugin` for connector
 * sources (see `SourceSyncService.addSource`), so the connector identity is
 * the `_connector` hint in config. Falls back to the slug for sources added
 * before that hint existed.
 */
export const isHubspotSource = sql`(${knowledgeSourceSchema.configJson} ->> '_connector' = 'hubspot' OR ${knowledgeSourceSchema.slug} = 'hubspot' OR ${knowledgeSourceSchema.slug} LIKE 'hubspot-%')`;

/**
 * `metadata ->> 'key'`, with the key INLINED rather than bound.
 *
 * Two reasons it has to be inlined. Postgres cannot prove that `->> $1` in a
 * SELECT and `->> $22` in the GROUP BY are the same expression, so a facet
 * query with bound keys fails outright. And a bound key defeats the
 * expression indexes in `0054_crm_records_idx.sql`, which are only matched
 * against a literal expression.
 *
 * Keys come exclusively from the module-level constants below, never from
 * caller input, and the guard makes that structural rather than a convention.
 * @param key
 */
function meta(key: string) {
  if (!/^[A-Z][A-Z0-9]*$/i.test(key)) {
    throw new Error(`unsafe CRM metadata key: ${key}`);
  }
  return sql`${knowledgeDocumentSchema.metadata} ->> ${sql.raw(`'${key}'`)}`;
}

/**
 * Numeric coercion that tolerates junk instead of erroring the whole query.
 * @param key
 */
function metaNumeric(key: string) {
  return sql`CASE WHEN ${meta(key)} ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (${meta(key)})::numeric ELSE NULL END`;
}

/**
 * Validate a caller-supplied date bound and normalise it for text comparison.
 *
 * Rejecting junk here matters: an unparseable bound compared as text would
 * silently match everything or nothing rather than erroring, which is exactly
 * the kind of quietly-wrong count this whole module exists to prevent.
 * @param value - ISO date (`2026-08-14`) or datetime.
 * @param field - Argument name, for the error message.
 */
function isoBound(value: string, field: string): string {
  const v = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/.test(v)) {
    throw new TypeError(`${field} must be an ISO date like 2026-08-14 or 2026-08-14T00:00:00Z, got: ${value}`);
  }
  if (Number.isNaN(new Date(v).getTime())) {
    throw new TypeError(`${field} is not a real date: ${value}`);
  }
  // A bare date becomes midnight UTC so it compares against stored
  // `YYYY-MM-DDTHH:MM:SS...Z` values rather than sorting before all of them.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v.replace(' ', 'T');
}

function lowerIn(key: string, values: string[]) {
  return sql`lower(${meta(key)}) IN (${sql.join(values.map(v => sql`${v.toLowerCase()}`), sql`, `)})`;
}

/**
 * Resolve the HubSpot sources this caller may read.
 *
 * The connector identity is `config_json->>'_connector'`, NOT the `kind`
 * column — `addSource` stores every connector source as kind `plugin` and
 * keeps the connector slug in config. Metacto splits HubSpot across three
 * sources (`hubspot` = deals, `hubspot-contacts`, `hubspot-companies`), so
 * matching on the connector catches all of them regardless of naming.
 * @param orgId
 * @param allowedSourceSlugs - Per-user ACL; unset means no narrowing.
 */
async function hubspotSources(orgId: string, allowedSourceSlugs?: string[]) {
  const rows = await db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      lastSyncedAt: knowledgeSourceSchema.lastSyncedAt,
    })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      isHubspotSource,
    ));
  return allowedSourceSlugs ? rows.filter(r => allowedSourceSlugs.includes(r.slug)) : rows;
}

/**
 * Query the CRM mirror for ONE object type: exact count, facet counts, and one
 * page of records.
 * @param orgId
 * @param objectType
 * @param opts
 */
export async function queryCrmRecords(
  orgId: string,
  objectType: CrmObjectType,
  opts: CrmQueryOptions = {},
): Promise<CrmQueryResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);

  const sources = await hubspotSources(orgId, opts.allowedSourceSlugs);
  const empty: CrmQueryResult = {
    objectType,
    total: 0,
    returned: 0,
    offset,
    hasMore: false,
    facets: {},
    unavailableFields: [],
    unknownFilterValues: {},
    asOf: null,
    sources: [],
    records: [],
  };
  if (sources.length === 0) {
    return empty;
  }

  const conds = [
    eq(knowledgeDocumentSchema.orgId, orgId),
    inArray(knowledgeDocumentSchema.sourceId, sources.map(s => s.id)),
    sql`${meta('objectType')} = ${objectType}`,
    sql`${meta('hubspotId')} IS NOT NULL`,
  ];

  if (opts.ownerIds?.length) {
    conds.push(sql`${meta('ownerId')} IN (${sql.join(opts.ownerIds.map(o => sql`${o}`), sql`, `)})`);
  }

  // Value filters are held back from `conds` deliberately, so the facets below
  // can be computed WITHOUT them. A requested value that does not exist in the
  // data (asking for "MQL" when the stage is stored as
  // "marketingqualifiedlead") otherwise produces total=0 with empty facets,
  // which is indistinguishable from a genuine zero — and a caller that cannot
  // tell those apart reports the wrong number as fact.
  const valueFilters: Array<{ key: string; requested: string[] }> = [];
  if (objectType === 'contacts' && opts.lifecycleStages?.length) {
    valueFilters.push({ key: 'lifecycleStage', requested: opts.lifecycleStages });
  }
  if (objectType === 'deals' && opts.dealStages?.length) {
    valueFilters.push({ key: 'dealStageLabel', requested: opts.dealStages });
  }
  if (objectType === 'deals' && opts.pipelines?.length) {
    valueFilters.push({ key: 'pipelineLabel', requested: opts.pipelines });
  }
  if (objectType === 'companies' && opts.industries?.length) {
    valueFilters.push({ key: 'industry', requested: opts.industries });
  }

  // Open/closed comes from the pipeline definitions, not from guessing which
  // stage names look closed. Applied to the BASE scope so the facets describe
  // only open (or only closed) deals when asked.
  if (objectType === 'deals' && opts.dealStatus) {
    conds.push(sql`${meta('dealClosed')} = ${opts.dealStatus === 'closed' ? 'true' : 'false'}`);
  }

  // Created-date window, compared as TEXT on purpose. HubSpot stamps
  // `createdate` as ISO 8601 UTC, which sorts lexicographically in the same
  // order it sorts chronologically, so a string compare is both correct and
  // safe — a `::timestamptz` cast would throw the whole query away on a single
  // malformed value, and it would defeat the expression index besides.
  if (opts.createdAfter) {
    conds.push(sql`${meta('createdAt')} >= ${isoBound(opts.createdAfter, 'createdAfter')}`);
  }
  if (opts.createdBefore) {
    conds.push(sql`${meta('createdAt')} < ${isoBound(opts.createdBefore, 'createdBefore')}`);
  }

  const q = opts.query?.trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    const targets = [
      sql`lower(coalesce(${knowledgeDocumentSchema.title}, ''))`,
      ...QUERY_KEYS.map(k => sql`lower(coalesce(${meta(k)}, ''))`),
    ];
    conds.push(sql`(${sql.join(targets.map(t => sql`${t} LIKE ${like}`), sql` OR `)})`);
  }

  // Everything except the value filters — the scope the facets describe.
  const baseWhere = and(...conds);
  for (const f of valueFilters) {
    conds.push(lowerIn(f.key, f.requested));
  }
  const where = and(...conds);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(knowledgeDocumentSchema)
    .where(where);
  const total = countRow?.total ?? 0;

  // Facets are computed over `baseWhere`, i.e. BEFORE the value filters, and
  // over the full match set rather than the page. That is what makes filter
  // values discoverable: a caller that guessed "MQL" still sees that the real
  // value is `marketingqualifiedlead`, alongside a total of 0, instead of
  // being left to conclude there are no MQLs.
  const facets: Record<string, Record<string, number>> = {};
  const facetAmounts: Record<string, Record<string, number>> = {};
  const unknownFilterValues: CrmQueryResult['unknownFilterValues'] = {};
  for (const key of FACET_KEYS[objectType]) {
    // The amount sum rides along on the same GROUP BY, so "value by stage" is
    // one query rather than a page-through-everything-and-add-it-up loop.
    const rows = await db
      .select({
        value: sql<string | null>`${meta(key)}`,
        count: sql<number>`count(*)::int`,
        amount: objectType === 'deals' ? sql<string | null>`sum(${metaNumeric('amount')})` : sql<string | null>`NULL`,
      })
      .from(knowledgeDocumentSchema)
      .where(baseWhere)
      .groupBy(sql`${meta(key)}`)
      .orderBy(sql`count(*) DESC`);
    const dist: Record<string, number> = {};
    const amounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.value != null && r.value !== '') {
        dist[r.value] = r.count;
        if (r.amount != null) {
          amounts[r.value] = Number(r.amount);
        }
      }
    }
    if (Object.keys(dist).length > 0) {
      facets[key] = dist;
    }
    if (Object.keys(amounts).length > 0) {
      facetAmounts[key] = amounts;
    }
    // A requested value absent from the (unfiltered) distribution is a caller
    // mistake, not a zero. Naming it is what lets the caller retry with the
    // real value instead of reporting an empty result as the answer.
    const filter = valueFilters.find(f => f.key === key);
    if (filter) {
      const present = new Set(Object.keys(dist).map(v => v.toLowerCase()));
      const notFound = filter.requested.filter(v => !present.has(v.trim().toLowerCase()));
      if (notFound.length > 0) {
        unknownFilterValues[key] = { requested: filter.requested, notFound };
      }
    }
  }

  // Deal value across ALL matches. `withAmount` separates "sums to zero"
  // from "amount was never synced" — the difference between a real answer
  // and a fabricated one.
  let totalAmount: number | undefined;
  let amountPresent = 0;
  if (objectType === 'deals') {
    const [row] = await db
      .select({
        sum: sql<string | null>`sum(${metaNumeric('amount')})`,
        withAmount: sql<number>`count(${metaNumeric('amount')})::int`,
      })
      .from(knowledgeDocumentSchema)
      .where(where);
    amountPresent = row?.withAmount ?? 0;
    if (amountPresent > 0) {
      totalAmount = Number(row?.sum ?? 0);
    }
  }

  const rows = await db
    .select({
      externalId: knowledgeDocumentSchema.externalId,
      title: knowledgeDocumentSchema.title,
      metadata: knowledgeDocumentSchema.metadata,
      lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
    })
    .from(knowledgeDocumentSchema)
    .where(where)
    .orderBy(sql`coalesce(${knowledgeDocumentSchema.lastModifiedAt}, ${knowledgeDocumentSchema.ingestedAt}) DESC`)
    .limit(limit)
    .offset(offset);

  const records: CrmRecord[] = rows.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    const rec: CrmRecord = {
      ref: r.externalId,
      hubspotId: typeof m.hubspotId === 'string' ? m.hubspotId : null,
      name: r.title ?? null,
    };
    for (const k of ROW_KEYS[objectType]) {
      if (m[k] != null && m[k] !== '') {
        rec[k] = m[k];
      }
    }
    return rec;
  });

  // Report which projected fields the mirror simply does not carry for this
  // object type yet, so a "what is our pipeline worth" style question gets an
  // honest "not synced" instead of a made-up number.
  // One query, one aggregate per key — not a query per key.
  const unavailableFields: string[] = [];
  if (total > 0) {
    const probeKeys = ROW_KEYS[objectType];
    const [row] = await db
      .select(
        Object.fromEntries(
          probeKeys.map(k => [k, sql<number>`count(${meta(k)})::int`]),
        ) as Record<string, ReturnType<typeof sql<number>>>,
      )
      .from(knowledgeDocumentSchema)
      .where(where);
    for (const key of probeKeys) {
      if (Number((row as Record<string, number> | undefined)?.[key] ?? 0) === 0) {
        unavailableFields.push(key);
      }
    }
  }

  // Freshness must describe the sources this answer actually came from. The
  // three HubSpot sources sync on independent schedules, so reporting the
  // newest across all of them made a deals count claim the contacts sync
  // time. Narrow to the CONTRIBUTING sources, then take the OLDEST: the whole
  // result set is only complete as of its stalest input.
  const contributors = await db
    .select({ sourceId: knowledgeDocumentSchema.sourceId })
    .from(knowledgeDocumentSchema)
    .where(where)
    .groupBy(knowledgeDocumentSchema.sourceId);
  const contributingIds = new Set(contributors.map(c => c.sourceId));
  // With no rows there is nothing to attribute, so fall back to the full
  // permitted set — the caller still needs to see how stale the mirror is.
  const relevant = contributingIds.size > 0 ? sources.filter(s => contributingIds.has(s.id)) : sources;
  // An unsynced contributing source makes the true age unknowable; say so with
  // null rather than quoting a time that excludes it.
  const asOf = relevant.every(s => s.lastSyncedAt instanceof Date) && relevant.length > 0
    ? new Date(Math.min(...relevant.map(s => (s.lastSyncedAt as Date).getTime())))
    : null;

  return {
    objectType,
    total,
    returned: records.length,
    offset,
    hasMore: offset + records.length < total,
    facets,
    ...(totalAmount === undefined ? {} : { totalAmount }),
    ...(Object.keys(facetAmounts).length > 0 ? { facetAmounts } : {}),
    unavailableFields,
    unknownFilterValues,
    asOf,
    sources: relevant.map(s => s.slug),
    records,
  };
}
