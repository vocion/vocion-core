/**
 * objects.create_group — a record and the records that point at it, created
 * in one transaction: all of them, or none.
 *
 * Setup suggests a first group at a time (a parent and the children that
 * belong to it), and the person's one tap on the choice option is the
 * approval, so the records are born `active`, not as candidates waiting in a
 * queue. Domain-free like its sibling `objects.propose_candidate`: the caller
 * names the type slugs, and `link` says which child field holds the parent's
 * value. Core never learns what either record is.
 *
 * Identity comes from each type's own `x-agent-file.dedupOn`, read the way
 * the filing tools read it, and compared with the same dedup key the
 * candidate path writes. A group already created therefore creates nothing the
 * second time, and an existing parent is reused rather than doubled.
 *
 * Not external: it writes only inside Vocion, which is what lets a choice
 * option carry it (`libs/actions/bindable.ts`).
 */

import type { ObjectTypeRow } from './objects-propose-candidate';
import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { createdStatus } from '@/libs/objects/statusModel';
import { candidateDedupKey, loadObjectType } from './objects-propose-candidate';

const CREATE_GROUP_ACTION_ID = 'objects.create_group';

const groupMember = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
});

export const objectsCreateGroupInput = z.object({
  /** The record the group is about. */
  parent: groupMember,
  /** Records that point at the parent. */
  children: z.array(groupMember).max(50),
  /** The child field that holds the parent's link value, and which parent field supplies it. */
  link: z.object({ childField: z.string().min(1), parentField: z.string().min(1) }),
});

type GroupInput = z.infer<typeof objectsCreateGroupInput>;
type GroupMember = z.infer<typeof groupMember>;
type DbTransaction = Parameters<Parameters<(typeof import('@/libs/DB'))['db']['transaction']>[0]>[0];

type Landed = { id: number; title: string; created: boolean };

/** Where each type's records already stand, by dedup key, while a group is written. */
type KnownRecords = Map<string, number>;

/**
 * The fields that identify a record of this type, from its opt-in to agent filing.
 * @param type - The stored object type.
 * @returns The `dedupOn` fields, or null when the type never opted in.
 */
async function identityFieldsOf(type: ObjectTypeRow): Promise<string[] | null> {
  const { filingTypeOf } = await import('@/services/agents/tools/fileRecord');
  const filing = filingTypeOf({ slug: type.slug, label: type.label, schema: type.schema });
  return filing ? filing.dedupOn : null;
}

/**
 * The dedup key one record would be stored under.
 * @param type - The record's type slug.
 * @param identityFields - The type's `dedupOn`.
 * @param title - The record's title.
 * @param fields - The record's fields.
 */
function keyOf(type: string, identityFields: string[], title: string, fields: Record<string, unknown>): string | undefined {
  return candidateDedupKey({ objectType: type, dedupOn: identityFields, title, fields });
}

/**
 * Records of this type already in the workspace, keyed the way a new one would be.
 * A rejected record does not count: the person said no to that one.
 * @param tx - The open transaction.
 * @param orgId - The workspace.
 * @param type - The stored object type.
 * @param identityFields - The type's `dedupOn`.
 */
async function knownRecordsOf(tx: DbTransaction, orgId: string, type: ObjectTypeRow, identityFields: string[]): Promise<KnownRecords> {
  const { and, eq, ne } = await import('drizzle-orm');
  const { businessObjectSchema } = await import('@/models/Schema');
  const rows = await tx
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, type.id), ne(businessObjectSchema.status, 'rejected')));
  const known: KnownRecords = new Map();
  for (const row of rows) {
    const key = keyOf(type.slug, identityFields, row.title, row.metadata ?? {});
    if (key && !known.has(key)) {
      known.set(key, row.id);
    }
  }
  return known;
}

/**
 * Use the record when it already exists, create it when it does not.
 * @param tx - The open transaction.
 * @param ctx - Action context; supplies the org and who approved.
 * @param type - The member's stored object type.
 * @param identityFields - The type's `dedupOn`.
 * @param known - Records already standing; a created one is added so twins in one group collapse.
 * @param member - The record to land.
 */
async function landMember(tx: DbTransaction, ctx: ActionContext, type: ObjectTypeRow, identityFields: string[], known: KnownRecords, member: GroupMember): Promise<Landed> {
  const key = keyOf(type.slug, identityFields, member.title, member.fields);
  const existingId = key ? known.get(key) : undefined;
  if (existingId !== undefined) {
    return { id: existingId, title: member.title, created: false };
  }
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await tx.insert(businessObjectSchema).values({
    orgId: ctx.orgId,
    typeId: type.id,
    title: member.title,
    status: 'active',
    metadata: createdStatus(type.schema, { ...member.fields }),
    createdBy: ctx.reviewedBy ?? ctx.invokedBy ?? null,
  }).returning({ id: businessObjectSchema.id });
  if (key) {
    known.set(key, row!.id);
  }
  return { id: row!.id, title: member.title, created: true };
}

/**
 * Everything the group writes, inside the caller's transaction. Any throw
 * rolls back every record already written here.
 * @param tx - The open transaction.
 * @param ctx - Action context.
 * @param input - The parsed group.
 * @param types - The parent's type, then each distinct child type, by slug.
 */
