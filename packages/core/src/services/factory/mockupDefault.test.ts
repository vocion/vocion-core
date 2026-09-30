/**
 * Every new feature with a UI gets its mockup, hands-off — against PGlite.
 *
 * A request with a ui surface is filed: the plugin's automation marks it
 * drawing and raises `mockup.requested`, in the same call and holding nothing.
 * A drawing that ends with no mockup is tried once more, carrying why; a second
 * is written on the request. A mission check that throws now says so
 * (`automation_run.failed`). Every name is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// Whether this installation can draw, as the tests need it.
const renderer = vi.hoisted(() => ({ ok: true, reason: 'Chromium missing' }));
vi.mock('@/libs/documents/render', () => ({ renderAvailable: async () => (renderer.ok ? { ok: true } : { ok: false, reason: renderer.reason }) }));

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema, businessObjectSchema, eventLogSchema, toolCallSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { emitEvent } = await import('@/services/EventService');
const { defaultMockupEnded, mockupInfrastructureFailed, requestDefaultMockup, sweepDefaultMockups } = await import('./mockupDefault');
const { askSchema } = await import('@/models/Schema');

const ORG = 'org_mockup_default';
let typeId = 0;

/** The software-factory plugin's rule, as its automation's `do.input` carries it. */
const RULE = {
  owedWhen: { field: 'surface', oneOf: ['ui', 'flow'] },
  skipWhen: [{ field: 'kind', oneOf: ['bug', 'incident', 'question'] }, { field: 'state', oneOf: ['shipped', 'answered'] }],
  attempts: 2,
};

beforeAll(async () => {
  const [t] = await createObjectType({
    slug: 'request',
    label: 'Request',
    schema: { type: 'object', properties: { surface: { type: 'string' }, visuals: { type: 'object', properties: { mockupArtifactIds: { type: 'array' }, mockupDraw: { type: 'object' } } } } },
  } as never, ORG);
  typeId = t!.id;
  // The plugin's wiring, as the workspace applies it.
  await db.insert(automationSchema).values([
    { orgId: ORG, slug: 'design-mockup-default', name: 'A request with a UI has no mockup', status: 'active', whenConfig: { event: ['object.created', 'object.updated'], filter: { objectType: 'request' } }, doConfig: { job: 'mockup-default', input: RULE }, ownerAgentSlug: 'designer' },
    { orgId: ORG, slug: 'design-mockup-ended', name: 'A mockup drawing ended', status: 'active', whenConfig: { event: 'never.raised' }, doConfig: { job: 'mockup-ended', input: { attempts: 2, operator: 'ops-seat' } }, ownerAgentSlug: 'designer' },
    { orgId: ORG, slug: 'design-mockup', name: 'Draw the mockup a request owes', status: 'active', whenConfig: { event: 'mockup.requested', filter: { recordType: 'never-matches' } }, doConfig: { checkMission: 'show-it-first', requireTool: 'draw_mockup' } },
  ] as never);
});

async function request(meta: Record<string, unknown>, title = 'Remind a reader who has not opened the room') {
  const [row] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId, title, metadata: { kind: 'idea', state: 'new', ...meta } }).returning();
  return row!;
}

async function meta(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return (row!.metadata ?? {}) as Record<string, unknown>;
}

async function asked(id: number) {
  return (await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'mockup.requested'))))
    .filter(e => Number(e.payload.recordId) === id);
}

