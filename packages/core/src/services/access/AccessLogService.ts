/**
 * Reading the access log back, and keeping it to its retention period.
 *
 * Every read is scoped to ONE workspace: the Access log page and
 * `GET /api/v1/access-log` pass the caller's own workspace, and there is no
 * account-wide read here on purpose — a client admin sees their workspace,
 * never the company's other workspaces through it.
 *
 * Retention is `VOCION_ACCESS_LOG_RETENTION_DAYS` (default 365; 0 keeps every
 * row). The prune runs as the `access-log.prune` durable job, daily, in
 * bounded batches, so a first run against a year of backlog cannot hold the
 * table for an hour.
 */

import type { SQL } from 'drizzle-orm';
import type { AccessAction } from './accessLog';
import { and, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { accessEventSchema, agentSchema, artifactSchema, businessObjectSchema, knowledgeDocumentSchema, userSchema } from '@/models/Schema';
import { accessLogRetentionDays, MAX_ACCESS_LOG_RETENTION_DAYS } from './retention';

export const ACCESS_ACTOR_KINDS = ['user', 'agent', 'token', 'link'] as const;
export type AccessActorKind = typeof ACCESS_ACTOR_KINDS[number];

export { accessLogRetentionDays, DEFAULT_ACCESS_LOG_RETENTION_DAYS } from './retention';

/** Rows per delete statement, and statements per run. */
const PRUNE_BATCH = 10_000;
const PRUNE_BATCHES_PER_RUN = 100;

/** Page size bounds for a list read. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Where a page starts: strictly older than this row in the log's order
 * (`at` desc, then `id` desc). A keyset, not an offset, so the thousandth
 * page of a year of reads costs what the first does.
 */
export type AccessLogCursor = { at: Date; id: number };

export type AccessLogFilter = {
  action?: AccessAction;
  actorKind?: AccessActorKind;
  /** A user id, an agent slug or `token:<id>` — matched as the actor or as who an agent read for. */
  actorId?: string;
  recordKind?: string;
  recordId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  /** The page after this row; the first page without it. */
  before?: AccessLogCursor;
};

export type AccessEventRow = typeof accessEventSchema.$inferSelect;

/**
 * The cursor for the page after `row`: `<ISO time>,<id>`. A row's `at` is the
 * millisecond the read happened (`accessRow`), so the ISO form round-trips it
 * exactly.
 * @param row - The last row of a page.
 * @param row.at - When it was read.
 * @param row.id - Its id.
 */
export function accessLogCursorOf(row: { at: Date; id: number }): string {
  return `${row.at.toISOString()},${row.id}`;
}

/**
 * A cursor read back from a query string; null when it is not one.
 * @param raw - `<ISO time>,<id>`.
 */
export function parseAccessLogCursor(raw: string | null | undefined): AccessLogCursor | null {
  const [time, id, ...rest] = (raw ?? '').split(',');
  if (!time || !id || rest.length > 0 || !/^\d+$/.test(id)) {
    return null;
  }
  const at = new Date(time);
  const n = Number(id);
  return Number.isNaN(at.getTime()) || !Number.isSafeInteger(n) ? null : { at, id: n };
}

function conditions(orgId: string, filter: AccessLogFilter): SQL[] {
  const where: SQL[] = [eq(accessEventSchema.orgId, orgId)];
  if (filter.action) {
    where.push(eq(accessEventSchema.action, filter.action));
  }
  if (filter.actorKind) {
    where.push(eq(accessEventSchema.actorKind, filter.actorKind));
  }
  if (filter.actorId) {
    // A person's reads include what an agent read for them: same filter, and
    // the agent's rows still say it was the agent.
    where.push(or(eq(accessEventSchema.actorId, filter.actorId), eq(accessEventSchema.onBehalfOf, filter.actorId))!);
  }
  if (filter.recordKind) {
    where.push(eq(accessEventSchema.recordKind, filter.recordKind));
  }
  if (filter.recordId) {
    where.push(eq(accessEventSchema.recordId, filter.recordId));
  }
  if (filter.since) {
    where.push(gte(accessEventSchema.at, filter.since));
  }
  if (filter.until) {
    where.push(lt(accessEventSchema.at, filter.until));
  }
  if (filter.before) {
    where.push(or(
      lt(accessEventSchema.at, filter.before.at),
      and(eq(accessEventSchema.at, filter.before.at), lt(accessEventSchema.id, filter.before.id)),
    )!);
  }
  return where;
}

/**
 * One page of a workspace's reads, newest first.
 * @param orgId - The workspace. Never more than one.
 * @param filter - Narrowing, and where the page starts.
 * @returns The page, whether another follows it, and the cursor that opens it.
 */
export async function listAccessEvents(orgId: string, filter: AccessLogFilter = {}): Promise<{ events: AccessEventRow[]; hasMore: boolean; next: string | null }> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await db
    .select()
    .from(accessEventSchema)
    .where(and(...conditions(orgId, filter)))
    .orderBy(desc(accessEventSchema.at), desc(accessEventSchema.id))
    .limit(limit + 1);
  const events = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { events, hasMore, next: hasMore ? accessLogCursorOf(events[events.length - 1]!) : null };
}