async function writeGroup(tx: DbTransaction, ctx: ActionContext, input: GroupInput, types: Map<string, ObjectTypeRow>): Promise<{ parent: Landed; children: Landed[] }> {
  const knownByType = new Map<string, { known: KnownRecords; identityFields: string[] }>();
  for (const [slug, type] of types) {
    const identityFields = (await identityFieldsOf(type)) ?? ['title'];
    knownByType.set(slug, { known: await knownRecordsOf(tx, ctx.orgId, type, identityFields), identityFields });
  }

  const parentSide = knownByType.get(input.parent.type)!;
  const parent = await landMember(tx, ctx, types.get(input.parent.type)!, parentSide.identityFields, parentSide.known, input.parent);

  const linkValue = input.parent.fields[input.link.parentField];
  const children: Landed[] = [];
  for (const child of input.children) {
    const side = knownByType.get(child.type)!;
    const linked = { ...child, fields: { ...child.fields, [input.link.childField]: linkValue } };
    children.push(await landMember(tx, ctx, types.get(child.type)!, side.identityFields, side.known, linked));
  }
  return { parent, children };
}

/**
 * Each distinct type the group names, loaded for the workspace.
 * @param orgId - The workspace.
 * @param input - The parsed group.
 * @returns The types by slug, and the slugs the workspace does not define.
 */
async function loadGroupTypes(orgId: string, input: GroupInput): Promise<{ types: Map<string, ObjectTypeRow>; missing: string[] }> {
  const slugs = [...new Set([input.parent.type, ...input.children.map(child => child.type)])];
  const types = new Map<string, ObjectTypeRow>();
  const missing: string[] = [];
  for (const slug of slugs) {
    const type = await loadObjectType(orgId, slug);
    if (type) {
      types.set(slug, type);
    } else {
      missing.push(slug);
    }
  }
  return { types, missing };
}

/**
 * Say each record the group created, once the transaction has committed.
 * @param ctx - Action context.
 * @param input - The parsed group.
 * @param landed - What the transaction wrote.
 * @param landed.parent - The parent's outcome.
 * @param landed.children - Each child's outcome, in input order.
 */
async function announceCreated(ctx: ActionContext, input: GroupInput, landed: { parent: Landed; children: Landed[] }): Promise<void> {
  const { announceObjectCreated } = await import('@/services/objects/objectCreated');
  const origin = {
    source: 'proposal' as const,
    conversationId: ctx.origin?.conversationId ?? null,
    actor: ctx.origin?.userId ?? ctx.reviewedBy ?? ctx.invokedBy ?? null,
    byPerson: ctx.origin ? ctx.origin.byPerson === true : Boolean(ctx.reviewedBy),
  };
  if (landed.parent.created) {
    await announceObjectCreated(ctx.orgId, landed.parent, input.parent.type, origin);
  }
  for (const [index, child] of landed.children.entries()) {
    if (child.created) {
      await announceObjectCreated(ctx.orgId, child, input.children[index]!.type, origin);
    }
  }
}

export const objectsCreateGroupAction: Action<typeof objectsCreateGroupInput> = {
  id: CREATE_GROUP_ACTION_ID,
  name: 'Create a record and its related records',
  description: 'Create one record and the records that point at it, together or not at all. Anything already there is reused, so running it twice creates nothing new. Reversible: undo removes only what this run created.',
  inputSchema: objectsCreateGroupInput,
  // The grant filing these records needs today: file_<type> proposes through
  // objects.propose_candidate, which asks for this one.
  grant: 'propose_candidate',
  external: false,
  dedupKeyFor: input => `${CREATE_GROUP_ACTION_ID}:${input.parent.type}:${String(input.parent.fields[input.link.parentField] ?? input.parent.title).toLowerCase()}`,

  async precheck(ctx, input) {
    const { types, missing } = await loadGroupTypes(ctx.orgId, input);
    if (missing.length > 0) {
      return `This workspace has no object type ${missing.map(slug => `"${slug}"`).join(' or ')}. Enable the plugin that defines it first.`;
    }
    for (const [slug, type] of types) {
      if (!(await identityFieldsOf(type))) {
        return `Object type "${slug}" does not say how to tell one record from another (no x-agent-file dedupOn), so a group of it cannot be created without risking doubles.`;
      }
    }
    if (!(input.link.parentField in input.parent.fields)) {
      return `The ${input.parent.type} has no "${input.link.parentField}" field to link its records by. Give it one, or name a field it has.`;
    }
    return undefined;
  },

  async execute(ctx, input) {
    const { db } = await import('@/libs/DB');
    const { types, missing } = await loadGroupTypes(ctx.orgId, input);
    if (missing.length > 0) {
      throw new Error(`This workspace has no object type ${missing.map(slug => `"${slug}"`).join(' or ')}; nothing was created.`);
    }
    // One-line callback into a module-level function: db.transaction offers
    // no other way to hand over the open transaction.
    const landed = await db.transaction(tx => writeGroup(tx, ctx, input, types));
    await announceCreated(ctx, input, landed);
    return {
      parent: { id: landed.parent.id, created: landed.parent.created },
      children: landed.children.map(child => ({ id: child.id, title: child.title, created: child.created })),
    };
  },

  async undo(ctx, _input, result) {
    const { and, eq, inArray } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectSchema } = await import('@/models/Schema');
    const parent = result.parent as { id: number; created: boolean };
    const children = result.children as Array<{ id: number; created: boolean }>;
    const createdIds = [parent, ...children].filter(record => record.created).map(record => record.id);
    if (createdIds.length > 0) {
      await db.delete(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, ctx.orgId), inArray(businessObjectSchema.id, createdIds)));
    }
    return { removed: createdIds.length };
  },
};
