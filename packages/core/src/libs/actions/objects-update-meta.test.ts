/**
 * objects.update_meta — the promises a record write rests on: only declared
 * fields, each checked against its schema, never the row's own columns; a
 * confident write lands with the previous values on the run; a trust rule
 * holds it for a person; Undo puts the record back exactly.
 *
 * The fixture is the software factory's request shape, because it is the
 * first real caller; every field name here lives in the test's object type,
 * never in the action.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('./objects-propose-candidate');
const { objectsUpdateMetaAction, RESERVED_OBJECT_KEYS } = await import('./objects-update-meta');
const { listActions } = await import('./registry');
const { executeAction, proposeAction, undoAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_update_meta';
const OTHER_ORG = 'org_update_meta_other';

const REQUEST_SCHEMA = {
  type: 'object',
  required: ['title', 'kind'],
  properties: {
    title: { type: 'string' },
    kind: { type: 'string', enum: ['bug', 'gap', 'idea'] },
    state: { type: 'string', enum: ['new', 'triaged', 'in_scope'], title: 'State' },
    priority: { type: 'integer', minimum: 0, maximum: 100, title: 'Priority' },
    priorityReason: { type: 'string' },
    rankedAt: { type: 'string', format: 'date-time' },
    taskIds: { type: 'array', items: { type: 'integer' } },
  },
};

let requestTypeId = 0;
let requestId = 0;

function productManager(orgId = ORG): Principal {
  return { kind: 'agent', id: 'agent:product-manager', grants: ['update_object'], autonomy: 2, scope: { orgId } };
}

function update(set: Record<string, unknown>, confidence: number | undefined = 0.9, over: Record<string, unknown> = {}) {
  return proposeAction({
    orgId: ORG,
    actionId: 'objects.update_meta',
    principal: productManager(),
    invokedBy: 'agent:product-manager',
    input: { objectType: 'request', id: requestId, set, reason: 'Seven people asked; it is on the product\'s promises.', ...over },
    proposal: { confidence, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'ranked against the promises' },
  });
}

async function readMeta(id = requestId): Promise<Record<string, unknown>> {
  const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: REQUEST_SCHEMA }).returning({ id: businessObjectTypeSchema.id });
  requestTypeId = type!.id;
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: requestTypeId,
    title: 'CSV export of the ledger',
    status: 'active',
    metadata: { title: 'CSV export of the ledger', kind: 'gap', state: 'triaged' },
  }).returning({ id: businessObjectSchema.id });
  requestId = row!.id;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

describe('registration and the input contract', () => {
  it('is registered, internal, reversible, on the update_object grant', () => {
    expect(listActions().map(a => a.id)).toContain('objects.update_meta');
    expect(objectsUpdateMetaAction.external).toBe(false);
    expect(objectsUpdateMetaAction.undo).toBeDefined();
    expect(objectsUpdateMetaAction.grant).toBe('update_object');
  });

  it('requires at least one field and a reason, and coerces the id', () => {
    expect(() => objectsUpdateMetaAction.inputSchema.parse({ objectType: 'request', id: 1, set: {}, reason: 'why' })).toThrow(/at least one field/);
    expect(() => objectsUpdateMetaAction.inputSchema.parse({ objectType: 'request', id: 1, set: { priority: 1 } })).toThrow();

    const parsed = objectsUpdateMetaAction.inputSchema.parse({ objectType: 'request', id: '12', set: { priority: 1 }, reason: 'why' });

    expect(parsed.id).toBe(12);
  });

  it('keys the ladder on the object type, so each type earns on its own ledger', () => {
    const parsed = objectsUpdateMetaAction.inputSchema.parse({ objectType: ' Request ', id: 12, set: { priority: 1 }, reason: 'r' });

    expect(objectsUpdateMetaAction.policyKeyFor!(parsed)).toBe('objects.update_meta.request');
  });

  it('keys the queue on the record and the fields, so a re-score refreshes and a different write stands', () => {
    const key = (set: Record<string, unknown>) => objectsUpdateMetaAction.dedupKeyFor!(objectsUpdateMetaAction.inputSchema.parse({ objectType: 'Request', id: 12, set, reason: 'r' }));

    expect(key({ priorityReason: 'a', priority: 1 })).toBe('objects.update_meta:request:12:priority,priorityReason');
    expect(key({ state: 'in_scope' })).not.toBe(key({ priority: 1 }));
  });
});

describe('what may be written — the type is the contract', () => {
  it('refuses a field the type does not declare, naming the ones it does, and leaves no run behind', async () => {
    await expect(update({ severity: 'p1' })).rejects.toThrow(/declares no field "severity"\. Fields it declares: kind, priority, priorityReason, rankedAt, state, taskIds, title\./);

    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('refuses the row\'s own columns even when the type happens to declare one', async () => {
    // `title` is both a column and, in this type, a declared field: the
    // column wins, because the row's identity has its own path.
    await expect(update({ title: 'Renamed' })).rejects.toThrow(/title is not a field of the record but the row itself/);
    await expect(update({ status: 'approved', id: 4 })).rejects.toThrow(/id, status are not a field/);

    // And a type that states its order is listed in it.
    await db.update(businessObjectTypeSchema).set({ schema: { ...REQUEST_SCHEMA, propertyOrder: ['title', 'kind', 'state'] } }).where(eq(businessObjectTypeSchema.id, requestTypeId));
    forgetCachedObjectTypes();

    await expect(update({ severity: 'p1' })).rejects.toThrow(/Fields it declares: title, kind, state, priority, priorityReason, rankedAt, taskIds\./);

    expect(RESERVED_OBJECT_KEYS.has('title')).toBe(true);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('refuses a value outside the field\'s schema — an enum miss, a priority given as prose', async () => {
    await expect(update({ state: 'done' })).rejects.toThrow(/do not fit "request".*state must be equal to one of the allowed values/);
    await expect(update({ priority: 'high' })).rejects.toThrow(/priority must be integer/);

    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('does not fail a write for a required field the record already lacks', async () => {
    // `kind` is required on the type; the fixture has it, but a record
    // without it must still take a priority — the write is judged, not the
    // whole record.
    await db.update(businessObjectSchema).set({ metadata: { title: 'x' } }).where(eq(businessObjectSchema.id, requestId));

    const res = await update({ priority: 40 });

    expect(res.status).toBe('done');
  });

  it('refuses an unknown type, a record of another type, and another org\'s record', async () => {
    await expect(update({ priority: 1 }, 0.9, { objectType: 'product' })).rejects.toThrow(/No object type "product"/);
    await expect(update({ priority: 1 }, 0.9, { id: 99_999 })).rejects.toThrow(/No request #99999/);

    await db.insert(businessObjectTypeSchema).values({ orgId: OTHER_ORG, slug: 'request', label: 'Request', schema: REQUEST_SCHEMA });

    await expect(proposeAction({
      orgId: OTHER_ORG,
      actionId: 'objects.update_meta',
      principal: productManager(OTHER_ORG),
      input: { objectType: 'request', id: requestId, set: { priority: 1 }, reason: 'r' },
    })).rejects.toThrow(new RegExp(`No request #${requestId}`));

    expect(await readMeta()).not.toHaveProperty('priority');
  });
});

describe('done for you — a confident write lands with its history on the run', () => {
  it('merges the fields, clears on null, and records who, why and what was there before', async () => {
    const res = await update({ priority: 82, priorityReason: 'On the promise list; seven asked.', state: 'in_scope', taskIds: null });

    expect(res.status).toBe('done');
    expect(await readMeta()).toEqual({
      title: 'CSV export of the ledger',
      kind: 'gap',
      state: 'in_scope',
      priority: 82,
      priorityReason: 'On the promise list; seven asked.',
    });

    const result = res.result as Record<string, unknown>;

    expect(result).toMatchObject({
      objectId: requestId,
      objectType: 'request',
      title: 'CSV export of the ledger',
      updated: ['priority', 'priorityReason', 'state', 'taskIds'],
      previous: { priority: null, priorityReason: null, state: 'triaged', taskIds: null },
      set: { priority: 82, priorityReason: 'On the promise list; seven asked.', state: 'in_scope', taskIds: null },
      reason: 'Seven people asked; it is on the product\'s promises.',
      writtenBy: 'agent:product-manager',
      runId: res.runId,
    });
  });

  it('the card shows the record and before → after for each field, by the type\'s own labels', async () => {
    const card = await objectsUpdateMetaAction.reviewCard!(
      { orgId: ORG },
      objectsUpdateMetaAction.inputSchema.parse({ objectType: 'request', id: requestId, set: { state: 'in_scope', priority: 82 }, reason: 'r' }),
    );

    expect(card.title).toBe('Update request: CSV export of the ledger');
    expect(card.system).toBe('Request');
    expect(card.fields).toEqual([
      { label: 'Record', value: `CSV export of the ledger (#${requestId})`, href: '/dashboard/objects' },
      { label: 'State', value: 'triaged → in_scope' },
      { label: 'Priority', value: '82' },
    ]);
  });
});

describe('the gate — a trust rule holds a write for a person', () => {
  it('under the bar the write waits and the record is untouched; approval writes it, credited to the person', async () => {
    const res = await update({ priority: 82 }, 0.5);

    expect(res.status).toBe('pending');
    expect(await readMeta()).not.toHaveProperty('priority');

    const approved = await executeAction(res.runId, ORG, { reviewedBy: 'user_chris' });

    expect(approved.status).toBe('done');
    expect((await readMeta()).priority).toBe(82);
    expect((approved.result as { reviewedBy: string }).reviewedBy).toBe('user_chris');
  });

  it('a type with no rule reads the action\'s own default — low and reversible — under its derived key', async () => {
    // The ladder keys on `objects.update_meta.request`, which is registered
    // under no such id. The tier has to come from the action behind the key,
    // or every type nobody wrote a rule for would be high-risk and always ask.
    const res = await update({ priority: 82 }, 0.9);

    expect(res.status).toBe('done');

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, res.runId));

    expect(String((run!.proposal as { autoApprovedReason?: string }).autoApprovedReason)).toMatch(/reversible, low-risk/);
  });

  it('a workspace that parks writes to one type at approval holds every write to it, however confident, and no other type', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'objects.update_meta.request', threshold: 0.9, enabled: 'false' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'objects.update_meta.request', rung: 'execute-with-approval', riskTier: 'low', minConfidence: 0.9, source: 'trust.yaml' });

    const res = await update({ priority: 82 }, 0.99);

    expect(res.status).toBe('pending');
    expect(await readMeta()).not.toHaveProperty('priority');

    // Another type's writes are judged on their own ledger — the default.
    const [product] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object', properties: { promises: { type: 'array' } } } }).returning({ id: businessObjectTypeSchema.id });
    const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: product!.id, title: 'Ledger', metadata: {} }).returning({ id: businessObjectSchema.id });
    forgetCachedObjectTypes();

    const other = await update({ promises: ['export'] }, 0.9, { objectType: 'product', id: row!.id });

    expect(other.status).toBe('done');
  });

  it('a rule for the bare action id binds to nothing — the type\'s ledger is the rule', async () => {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'objects.update_meta', threshold: 0.9, enabled: 'false' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'objects.update_meta', rung: 'execute-with-approval', riskTier: 'low', minConfidence: 0.9, source: 'trust.yaml' });

    expect((await update({ priority: 82 }, 0.99)).status).toBe('done');
  });

  it('a value the type stopped accepting between proposal and approval does not land', async () => {
    const res = await update({ state: 'in_scope' }, 0.5);
    await db.update(businessObjectTypeSchema)
      .set({ schema: { ...REQUEST_SCHEMA, properties: { ...REQUEST_SCHEMA.properties, state: { type: 'string', enum: ['new', 'triaged'] } } } })
      .where(eq(businessObjectTypeSchema.id, requestTypeId));
    forgetCachedObjectTypes();

    const approved = await executeAction(res.runId, ORG, { reviewedBy: 'user_chris' });

    expect(approved.status).toBe('failed');
    expect(approved.error).toMatch(/do not fit "request"/);
    expect((await readMeta()).state).toBe('triaged');
  });
});

describe('undo — the record goes back exactly', () => {
  it('restores the previous values and removes a field that was not there', async () => {
    const res = await update({ priority: 82, state: 'in_scope' });

    const undone = await undoAction(res.runId, ORG, { by: 'user_chris' });

    expect(undone.status).toBe('undone');
    expect(await readMeta()).toEqual({ title: 'CSV export of the ledger', kind: 'gap', state: 'triaged' });
  });
});
