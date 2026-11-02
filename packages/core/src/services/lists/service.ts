import type { SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { ListField } from '@/libs/lists/spec';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { aggregateListSchema, canReadList, configureListSchema, createListSchema, listFieldsSchema, readListSchema, validateListValues, writeListSchema } from '@/libs/lists/spec';
import { workspaceListSchema as lists, listRecordSchema as records, listRevisionSchema as revisions } from '@/models/Schema';
import { actAs } from '@/services/workspace/actAs';
import { memberWorkspace } from '@/services/WorkspaceAccessService';

export type ListActor = { orgId: string; userId: string; personalAccess?: boolean };
type List = typeof lists.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, 'select'>;

export class ListError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

async function identity(actor: ListActor) {
  const found = actor.userId && await actAs(actor.userId, actor.orgId);
  if (!found) {
    throw new ListError('Not found', 404);
  }
  return { ...found, workspaceKind: (await memberWorkspace(actor.userId, actor.orgId))?.kind };
}

function visibility(actor: ListActor) {
  return and(eq(lists.projectId, actor.orgId), actor.personalAccess === false ? eq(lists.scope, 'workspace') : or(eq(lists.scope, 'workspace'), eq(lists.ownerId, actor.userId)))!;
}

async function accessible(reader: Reader, actor: ListActor, id: string, shareLock = false): Promise<List> {
  const query = reader.select().from(lists).where(and(eq(lists.id, id), visibility(actor))).limit(1);
  const [list] = await (shareLock ? query.for('share') : query);
  if (!list || !canReadList(list, actor)) {
    throw new ListError('Not found', 404);
  }
  return list;
}

async function referenceTargets(reader: Reader, actor: ListActor, list: Pick<List, 'scope'>, fields: ListField[]) {
  for (const field of fields.filter(f => f.type === 'reference')) {
    const target = await accessible(reader, actor, field.referenceListId!, true);
    if (list.scope === 'workspace' && target.scope !== 'workspace') {
      throw new ListError('A shared List cannot reference a personal List');
    }
  }
}

async function audit(tx: Transaction, actor: ListActor, id: string, version: number, change: Record<string, unknown>) {
  await tx.insert(revisions).values({ listId: id, version, actorId: actor.userId, change });
}

/**
 * Lists are scoped here, including every tool, API, page and history read.
 * @param actor
 * @param offset
 */
export async function listLists(actor: ListActor, offset = 0) {
  const who = await identity(actor);
  const items = await db.select().from(lists).where(visibility(actor)).orderBy(desc(lists.updatedAt), asc(lists.id)).limit(51).offset(Math.max(0, offset));
  return { items: items.slice(0, 50), nextOffset: items.length > 50 ? offset + 50 : null, canManageWorkspace: who.role === 'admin' };
}

export async function createList(actor: ListActor, input: z.input<typeof createListSchema>) {
  const args = createListSchema.parse(input);
  const who = await identity(actor);
  if (args.scope === 'personal' && actor.personalAccess === false) {
    throw new ListError('Create personal Lists in your personal assistant. This conversation is shared.', 403);
  }
  if (args.scope === 'workspace' && who.role !== 'admin') {
    throw new ListError('An admin creates workspace Lists. You can create a personal List.', 403);
  }
  return db.transaction(async (tx) => {
    await referenceTargets(tx, actor, args, args.fields);
    const [created] = await tx.insert(lists).values({ ...args, projectId: actor.orgId, ownerId: actor.userId }).onConflictDoNothing().returning();
    if (!created) {
      const existing = await accessible(tx, actor, args.id);
      if (existing.ownerId !== actor.userId || existing.title !== args.title || existing.purpose !== args.purpose || existing.scope !== args.scope || !isDeepStrictEqual(existing.fields, args.fields)) {
        throw new ListError('Request ID already used; read the existing List or use a new ID', 409);
      }
      return existing;
    }
    await audit(tx, actor, created.id, 1, { created });
    return created;
  });
}

function whereRecords(list: List, filters: z.infer<typeof readListSchema>['filters']): SQL {
  const conditions: SQL[] = [eq(records.listId, list.id)];
  for (const filter of filters) {
    validateListValues(list.fields, { [filter.field]: filter.value });
    conditions.push(filter.value === null
      ? sql`(${records.values} -> ${filter.field} is null or ${records.values} -> ${filter.field} = 'null'::jsonb)`
      : sql`${records.values} -> ${filter.field} = ${JSON.stringify(filter.value)}::jsonb`);
  }
  return and(...conditions)!;
}

export async function readList(actor: ListActor, input: z.input<typeof readListSchema>) {
  const args = readListSchema.parse(input);
  const who = await identity(actor);
  // One snapshot: the returned version must describe the returned rows.
  return db.transaction(async (tx) => {
    const list = await accessible(tx, actor, args.id);
    const view = args.view ? list.views.find(v => v.name === args.view) : undefined;
    if (args.view && !view) {
      throw new ListError('Unknown view');
    }
    const where = whereRecords(list, [...(view?.filters ?? []), ...args.filters]);
    const sort = view?.sortBy ? sql`${records.values} -> ${view.sortBy}` : records.id;
    const rows = await tx.select().from(records).where(where).orderBy(view?.descending ? desc(sort) : asc(sort), asc(records.id)).limit(args.limit).offset(args.offset);
    const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(records).where(where);
    const history = await tx.select().from(revisions).where(eq(revisions.listId, list.id)).orderBy(desc(revisions.version)).limit(20);
    return { list, rows, total: count!.total, offset: args.offset, history, canConfigure: list.scope === 'personal' ? list.ownerId === actor.userId : who.role === 'admin', canPromote: list.scope === 'personal' && who.role === 'admin' && who.workspaceKind === 'shared' };
  }, { isolationLevel: 'repeatable read' });
}

async function lock(tx: Transaction, actor: ListActor, id: string, version: number) {
  const [list] = await tx.select().from(lists).where(and(eq(lists.id, id), visibility(actor))).for('update');
  if (!list) {
    throw new ListError('Not found', 404);
  }
  if (list.version !== version) {
    throw new ListError('This List changed. Read it again before saving; your changes were not applied.', 409);
  }
  return list;
}

export async function writeListRecords(actor: ListActor, input: z.input<typeof writeListSchema>) {
  const args = writeListSchema.parse(input);
  await identity(actor);
  if (new Set(args.records.map(r => r.id)).size !== args.records.length) {
    throw new ListError('Record IDs must be unique within a batch');
  }
  return db.transaction(async (tx) => {
    const list = await lock(tx, actor, args.id, args.expectedVersion);
    if (list.archived) {
      throw new ListError('Restore this List before editing it');
    }
    await referenceTargets(tx, actor, list, list.fields);
    const changes = [];
    for (const row of args.records) {
      const [before] = await tx.select().from(records).where(and(eq(records.id, row.id), eq(records.listId, list.id)));
      const values = { ...before?.values, ...row.values };
      validateListValues(list.fields, values);
      for (const field of list.fields.filter(f => f.type === 'reference' && values[f.key] !== null && values[f.key] !== undefined)) {
        const [linked] = await tx.select({ id: records.id }).from(records).where(and(eq(records.listId, field.referenceListId!), eq(records.id, String(values[field.key]))));
        if (!linked) {
          throw new ListError(`Unknown record for ${field.key}`);
        }
      }
      if (before) {
        await tx.update(records).set({ values, version: before.version + 1, updatedAt: new Date() }).where(and(eq(records.id, row.id), eq(records.listId, list.id)));
      } else {
        const [inserted] = await tx.insert(records).values({ id: row.id, listId: list.id, values }).onConflictDoNothing().returning({ id: records.id });
        if (!inserted) {
          throw new ListError('Record ID unavailable; use a new ID', 409);
        }
      }
      changes.push({ id: row.id, before: before?.values ?? null, after: values });
    }
    const version = list.version + 1;
    await tx.update(lists).set({ version, updatedAt: new Date() }).where(eq(lists.id, list.id));
    await audit(tx, actor, list.id, version, { records: changes });
    return { id: list.id, version, written: changes.length };
  });
}

export async function configureList(actor: ListActor, input: z.input<typeof configureListSchema>) {
  const args = configureListSchema.parse(input);
  const who = await identity(actor);
  const destination = args.targetWorkspaceId && args.targetWorkspaceId !== actor.orgId
    ? await identity({ ...actor, orgId: args.targetWorkspaceId })
    : null;
  if (destination && (destination.role !== 'admin' || args.scope !== 'workspace' || destination.workspaceKind !== 'shared')) {
    throw new ListError('Publish only to a shared workspace you administer.', 403);
  }
  return db.transaction(async (tx) => {
    const before = await lock(tx, actor, args.id, args.expectedVersion);
    if (destination && (before.scope !== 'personal' || before.ownerId !== actor.userId)) {
      throw new ListError('Only your own personal List can move to another workspace.', 403);
    }
    if (!destination && (before.scope === 'workspace' || args.scope === 'workspace') && who.role !== 'admin') {
      throw new ListError('Only an admin can change shared List definitions or publish a personal List.', 403);
    }
    if (destination) {
      const [incoming] = await tx.select({ id: lists.id }).from(lists).where(and(eq(lists.projectId, actor.orgId), sql`${lists.fields} @> ${JSON.stringify([{ referenceListId: before.id }])}::jsonb`)).limit(1);
      if (incoming) {
        throw new ListError('Another List links here. Move or remove those relationships before publishing to another workspace.');
      }
    }
    const fields = listFieldsSchema.parse([...before.fields, ...args.addFields]);
    const views = args.views ?? before.views;
    if (new Set(views.map(v => v.name)).size !== views.length) {
      throw new ListError('View names must be unique');
    }
    for (const view of views) {
      for (const key of [...view.columns, ...(view.sortBy ? [view.sortBy] : [])]) {
        if (!fields.some(f => f.key === key)) {
          throw new ListError(`Unknown view field: ${key}`);
        }
      }
      for (const filter of view.filters) {
        validateListValues(fields, { [filter.field]: filter.value });
      }
    }
    const scope = args.scope ?? before.scope;
    const targetActor = destination ? { ...actor, orgId: destination.orgId } : actor;
    await referenceTargets(tx, targetActor, { scope }, fields);
    const [after] = await tx.update(lists).set({ fields, views, scope, projectId: targetActor.orgId, title: args.title ?? before.title, archived: args.archived ?? before.archived, version: before.version + 1, updatedAt: new Date() }).where(eq(lists.id, before.id)).returning();
    await audit(tx, actor, before.id, after!.version, { before, after });
    return after!;
  });
}

/**
 * Aggregates run in SQL across every matching row, never the displayed page.
 * @param actor
 * @param input
 */
export async function aggregateList(actor: ListActor, input: z.input<typeof aggregateListSchema>) {
  const args = aggregateListSchema.parse(input);
  await identity(actor);
  return db.transaction(async (tx) => {
    const list = await accessible(tx, actor, args.id);
    if (args.groupBy && !list.fields.some(f => f.key === args.groupBy)) {
      throw new ListError('Unknown grouping field');
    }
    if (args.sum && !list.fields.some(f => f.key === args.sum && f.type === 'number')) {
      throw new ListError('Sum requires a numeric field');
    }
    const group = args.groupBy ? sql`${records.values} -> ${args.groupBy}` : sql`null::jsonb`;
    const rows = await tx.select({ group, count: sql<number>`count(*)::int`, sum: args.sum ? sql<string | null>`sum((${records.values} ->> ${args.sum})::numeric)` : sql<null>`null` })
      .from(records)
      .where(whereRecords(list, args.filters))
      .groupBy(group)
      .orderBy(group)
      .limit(501);
    return { groups: rows.slice(0, 500), truncated: rows.length > 500, note: 'Counts and sums include all matching records in each returned group.' };
  }, { isolationLevel: 'repeatable read' });
}