/** Who and what a page of events names, in words: people, agents, and the records' own titles. */
export type AccessLogNames = {
  actors: Record<string, string>;
  records: Record<string, string>;
};

/**
 * Names for the actors and records on one page of events, read in one query
 * per table and scoped to the workspace. A record that is gone simply has no
 * name; the row still says which one it was.
 * @param orgId - The workspace.
 * @param events - The page.
 */
export async function namesForAccessEvents(orgId: string, events: readonly AccessEventRow[]): Promise<AccessLogNames> {
  const userIds = new Set<string>();
  const agentSlugs = new Set<string>();
  const ids: Record<'object' | 'artifact' | 'document', Set<number>> = { object: new Set(), artifact: new Set(), document: new Set() };
  for (const e of events) {
    if (e.actorKind === 'user' && e.actorId) {
      userIds.add(e.actorId);
    }
    if (e.actorKind === 'agent' && e.actorId) {
      agentSlugs.add(e.actorId);
    }
    if (e.onBehalfOf) {
      userIds.add(e.onBehalfOf);
    }
    const kind = e.recordKind as keyof typeof ids;
    if (e.recordId && kind in ids && /^\d+$/.test(e.recordId)) {
      ids[kind].add(Number(e.recordId));
    }
  }
  const [users, agents, objects, artifacts, documents] = await Promise.all([
    userIds.size ? db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, [...userIds])) : [],
    agentSlugs.size ? db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, [...agentSlugs]))) : [],
    ids.object.size ? db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, [...ids.object]))) : [],
    ids.artifact.size ? db.select({ id: artifactSchema.id, title: artifactSchema.title }).from(artifactSchema).where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.id, [...ids.artifact]))) : [],
    ids.document.size ? db.select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title }).from(knowledgeDocumentSchema).where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.id, [...ids.document]))) : [],
  ]);
  const actors: Record<string, string> = {};
  for (const u of users) {
    actors[u.id] = u.name?.trim() || u.email || u.id;
  }
  for (const a of agents) {
    actors[a.slug] = a.name;
  }
  const records: Record<string, string> = {};
  for (const o of objects) {
    records[`object:${o.id}`] = o.title;
  }
  for (const a of artifacts) {
    records[`artifact:${a.id}`] = a.title;
  }
  for (const d of documents) {
    if (d.title) {
      records[`document:${d.id}`] = d.title;
    }
  }
  return { actors, records };
}

export type AccessPruneResult = {
  deleted: number;
  /** True when the per-run cap stopped it with older rows still there; tomorrow's run continues. */
  moreRemaining: boolean;
  /** The age boundary applied. */
  cutoff: string;
};

/**
 * Delete reads older than the retention period, in bounded batches. A no-op
 * (null) when retention is off.
 * @param now - The clock, for tests.
 * @param retentionDays - Days kept; read from the environment by default.
 */
export async function pruneAccessEvents(now: Date = new Date(), retentionDays: number | null = accessLogRetentionDays()): Promise<AccessPruneResult | null> {
  if (retentionDays === null) {
    return null;
  }
  // Bounded here too, so no caller can hand the prune a date that does not exist.
  const days = Math.min(Math.max(retentionDays, 1), MAX_ACCESS_LOG_RETENTION_DAYS);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  let deleted = 0;
  for (let batch = 0; batch < PRUNE_BATCHES_PER_RUN; batch++) {
    const doomed = db
      .select({ id: accessEventSchema.id })
      .from(accessEventSchema)
      .where(lt(accessEventSchema.at, cutoff))
      .limit(PRUNE_BATCH);
    const gone = await db
      .delete(accessEventSchema)
      .where(and(lt(accessEventSchema.at, cutoff), inArray(accessEventSchema.id, doomed)))
      .returning({ id: accessEventSchema.id });
    deleted += gone.length;
    if (gone.length < PRUNE_BATCH) {
      return { deleted, moreRemaining: false, cutoff: cutoff.toISOString() };
    }
  }
  return { deleted, moreRemaining: true, cutoff: cutoff.toISOString() };
}