describe('filing a request with a UI asks for its mockup', () => {
  it('marks it drawing and asks the designer, through the plugin automation, in the filing call', async () => {
    const r = await request({ surface: 'ui' });

    await emitEvent({ orgId: ORG, type: 'object.created', payload: { objectId: r.id, objectType: 'request', title: r.title, source: 'proposal', conversationId: 5, actor: 'agent:product-manager', byPerson: true, orgId: ORG }, dedupeKey: `object.created:${r.id}` });

    const visuals = (await meta(r.id)).visuals as Record<string, unknown>;

    expect(visuals.mockupDraw).toMatchObject({ state: 'drawing', attempt: 1 });

    const events = await asked(r.id);

    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ recordId: r.id, recordType: 'request', title: r.title, attempt: 1 });
  });

  it('asks nothing for a surface nobody sees, a bug, a request that has mockups, or one being drawn', async () => {
    const api = await request({ surface: 'data' });
    const bug = await request({ surface: 'ui', kind: 'bug' });
    const drawn = await request({ surface: 'ui', visuals: { mockupArtifactIds: [11] } });
    const busy = await request({ surface: 'flow', visuals: { mockupDraw: { state: 'drawing', attempt: 1, at: new Date().toISOString() } } });

    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: api.id, objectType: 'request' })).did).toBe('no UI to draw: surface is data');
    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: bug.id, objectType: 'request' })).did).toBe('kind is bug');
    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: drawn.id, objectType: 'request' })).did).toBe('it already has mockups');
    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: busy.id, objectType: 'request' })).did).toBe('already being drawn (attempt 1)');

    for (const r of [api, bug, drawn, busy]) {
      expect(await asked(r.id)).toHaveLength(0);
    }
  });

  it('asks when triage gives a request its UI surface later, and not for a write that did not touch it', async () => {
    const r = await request({});

    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: r.id, objectType: 'request' })).did).toBe('no UI to draw: surface is not set');

    await db.update(businessObjectSchema).set({ metadata: { ...(await meta(r.id)), surface: 'ui' } }).where(eq(businessObjectSchema.id, r.id));

    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: r.id, objectType: 'request', fields: 'acceptance,story' })).did).toBe('the write changed nothing the rule reads');
    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: r.id, objectType: 'request', fields: 'kind,surface' })).did).toBe('requested:1');
    expect(await asked(r.id)).toHaveLength(1);
  });
});

describe('a drawing that drew nothing', () => {
  async function fire(recordId: number, attempt: number, missionRunId: number) {
    const [run] = await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'design-mockup', kind: 'mission_check', status: 'ok', invokedBy: 'event:mockup.requested', input: { recordId, recordType: 'request', attempt }, targetRunId: missionRunId, finishedAt: new Date() } as never).returning();
    return run!.id;
  }

  it('is tried once more carrying the tool\'s own refusal, then written on the request', async () => {
    const r = await request({ surface: 'ui', visuals: { surfaceUrl: '/rooms', mockupDraw: { state: 'drawing', attempt: 1, at: new Date().toISOString() } } });
    await db.insert(toolCallSchema).values({ orgId: ORG, agentSlug: 'designer', tool: 'draw_mockup', input: { request_id: r.id, mockups: [] }, output: 'Nothing was drawn:\n- mockups[0] ("Default"): "Note: remind" is a note about the design, not part of the product.', missionRunId: 9101 } as never);

    const first = await defaultMockupEnded(ORG, { automationRunId: await fire(r.id, 1, 9101), slug: 'design-mockup', attempts: 2 });

    expect(first.did).toBe('retry:2');

    const retry = ((await meta(r.id)).visuals as Record<string, unknown>).mockupDraw as Record<string, unknown>;

    expect(retry).toMatchObject({ state: 'drawing', attempt: 2 });
    expect(String(retry.reason)).toContain('"Note: remind" is a note about the design');
    expect((await asked(r.id)).map(e => e.payload)).toEqual([expect.objectContaining({ attempt: 2, lastFailure: expect.stringContaining('last draw_mockup call drew nothing') })]);

    const second = await defaultMockupEnded(ORG, { automationRunId: await fire(r.id, 2, 9102), slug: 'design-mockup', attempts: 2 });

    expect(second.did).toBe('gave-up');

    const after = await meta(r.id);

    expect((after.visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'failed', attempt: 2, reason: 'the drawing run ended without calling draw_mockup' });
    // The visuals the person filed are untouched, and the page's Activity says it.
    expect((after.visuals as Record<string, unknown>).surfaceUrl).toBe('/rooms');
    expect(JSON.stringify(after.recovery)).toContain('The mockup was not drawn after 2 attempts: the drawing run ended without calling draw_mockup');
    // No third ask.
    expect(await asked(r.id)).toHaveLength(1);
  });

  it('carries the fire\'s own error, and is done when the mockups landed', async () => {
    const failed = await request({ surface: 'ui', visuals: { mockupDraw: { state: 'drawing', attempt: 2, at: new Date().toISOString() } } });
    const out = await defaultMockupEnded(ORG, { automationRunId: await fire(failed.id, 2, 9103), error: 'automation "design-mockup": mission "show-it-first" not found' });

    expect(out.did).toBe('gave-up');
    expect(((await meta(failed.id)).visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'failed', reason: 'automation "design-mockup": mission "show-it-first" not found' });

    const drawn = await request({ surface: 'ui', visuals: { mockupArtifactIds: [41] } });

    expect((await defaultMockupEnded(ORG, { automationRunId: await fire(drawn.id, 1, 9104) })).did).toBe('drawn');
  });
});

