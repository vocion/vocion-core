/**
 * update_object as the agent works it: absent for an agent with no object
 * types, refusing a type outside the agent's own list before anything is
 * proposed, and saying plainly whether the record changed or the write is
 * waiting for a person.
 */
import type { AgentEvent, RuntimeContext } from '../types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { updateObjectTools } = await import('./updateObject');
const { eq } = await import('drizzle-orm');

const ORG = 'org_update_object_tool';
let requestId = 0;

function ctxFor(objectTypeSlugs: string[]): RuntimeContext & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    orgId: ORG,
    userId: 'scheduled',
    agentSlug: 'product-manager',
    connectorSources: [],
    objectTypeSlugs,
    searchConfig: {},
    harnessConfig: {},
    citationSeq: { current: 0 },
    emit: e => events.push(e),
    events,
  } as RuntimeContext & { events: AgentEvent[] };
}

function toolFor(objectTypeSlugs: string[]) {
  const [t] = updateObjectTools(ctxFor(objectTypeSlugs));
  return t!;
}

beforeEach(async () => {
  forgetCachedObjectTypes();
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  const [type] = await db.insert(businessObjectTypeSchema).values({
    orgId: ORG,
    slug: 'request',
    label: 'Request',
    schema: { type: 'object', properties: { priority: { type: 'integer' }, state: { type: 'string', enum: ['new', 'in_scope'] } } },
  }).returning({ id: businessObjectTypeSchema.id });
  await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'product', label: 'Product', schema: { type: 'object', properties: { promises: { type: 'array' } } } });
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'CSV export', metadata: { state: 'new' } }).returning({ id: businessObjectSchema.id });
  requestId = row!.id;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
});

describe('presence and the ACL', () => {
  it('is absent for an agent with no object types, present with its writable types in the description', () => {
    expect(updateObjectTools(ctxFor([]))).toEqual([]);

    const t = toolFor(['request', 'product']);

    expect(t.name).toBe('update_object');
    expect(t.description).toMatch(/\(request, product\)/);
  });

  it('refuses a type outside the agent\'s objectTypes before anything is proposed', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'product', id: requestId, set: { promises: [] }, reason: 'r', confidence: 0.9 });

    expect(out).toBe('Refused: this agent does not work with "product" records. It may write: request. A type is added under objectTypes in the agent\'s YAML, not here.');
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });
});

describe('the write', () => {
  it('writes declared fields done-for-you and says the record changed', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { priority: 82, state: 'in_scope' }, reason: 'Seven asked.', confidence: 0.9 });

    expect(out).toMatch(/^request #\d+ "CSV export" updated — priority, state written \(run #\d+, confidence 0\.9\)\. Done for you/);

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));

    expect(row!.metadata).toEqual({ state: 'in_scope', priority: 82 });
  });

  it('says the write is waiting, not done, under the bar — and the record is untouched', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { priority: 82 }, reason: 'r', confidence: 0.3 });

    expect(out).toMatch(/PENDING a person's decision/);
    expect(out).toMatch(/Do NOT say the record changed/);

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));

    expect(row!.metadata).toEqual({ state: 'new' });
  });

  it('hands an unknown field back as a refusal naming the declared ones', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { severity: 'p1' }, reason: 'r', confidence: 0.9 });

    expect(out).toMatch(/^Update refused \(VALIDATION_FAILED\): Object type "request" declares no field "severity"\. Fields it declares: priority, state\. Add the field to the type before writing it\.$/);
  });
});

describe('the shape the model sends (backlog 006, 2026-09-25)', () => {
  it('reads `set` sent as JSON text as the object it is', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: '{"priority": 64}', reason: 'Asked twice.', confidence: 0.9 } as never);

    expect(out).toMatch(/updated — priority written/);
  });

  it('takes a write with no reason or confidence instead of throwing, and lets the ladder judge it', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { priority: 40 } } as never);

    expect(out).not.toMatch(/did not match expected schema/);
    expect(out).toMatch(/request #\d+/);
  });

  it('names the allowed values when a value is not one of them', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { state: 'shipping' }, reason: 'r', confidence: 0.9 });

    expect(out).toContain('"new", "in_scope"');
  });
});
