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

    expect(out).toBe(`Refused: product #${requestId} is not on the person's page, and this agent does not work with "product" records (it may write: request). Ask the person to open the record, or add the type under objectTypes in the agent's YAML.`);
    expect(await db.select().from(actionRunSchema)).toHaveLength(0);
  });

  it('writes the record on the person\'s page whatever the agent\'s objectTypes say (backlog 035)', async () => {
    const ctx = { ...ctxFor([]), pageContext: { path: `/dashboard/p/feature/${requestId}`, title: 'CSV export', record: { type: 'object' as const, id: String(requestId) } } };
    const [t] = updateObjectTools(ctx);

    expect(t).toBeDefined();

    const out = await t!.invoke({ object_type: 'request', id: requestId, set: { priority: 60 }, reason: 'The person asked for it on the feature page.', confidence: 0.95 });

    expect(out).toMatch(/updated — priority written/);

    const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, requestId));

    expect(row!.metadata).toMatchObject({ priority: 60 });
    // The page showing it hears about the new version.
    expect(ctx.events.find(e => e.type === 'version_written')).toMatchObject({ ref: { type: 'object', id: String(requestId) }, from: 1, to: 2, fields: ['priority'] });
  });
});

describe('the write', () => {
  it('writes declared fields done-for-you and says the record changed', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { priority: 82, state: 'in_scope' }, reason: 'Seven asked.', confidence: 0.9 });

    expect(out).toMatch(/^request #\d+ "CSV export" updated — priority, state written \(run #\d+, confidence 0\.9\), now version 2 of its history\. Done for you/);

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

  it('a change the person asked for runs as theirs, whatever the agent\'s confidence (Chris, 2026-09-29: "Delete the 246 feature request")', async () => {
    const { NO_INTENT } = await import('../turnJudge');
    const ctx = { ...ctxFor(['request']), userId: 'usr-owner', turnIntent: Promise.resolve({ ...NO_INTENT, changes_page_record: true, decides: true, wants_action: true }) } as RuntimeContext;
    const [t] = updateObjectTools(ctx);

    const out = await t!.invoke({ object_type: 'request', id: requestId, set: { priority: 82 }, reason: 'The person asked for it.', confidence: 0.3 });

    expect(out).toMatch(/updated — priority written/);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(run!.invokedBy).toBe('usr-owner');
    expect(run!.status).toBe('done');
  });

  it('a declared gate informs a change the person asked for, and the change lands (no hard stop)', async () => {
    const [gated] = await db.insert(businessObjectTypeSchema).values({
      orgId: ORG,
      slug: 'idea',
      label: 'Idea',
      schema: { 'type': 'object', 'properties': { state: { type: 'string' }, howWeCheck: { type: 'string' } }, 'x-gates': [{ name: 'decision-ready', when: { field: 'state', becomes: ['in_scope'] }, producedBy: 'product-manager', require: [{ field: 'howWeCheck', present: true, message: 'say how we will know it worked' }] }] },
    }).returning({ id: businessObjectTypeSchema.id });
    const [idea] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: gated!.id, title: 'Theme toggle', metadata: { state: 'new' } }).returning({ id: businessObjectSchema.id });
    const { NO_INTENT } = await import('../turnJudge');
    const asked = { ...ctxFor(['idea']), userId: 'usr-owner', turnIntent: Promise.resolve({ ...NO_INTENT, changes_page_record: true, decides: true }) } as RuntimeContext;

    // The agent's own call still meets the gate.
    const own = await toolFor(['idea']).invoke({ object_type: 'idea', id: idea!.id, set: { state: 'in_scope' }, reason: 'r', confidence: 0.9 });

    expect(own).toMatch(/decision-ready/);

    // On the person's word it lands.
    const out = await updateObjectTools(asked)[0]!.invoke({ object_type: 'idea', id: idea!.id, set: { state: 'in_scope' }, reason: 'Reopen it.', confidence: 0.9 });

    expect(out).toMatch(/updated — state written/);

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, idea!.id));

    expect(row!.metadata).toMatchObject({ state: 'in_scope' });
  });

  it('a pending write says where to act on it', async () => {
    const out = await toolFor(['request']).invoke({ object_type: 'request', id: requestId, set: { priority: 82 }, reason: 'r', confidence: 0.3 });

    expect(out).toMatch(/\[Review the change\]\(\/dashboard\/inbox\/proposal-\d+\)/);
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
