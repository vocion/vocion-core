import type { RelatedItem, Relation } from '@/libs/workspace/related';
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { describeRef } from '@/libs/preview/describeRef';
import { relativeLabel } from '@/libs/timeAgo';
import { derivedOf, deriveValue, driftOf, relationsOf } from '@/libs/workspace/related';
import { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema, userSchema, workerRunSchema } from '@/models/Schema';
import { RECORD_BODY_ROLE } from '@/services/objects/recordBodyFormat';
import { recordLinkerForOrg } from '@/services/objects/recordHref';

/**
 * WHAT A RECORD IS CONNECTED TO, read from what the records already say
 * (`libs/workspace/related.ts` has the descriptor). One read for every page
 * and pane that draws a record's Related block: the feature, the plan, the
 * product, the release, the object page.
 *
 * Nothing here names a type. What a type is connected to is its own
 * declaration (`x-related` on its schema); the chat that started a record and
 * its artifacts are core's own relations. Every read is org-scoped.
 */

type Row = { id: number; title: string; type: string; status: string | null; meta: Record<string, unknown> };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/** The conversation a record came from, and who asked. */
export type RecordOrigin = { conversationId: number; title: string; href: string | null; by: string | null; at: string | null };

/**
 * The chat that started a record: its own `metadata.origin` (written by the
 * create path since 2026-09-30), else the filing action run's
 * `proposal.origin` — the action that proposed it (`review_action_run_id`)
 * or one whose result names it — for a record filed before.
 * @param orgId - Tenant.
 * @param record - The record.
 * @param record.id - Its id.
 * @param record.meta - Its metadata.
 * @param record.reviewActionRunId - The action run that proposed it, when one did.
 */
export async function recordOrigin(orgId: string, record: { id: number; meta: Record<string, unknown>; reviewActionRunId?: number | null }): Promise<RecordOrigin | null> {
  let conversationId: number | null = null;
  let userId: string | null = null;
  let at: string | null = null;
  const own = obj(record.meta.origin);
  if (typeof own.conversationId === 'number' && own.conversationId > 0) {
    conversationId = own.conversationId;
    userId = text(own.userId);
    at = text(own.at);
  } else {
    const [run] = await db
      .select({ proposal: actionRunSchema.proposal, at: actionRunSchema.createdAt, invokedBy: actionRunSchema.invokedBy })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, orgId),
        sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' is not null`,
        or(
          record.reviewActionRunId ? eq(actionRunSchema.id, record.reviewActionRunId) : sql`false`,
          sql`${actionRunSchema.result} ->> 'objectId' = ${String(record.id)}`,
        ),
      ))
      .orderBy(asc(actionRunSchema.id))
      .limit(1);
    const origin = obj(obj(run?.proposal).origin);
    const id = Number(origin.conversationId);
    if (run && Number.isSafeInteger(id) && id > 0) {
      conversationId = id;
      userId = text(origin.userId);
      at = run.at.toISOString();
    }
  }
  if (conversationId === null) {
    return null;
  }
  const [convo] = await db
    .select({ id: conversationSchema.id, title: conversationSchema.title })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, orgId), eq(conversationSchema.id, conversationId)))
    .limit(1);
  if (!convo) {
    return null;
  }
  const by = userId && !userId.includes(':')
    ? (await db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, userId)).limit(1))[0]
    : null;
  return {
    conversationId: convo.id,
    title: convo.title || `Conversation #${convo.id}`,
    href: describeRef({ type: 'conversation', id: String(convo.id) }).href ?? null,
    by: by ? (by.name?.trim() || by.email) : null,
    at,
  };
}

/**
 * The origin as a Related item.
 * @param origin - From {@link recordOrigin}.
 * @param relation - Its relation.
 */
export function originItem(origin: RecordOrigin, relation: Pick<Relation, 'key' | 'label'> = { key: 'origin', label: 'Started in chat' }): RelatedItem {
  return {
    key: `${relation.key}:conversation:${origin.conversationId}`,
    relation: relation.key,
    label: relation.label,
    title: origin.title,
    href: origin.href,
    external: false,
    preview: { type: 'conversation', id: String(origin.conversationId) },
    kind: 'conversation',
    note: origin.by,
    at: origin.at,
  };
}