describe('a mission check that throws says so', () => {
  it('raises automation_run.failed with its error', async () => {
    const { fireAutomation } = await import('@/services/AutomationService');
    await db.insert(automationSchema).values({ orgId: ORG, slug: 'draws-nothing', name: 'x', status: 'active', whenConfig: { event: 'never.raised' }, doConfig: { checkMission: 'no-such-mission' } } as never);

    await expect(fireAutomation(ORG, 'draws-nothing', { input: { recordId: 1 } })).rejects.toThrow(/mission "no-such-mission" not found/);

    const [event] = await db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, ORG), eq(eventLogSchema.type, 'automation_run.failed')));

    expect(event?.payload).toMatchObject({ slug: 'draws-nothing', kind: 'mission_check', error: expect.stringContaining('no-such-mission') });
  });
});

describe('the hourly sweep', () => {
  it('asks again for an open UI request that never got its mockup, even one filed with a reason for none (#277)', async () => {
    const skippedAtFiling = await request({ surface: 'ui', kind: 'idea', visuals: { noVisualReason: 'Mockup owed from the designer before dispatch.' } }, 'Show when a room was last opened');
    const noUi = await request({ surface: 'data', kind: 'idea' }, 'Export room reads nightly');

    const out = await sweepDefaultMockups(ORG, { ...RULE, objectType: 'request' });

    expect(out.requested).toContain(skippedAtFiling.id);
    expect(out.requested).not.toContain(noUi.id);
    expect((await asked(skippedAtFiling.id)).length).toBeGreaterThan(0);

    // A second pass leaves the drawing it asked for alone.
    const again = await sweepDefaultMockups(ORG, { ...RULE, objectType: 'request' });

    expect(again.requested).not.toContain(skippedAtFiling.id);
  });
});

