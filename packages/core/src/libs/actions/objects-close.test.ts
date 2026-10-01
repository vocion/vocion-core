/**
 * objects.close — a record closes, or retires, for a reason its type declares.
 *
 * Conversations 417–422 (2026-10-01): "retire REPO-312", "Close FE-318 as
 * already fixed" and "Defer FE-318: it duplicates FE-314" had no path — the
 * row's status could not be written and the only closing state reached for
 * was the factory's gated `shipped`. These are the promises the path rests
 * on: the reasons are the type's, each writes what it declares, a candidate
 * is closed by rejecting its card, a person's word runs at once, and Undo puts
 * everything back.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, businessObjectSchema, businessObjectTypeSchema, trustRuleSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('./objects-propose-candidate');
const { closeDefinitionOf, closeFields, describeCloseReasons, objectsCloseAction } = await import('./objects-close');
const { objectsUpdateMetaAction } = await import('./objects-update-meta');
const { listActions } = await import('./registry');
const { proposeAction, undoAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_close';

// A fictional ticket type, closing the way a workspace might declare it.
const TICKET_SCHEMA = {
  'type': 'object',
  'x-close': {
    field: 'closedAs',
    note: 'closedNote',
    reasons: {
      fixed_elsewhere: { label: 'Already fixed elsewhere', set: { state: 'answered' } },
      duplicate: { label: 'Duplicate', ref: 'duplicateOf' },
      deferred: { label: 'Not now', set: { state: 'deferred' }, note: 'deferReason' },
    },
  },
  'x-gates': [{ name: 'contract-met', when: { field: 'state', becomes: ['shipped'] }, producedBy: 'qa', require: [{ field: 'verified', present: true, message: 'verify it' }] }],
  'properties': {
    state: { type: 'string', enum: ['new', 'building', 'shipped', 'answered', 'deferred'] },
    verified: { type: 'boolean' },
    closedAs: { type: 'string', enum: ['fixed_elsewhere', 'duplicate', 'deferred'] },
    closedNote: { type: 'string' },
    deferReason: { type: 'string' },
    duplicateOf: { type: 'integer' },
  },
};

const SERVICE_SCHEMA = {
  'type': 'object',
  'x-close': { field: 'closedAs', note: 'closedNote', reasons: { retired: { label: 'Retired', status: 'retired' } } },
  'properties': { url: { type: 'string' }, closedAs: { type: 'string' }, closedNote: { type: 'string' } },
};

let ticketType = 0;
let serviceType = 0;
let ticket = 0;
let other = 0;

const person: Principal = { kind: 'user', id: 'usr-qa', role: 'member', scope: { orgId: ORG } } as Principal;

function close(input: Record<string, unknown>, principal: Principal = person) {
  return proposeAction({
    orgId: ORG,
    actionId: 'objects.close',
    principal,
    invokedBy: principal.id,
    input,
    proposal: { confidence: 0.9, rationale: 'the person said so', suggestedDecision: 'approve', suggestedDecisionReason: 'asked' },
  });
}

async function row(id: number) {
  const [r] = await db.select({ status: businessObjectSchema.status, metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return { status: r!.status, metadata: (r!.metadata ?? {}) as Record<string, unknown> };
}

beforeEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
  const [t] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'ticket', label: 'Ticket', schema: TICKET_SCHEMA }).returning({ id: businessObjectTypeSchema.id });
  const [s] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'service', label: 'Service', schema: SERVICE_SCHEMA }).returning({ id: businessObjectTypeSchema.id });
  ticketType = t!.id;
  serviceType = s!.id;
  const [a] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: ticketType, title: 'Northwind portal returns 500 on sign-in', status: 'approved', metadata: { state: 'building' } }).returning({ id: businessObjectSchema.id });
  const [b] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: ticketType, title: 'Fix the Northwind image build', status: 'approved', metadata: { state: 'building' } }).returning({ id: businessObjectSchema.id });
  ticket = a!.id;
  other = b!.id;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('the definition is the type\'s', () => {
  it('is registered, internal, reversible, keyed per type', () => {
    expect(listActions().map(a => a.id)).toContain('objects.close');
    expect(objectsCloseAction.external).toBe(false);
    expect(objectsCloseAction.undo).toBeDefined();
    expect(objectsCloseAction.policyKeyFor?.(objectsCloseAction.inputSchema.parse({ objectType: 'Ticket', id: 1, closeAs: 'deferred', note: 'n' }))).toBe('objects.close.ticket');
  });

  it('reads the reasons and what each writes from the schema', () => {
    const def = closeDefinitionOf(TICKET_SCHEMA)!;

    expect(Object.keys(def.reasons)).toEqual(['fixed_elsewhere', 'duplicate', 'deferred']);
    expect(closeFields(def, { closeAs: 'deferred', note: 'after the launch' })).toEqual({ state: 'deferred', closedAs: 'deferred', closedNote: 'after the launch', deferReason: 'after the launch' });
    expect(closeFields(def, { closeAs: 'duplicate', note: 'same fix', ref: 9 })).toEqual({ closedAs: 'duplicate', closedNote: 'same fix', duplicateOf: 9 });
    expect(describeCloseReasons(def)).toContain('duplicate (Duplicate; needs the other record, written to duplicateOf)');
    expect(closeDefinitionOf({ type: 'object' })).toBeNull();
  });
});

describe('closing on the person\'s word', () => {
  it('closes as fixed elsewhere through the state the reason names, never the gated one, and Undo reopens it', async () => {
    const res = await close({ objectType: 'ticket', id: ticket, closeAs: 'fixed_elsewhere', note: 'A revert outside the factory fixed it.' });

    expect(res.status).toBe('done');
    expect((await row(ticket)).metadata).toMatchObject({ state: 'answered', closedAs: 'fixed_elsewhere', closedNote: 'A revert outside the factory fixed it.' });

    await undoAction(res.runId, ORG, { by: 'usr-qa' });

    const back = (await row(ticket)).metadata;

    expect(back.state).toBe('building');
    expect(back.closedAs ?? null).toBeNull();
  });

  it('a duplicate names the record it duplicates, and is refused without one', async () => {
    await expect(close({ objectType: 'ticket', id: ticket, closeAs: 'duplicate', note: 'same fix' })).rejects.toThrow(/names the other record/);

    const res = await close({ objectType: 'ticket', id: ticket, closeAs: 'duplicate', note: 'same fix', ref: other });

    expect(res.status).toBe('done');
    expect((await row(ticket)).metadata).toMatchObject({ duplicateOf: other, closedAs: 'duplicate' });
  });

  it('a reason the type does not declare is refused with the ones it does', async () => {
    await expect(close({ objectType: 'ticket', id: ticket, closeAs: 'shipped', note: 'x' })).rejects.toThrow(/It closes as: .*fixed_elsewhere \(Already fixed elsewhere\)/);
  });

  it('retires a record by its row status, and Undo makes it active again', async () => {
    const [svc] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: serviceType, title: 'kestrel/api', status: 'active', metadata: { url: 'https://example.com/kestrel/api' } }).returning({ id: businessObjectSchema.id });
    const res = await close({ objectType: 'service', id: svc!.id, closeAs: 'retired', note: 'The repository does not exist.' });

    expect((await row(svc!.id)).status).toBe('retired');
    expect((await row(svc!.id)).metadata).toMatchObject({ closedAs: 'retired', closedNote: 'The repository does not exist.' });

    await undoAction(res.runId, ORG, { by: 'usr-qa' });

    expect((await row(svc!.id)).status).toBe('active');
  });

  it('a candidate nobody approved is closed by rejecting its card, whoever filed it, and Undo puts the card back', async () => {
    const [card] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.propose_candidate', status: 'pending', input: { objectType: 'service' }, invokedBy: 'agent:planner' }).returning({ id: actionRunSchema.id });
    const [svc] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: serviceType, title: 'contoso/monorepo', status: 'candidate', reviewActionRunId: card!.id, metadata: {} }).returning({ id: businessObjectSchema.id });

    const res = await close({ objectType: 'service', id: svc!.id, closeAs: 'retired', note: 'That repository does not exist.' });

    const [decided] = await db.select({ status: actionRunSchema.status, decidedBy: actionRunSchema.decidedBy }).from(actionRunSchema).where(eq(actionRunSchema.id, card!.id));

    expect(decided).toEqual({ status: 'rejected', decidedBy: 'usr-qa' });
    expect((await row(svc!.id)).status).toBe('rejected');

    await undoAction(res.runId, ORG, { by: 'usr-qa' });

    const [again] = await db.select({ status: actionRunSchema.status }).from(actionRunSchema).where(eq(actionRunSchema.id, card!.id));

    expect(again?.status).toBe('pending');
    expect((await row(svc!.id)).status).toBe('candidate');
  });
});

describe('the field write points at the path', () => {
  it('refusing `status` names close_record and the reasons', async () => {
    const refusal = await objectsUpdateMetaAction.precheck!({ orgId: ORG }, { objectType: 'service', id: 1, set: { status: 'retired' }, reason: 'r' });

    expect(refusal).toMatch(/call close_record with one of: retired/);
  });

  it('a gate refusing `shipped` says how to close it without that work', async () => {
    const refusal = await objectsUpdateMetaAction.precheck!({ orgId: ORG }, { objectType: 'ticket', id: ticket, set: { state: 'shipped' }, reason: 'r' });

    expect(refusal).toMatch(/call close_record instead, with one of: .*fixed_elsewhere/);
  });
});