async function rowsWhere(orgId: string, where: ReturnType<typeof and>, limit: number): Promise<Row[]> {
  const rows = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, type: businessObjectTypeSchema.slug, status: businessObjectSchema.status, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), where))
    .orderBy(asc(businessObjectSchema.id))
    .limit(limit);
  return rows.map(r => ({ ...r, meta: obj(r.meta) }));
}

function values(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v];
  return list.map(x => text(x)).filter((x): x is string => x !== null);
}

/**
 * What a record is connected to, in the order its type declares, the chat
 * that started it first. Empty for a record the org does not hold.
 * @param orgId - Tenant.
 * @param objectId - The record.
 * @param opts - What the caller already decided.
 * @param opts.relations - Relations to read in place of the type's own (a test, a page that names its own).
 */
export async function relatedOf(orgId: string, objectId: number, opts: { relations?: readonly Relation[] } = {}): Promise<RelatedItem[]> {
  const read = await readRelated(orgId, objectId, opts);
  if (!read) {
    return [];
  }
  // A derived field whose stored value disagrees with its records is said
  // under the relation it is read from (`x-derived`), never silently preferred.
  const items = [...read.items];
  for (const [field, d] of Object.entries(derivedOf(read.schema))) {
    const lines = driftOf(field, read.meta[field], deriveValue(d, (read.found.get(d.relation) ?? []).map(r => r.meta)));
    const rel = read.relations.find(r => r.key === d.relation);
    if (lines.length === 0 || !rel) {
      continue;
    }
    const at = items.map(i => i.relation).lastIndexOf(d.relation);
    const drift = lines.map((line, i): RelatedItem => ({ key: `${rel.key}:drift:${field}:${i}`, relation: rel.key, label: rel.label, title: line, href: null, external: false, preview: null, kind: 'drift', note: null, at: null }));
    items.splice(at >= 0 ? at + 1 : items.length, 0, ...drift);
  }
  return items;
}

/**
 * A record's derived fields (`x-derived`): the values its records say, and
 * where the stored value disagrees. What `read_object` and the record's page
 * show in place of the stored value.
 * @param orgId - Tenant.
 * @param objectId - The record.
 */
export async function derivedFieldsOf(orgId: string, objectId: number): Promise<{ values: Record<string, unknown>; drift: Record<string, string[]> }> {
  const read = await readRelated(orgId, objectId, {});
  if (!read) {
    return { values: {}, drift: {} };
  }
  const values: Record<string, unknown> = {};
  const drift: Record<string, string[]> = {};
  for (const [field, d] of Object.entries(derivedOf(read.schema))) {
    if (!read.relations.some(r => r.key === d.relation)) {
      continue;
    }
    values[field] = deriveValue(d, (read.found.get(d.relation) ?? []).map(r => r.meta));
    const lines = driftOf(field, read.meta[field], values[field]);
    if (lines.length > 0) {
      drift[field] = lines;
    }
  }
  return { values, drift };
}

/** What a read of a record's relations holds. */
type RelatedRead = { items: RelatedItem[]; found: Map<string, Row[]>; meta: Record<string, unknown>; schema: Record<string, unknown> | null; relations: readonly Relation[] };