describe('an installation that cannot draw (#269)', () => {
  it('writes it on the record typed, tells the operator the reason once, and a second failure files nothing', async () => {
    const a = await request({ surface: 'ui', visuals: { mockupDraw: { state: 'drawing', attempt: 1, at: new Date().toISOString() } } }, 'Theme switch for visitors');
    const b = await request({ surface: 'ui' }, 'Copy link on each row');

    const first = await mockupInfrastructureFailed(ORG, a.id, 'the renderer is not available on this installation (Chromium missing)');
    const second = await mockupInfrastructureFailed(ORG, b.id, 'the renderer is not available on this installation (Chromium missing)');

    expect(first.asked).toBe(true);
    expect(second).toEqual({ asked: false, askId: first.askId });
    expect(((await meta(a.id)).visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'drawing', attempt: 1, cause: 'infrastructure' });
    // One that was not being drawn (asked for in chat) is written down as failed.
    expect(((await meta(b.id)).visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'failed', cause: 'infrastructure' });

    const asks = (await db.select().from(askSchema).where(eq(askSchema.orgId, ORG))).filter(x => String(x.sourceRef).startsWith('mockup-infrastructure:'));

    expect(asks).toHaveLength(1);
    // The operator the plugin names, with the detail; the record's page gets none of it.
    expect(asks[0]).toMatchObject({ agentSlug: 'ops-seat', status: 'open' });
    expect(asks[0]!.body).toContain('Chromium missing');

    // The fire ends: no retry into the same wall, and the account says only that it could not be drawn.
    const [run] = await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'design-mockup', kind: 'mission_check', status: 'ok', invokedBy: 'event:mockup.requested', input: { recordId: a.id, recordType: 'request', attempt: 1 }, finishedAt: new Date() } as never).returning();
    const ended = await defaultMockupEnded(ORG, { automationRunId: run!.id, attempts: 2 });

    expect(ended.did).toBe('gave-up');
    expect(await asked(a.id)).toHaveLength(0);

    const after = await meta(a.id);

    expect((after.visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'failed', cause: 'infrastructure' });
    expect(JSON.stringify(after.recovery)).not.toContain('Chromium');
  });
});

describe('once the installation can draw again', () => {
  it('draws an infrastructure failure again from the start — no attempt spent — only when it can, and closes the operator\'s ask', async () => {
    const r = await request({ surface: 'ui' }, 'Pin a room to the top of the list');
    const { askId } = await mockupInfrastructureFailed(ORG, r.id, 'the renderer is not available on this installation (Chromium missing)');

    renderer.ok = false;

    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: r.id, objectType: 'request' })).did).toBe('this installation still cannot draw');
    expect(await asked(r.id)).toHaveLength(0);

    renderer.ok = true;
    const out = await sweepDefaultMockups(ORG, { ...RULE, objectType: 'request' });

    expect(out.requested).toContain(r.id);
    expect(((await meta(r.id)).visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'drawing', attempt: 1 });
    expect((await asked(r.id)).map(e => e.payload.attempt)).toEqual([1]);

    const [ask] = await db.select().from(askSchema).where(eq(askSchema.id, askId!));

    expect(ask!.status).not.toBe('open');
  });

  it('gives a failure of no recorded kind one fresh attempt, and then never again (#269)', async () => {
    const legacy = await request({ surface: 'ui', visuals: { mockupDraw: { state: 'failed', attempt: 2, at: '2026-09-30T22:39:07Z', reason: 'its last draw_mockup call drew nothing — words nobody parses' } } }, 'Switch theme on a shared room');

    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: legacy.id, objectType: 'request' })).did).toBe('requested:1');

    // The fresh attempt draws nothing, twice: written down with its kind, and left.
    const fire = async (attempt: number) => (await db.insert(automationRunSchema).values({ orgId: ORG, slug: 'design-mockup', kind: 'mission_check', status: 'ok', invokedBy: 'event:mockup.requested', input: { recordId: legacy.id, recordType: 'request', attempt }, finishedAt: new Date() } as never).returning())[0]!.id;

    expect((await defaultMockupEnded(ORG, { automationRunId: await fire(1), error: 'refused', attempts: 2 })).did).toBe('retry:2');
    expect((await defaultMockupEnded(ORG, { automationRunId: await fire(2), error: 'refused', attempts: 2 })).did).toBe('gave-up');
    expect(((await meta(legacy.id)).visuals as Record<string, unknown>).mockupDraw).toMatchObject({ state: 'failed', attempt: 2, cause: 'content' });
    expect((await requestDefaultMockup(ORG, { ...RULE, objectId: legacy.id, objectType: 'request' })).did).toMatch(/^drew nothing after 2 attempts/);
  });
});