async function readRelated(orgId: string, objectId: number, opts: { relations?: readonly Relation[] }): Promise<RelatedRead | null> {
  const [self] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, meta: businessObjectSchema.metadata, reviewActionRunId: businessObjectSchema.reviewActionRunId, schema: businessObjectTypeSchema.schema })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, objectId)))
    .limit(1);
  if (!self) {
    return null;
  }
  const meta = obj(self.meta);
  const relations = opts.relations ?? relationsOf(self.schema as Record<string, unknown> | null);
  const link = await recordLinkerForOrg(orgId);
  const found = new Map<string, Row[]>();
  const items: RelatedItem[] = [];
  const recordItem = (r: Row, rel: Relation): RelatedItem => ({
    key: `${rel.key}:object:${r.id}`,
    relation: rel.key,
    label: rel.label,
    title: `#${r.id} ${r.title}`,
    href: link({ objectType: r.type, id: r.id }),
    external: false,
    preview: { type: 'object', id: String(r.id) },
    kind: 'record',
    note: text(r.meta.state) ?? r.status,
    at: null,
    ...(rel.details ? { details: detailsOf(rel, r.meta, meta) } : {}),
  });
  const sources = (rel: Relation): Array<{ id: number; meta: Record<string, unknown> }> =>
    (rel.of ? found.get(rel.of) ?? [] : [{ id: self.id, meta }]);

  for (const rel of relations) {
    const typeFilter = rel.type ? eq(businessObjectTypeSchema.slug, rel.type) : undefined;
    switch (rel.from) {
      case 'origin': {
        const origin = await recordOrigin(orgId, { id: self.id, meta, reviewActionRunId: self.reviewActionRunId });
        if (origin) {
          items.push(originItem(origin, rel));
        }
        break;
      }
      case 'links': {
        if (!rel.field) {
          break;
        }
        const vals = [...new Set(sources(rel).flatMap(s => values(s.meta[rel.field!])))];
        if (vals.length === 0) {
          break;
        }
        const ids = vals.map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
        // A value that is not an id names its record by slug, as record links do (`recordLinks.ts`).
        const slugs = vals.filter(v => !/^\d+$/.test(v));
        const where = rel.match
          ? and(inArray(sql`${businessObjectSchema.metadata} ->> ${rel.match}`, vals), typeFilter)
          : and(or(
              ids.length > 0 ? inArray(businessObjectSchema.id, ids) : sql`false`,
              slugs.length > 0 ? inArray(sql`${businessObjectSchema.metadata} ->> 'slug'`, slugs) : sql`false`,
            ), typeFilter);
        const rows = (await rowsWhere(orgId, where, rel.limit)).filter(r => r.id !== self.id);
        found.set(rel.key, rows);
        items.push(...rows.map(r => recordItem(r, rel)));
        break;
      }
      case 'backlinks': {
        if (!rel.field) {
          break;
        }
        const targets = [...new Set(sources(rel).flatMap(s => (rel.match ? values(s.meta[rel.match]) : [String(s.id)])))];
        if (targets.length === 0) {
          break;
        }
        const f = rel.field;
        const named = or(...targets.flatMap(t => [
          sql`${businessObjectSchema.metadata} ->> ${f} = ${t}`,
          sql`${businessObjectSchema.metadata} -> ${f} @> ${JSON.stringify([/^\d+$/.test(t) ? Number(t) : t])}::jsonb`,
          sql`${businessObjectSchema.metadata} -> ${f} @> ${JSON.stringify([t])}::jsonb`,
        ]));
        const rows = (await rowsWhere(orgId, and(named, typeFilter), rel.limit)).filter(r => r.id !== self.id);
        found.set(rel.key, rows);
        items.push(...rows.map(r => recordItem(r, rel)));
        break;
      }
      case 'runs': {
        const ids = sources(rel).map(s => String(s.id));
        if (ids.length === 0) {
          break;
        }
        const runs = await db
          .select({ id: workerRunSchema.id, status: workerRunSchema.status, at: workerRunSchema.createdAt })
          .from(workerRunSchema)
          .where(and(eq(workerRunSchema.orgId, orgId), inArray(sql`${workerRunSchema.input} -> 'record' ->> 'id'`, ids)))
          .orderBy(desc(workerRunSchema.id))
          .limit(rel.limit);
        items.push(...runs.map(r => ({
          key: `${rel.key}:run:${r.id}`,
          relation: rel.key,
          label: rel.label,
          title: `Run #${r.id}`,
          href: describeRef({ type: 'worker_run', id: String(r.id) }).href ?? null,
          external: false,
          preview: { type: 'worker_run' as const, id: String(r.id) },
          kind: 'run' as const,
          note: r.status,
          at: r.at.toISOString(),
        })));
        break;
      }
      case 'url': {
        if (!rel.field) {
          break;
        }
        const urls = [...new Set(sources(rel).flatMap(s => values(s.meta[rel.field!])).filter(u => /^https:\/\//.test(u)))].slice(0, rel.limit);
        items.push(...urls.map(u => ({
          key: `${rel.key}:url:${u}`,
          relation: rel.key,
          label: rel.label,
          title: urlLabel(u),
          href: u,
          external: true,
          preview: null,
          kind: 'link' as const,
          note: null,
          at: null,
        })));
        break;
      }
      case 'artifacts': {
        const rows = await db
          .select({ id: artifactSchema.id, title: artifactSchema.title, kind: artifactSchema.kind, role: artifactSchema.recordRole, at: artifactSchema.updatedAt })
          .from(artifactSchema)
          .where(and(
            eq(artifactSchema.orgId, orgId),
            eq(artifactSchema.recordType, 'object'),
            eq(artifactSchema.recordId, String(self.id)),
            rel.role ? eq(artifactSchema.recordRole, rel.role) : or(sql`${artifactSchema.recordRole} is null`, ne(artifactSchema.recordRole, RECORD_BODY_ROLE)),
            isNotNull(artifactSchema.title),
          ))
          .orderBy(desc(artifactSchema.updatedAt))
          .limit(rel.limit);
        items.push(...rows.map(a => ({
          key: `${rel.key}:artifact:${a.id}`,
          relation: rel.key,
          label: rel.label,
          title: a.title,
          href: describeRef({ type: 'artifact', id: String(a.id) }).href ?? null,
          external: false,
          preview: { type: 'artifact' as const, id: String(a.id) },
          kind: 'artifact' as const,
          note: a.role,
          at: a.at.toISOString(),
        })));
        break;
      }
    }
  }
  return { items, found, meta, schema: self.schema as Record<string, unknown> | null, relations };
}

/**
 * What a related record says under its link, as its relation declares.
 * @param rel - The relation.
 * @param m - The related record's metadata.
 * @param self - This record's metadata, for a `pick`.
 */
function detailsOf(rel: Relation, m: Record<string, unknown>, self: Record<string, unknown>): string[] {
  return (rel.details ?? []).flatMap((d) => {
    let v: unknown = m[d.field];
    if (d.pick) {
      const key = text(self[d.pick]);
      v = key && v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[key] : undefined;
    }
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    const said = (() => {
      switch (d.format) {
        case 'present':
          return empty ? d.absent ?? null : d.present ?? d.label ?? d.field;
        case 'count':
          return Array.isArray(v) ? `${v.length} ${d.label ?? d.field}` : null;
        case 'sha':
          return empty ? null : String(v).slice(0, 7);
        case 'relative': {
          const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
          return Number.isNaN(t) ? null : relativeLabel(new Date(t), Date.now());
        }
        default:
          return empty ? null : Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'object' ? null : String(v);
      }
    })();
    if (said === null) {
      return [];
    }
    return [d.label && d.format !== 'count' && d.format !== 'present' ? `${d.label} ${said}` : said];
  });
}

/**
 * "PR #27" for a pull request, else the link's host and last segment.
 * @param url - The link.
 */
function urlLabel(url: string): string {
  const pr = /\/(?:pull|merge_requests)\/(\d+)/.exec(url)?.[1];
  if (pr) {
    return `PR #${pr}`;
  }
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.length > 1 ? `/…/${u.pathname.split('/').filter(Boolean).at(-1)}` : ''}`;
  } catch {
    return url;
  }
}

/**
 * The chat each of a page's records started in, in two reads for the whole
 * page: the records' own `metadata.origin`, then the filing action runs for
 * the rest. Records that came from no conversation are absent.
 * @param orgId - Tenant.
 * @param rows - The page's records.
 */
export async function recordOrigins(orgId: string, rows: ReadonlyArray<{ id: number | string; meta: Record<string, unknown> }>): Promise<Map<number, { conversationId: number; title: string; href: string | null }>> {
  const wanted = new Map<number, number>();
  const missing: number[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      continue;
    }
    const own = obj(r.meta.origin);
    if (typeof own.conversationId === 'number' && own.conversationId > 0) {
      wanted.set(id, own.conversationId);
    } else {
      missing.push(id);
    }
  }
  if (missing.length > 0) {
    const proposedBy = await db
      .select({ id: businessObjectSchema.id, run: businessObjectSchema.reviewActionRunId })
      .from(businessObjectSchema)
      .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, missing), isNotNull(businessObjectSchema.reviewActionRunId)));
    const byRun = new Map(proposedBy.map(p => [p.run!, p.id]));
    const runs = await db
      .select({ id: actionRunSchema.id, objectId: sql<string | null>`${actionRunSchema.result} ->> 'objectId'`, conversationId: sql<string | null>`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId'` })
      .from(actionRunSchema)
      .where(and(
        eq(actionRunSchema.orgId, orgId),
        sql`${actionRunSchema.proposal} -> 'origin' ->> 'conversationId' is not null`,
        or(
          byRun.size > 0 ? inArray(actionRunSchema.id, [...byRun.keys()]) : sql`false`,
          inArray(sql`${actionRunSchema.result} ->> 'objectId'`, missing.map(String)),
        ),
      ))
      .orderBy(asc(actionRunSchema.id));
    for (const run of runs) {
      const id = byRun.get(run.id) ?? Number(run.objectId);
      const conversationId = Number(run.conversationId);
      if (missing.includes(id) && !wanted.has(id) && Number.isSafeInteger(conversationId) && conversationId > 0) {
        wanted.set(id, conversationId);
      }
    }
  }
  if (wanted.size === 0) {
    return new Map();
  }
  const convos = await db
    .select({ id: conversationSchema.id, title: conversationSchema.title })
    .from(conversationSchema)
    .where(and(eq(conversationSchema.orgId, orgId), inArray(conversationSchema.id, [...new Set(wanted.values())])));
  const byId = new Map(convos.map(c => [c.id, c]));
  const out = new Map<number, { conversationId: number; title: string; href: string | null }>();
  for (const [id, conversationId] of wanted) {
    const c = byId.get(conversationId);
    if (c) {
      out.set(id, { conversationId, title: c.title || `Conversation #${c.id}`, href: describeRef({ type: 'conversation', id: String(c.id) }).href ?? null });
    }
  }
  return out;
}

/** One write to a record a record is connected to, as its Activity lists it. */
export type RelatedWrite = { runId: number; recordId: number; title: string; by: string; at: string; href: string; preview: { type: 'record_history'; id: string } };

/**
 * WHAT CHANGED ON WHAT A RECORD IS CONNECTED TO — the writes to it and to the
 * records its relations name (a product's environments and repositories),
 * newest first, each with who made it: a person, or the seat that keeps
 * them true (the Release engineer after a deploy or a rename). Read from the
 * action runs that wrote them, so an agent's write and a person's read the
 * same.
 * @param orgId - Tenant.
 * @param objectId - The record.
 * @param limit - At most this many.
 */
export async function relatedWrites(orgId: string, objectId: number, limit = 10): Promise<RelatedWrite[]> {
  const read = await readRelated(orgId, objectId, {});
  if (!read) {
    return [];
  }
  const titles = new Map<number, { title: string; type: string | null }>([[objectId, { title: 'this record', type: null }]]);
  for (const rows of read.found.values()) {
    for (const r of rows) {
      titles.set(r.id, { title: r.title, type: r.type });
    }
  }
  const ids = [...titles.keys()].map(String);
  const runs = await db
    .select({ id: actionRunSchema.id, objectId: sql<string | null>`${actionRunSchema.result} ->> 'objectId'`, by: actionRunSchema.invokedBy, at: actionRunSchema.createdAt })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.status, 'done'), inArray(sql`${actionRunSchema.result} ->> 'objectId'`, ids)))
    .orderBy(desc(actionRunSchema.id))
    .limit(limit);
  const people = [...new Set(runs.map(r => r.by).filter((b): b is string => typeof b === 'string' && b !== '' && !b.includes(':')))];
  const names = people.length > 0
    ? new Map((await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, people))).map(u => [u.id, u.name?.trim() || u.email]))
    : new Map<string, string>();
  const link = await recordLinkerForOrg(orgId);
  return runs.flatMap((r) => {
    const recordId = Number(r.objectId);
    const named = titles.get(recordId);
    if (!named) {
      return [];
    }
    const by = r.by ? names.get(r.by) ?? r.by.replace(/^(?:agent|factory):/, '') : 'Vocion';
    return [{ runId: r.id, recordId, title: named.title, by, at: r.at.toISOString(), href: link({ objectType: named.type ?? undefined, id: recordId }), preview: { type: 'record_history' as const, id: String(recordId) } }];
  });
}
