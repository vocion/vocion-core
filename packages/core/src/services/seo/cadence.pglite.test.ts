/**
 * New page opportunities on a cadence, on PGlite: the SEO app installs its
 * weekly check listed and its background hand-off as system plumbing, both
 * stamped with the app that installed them; a project's pages a month are a
 * person's setting no agent or token can move; the weekly check queues work
 * only for a project behind pace and nothing for one on pace or without a
 * cadence; and the plan it asks for is a normal keyword plan sign-off, sized
 * in code. Every client and person here is fictional.
 */
import type { NextRequest } from 'next/server';
import type { RuntimeContext } from '@/services/agents/types';
import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
// These tests read the hand-off as the event it raises for a workspace not
// yet on the pipeline's workflows (`pipeline.ts`); the workflows are tested
// in pipeline.pglite.test.ts.
vi.mock('./pipeline', async importOriginal => ({ ...await importOriginal<typeof import('./pipeline')>(), startSeoPipeline: vi.fn(async () => false) }));
// The strategist is woken by an event; record it rather than run an agent.
const emitted = vi.hoisted(() => [] as Array<{ type: string; payload?: Record<string, unknown>; dedupeKey?: string }>);
vi.mock('@/services/EventService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/EventService')>();
  return { ...actual, emitEvent: vi.fn(async (input: { type: string; payload?: Record<string, unknown> }) => {
    emitted.push(input);
    return { eventId: 0, dispatched: [] };
  }) };
});

// Load the mocked bus once, before the install saves the playbook copies:
// several first imports at once can build the mock from a half-loaded module.
await import('@/services/EventService');
const { db } = await import('@/libs/DB');
const { askSchema, automationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { createDataRoom, getDataRoom } = await import('@/services/DataRoomService');
const { seoTools } = await import('@/services/agents/tools/seo');
const { objectsUpdateMetaAction } = await import('@/libs/actions/objects-update-meta');
const { patchProject } = await import('@/app/api/v1/projects/[id]/handlers');
const { runSeoOpportunitiesJob } = await import('./cadence');
const { listProjectSeoPages } = await import('./records');

const ORG = 'proj_seo_cadence_northwind';
const PERSON = 'usr-seo-dana';
// Thursday 1 October 2026, 9am in Chicago: a month of 8 owes 2 by the end of the week.
const NOW = '2026-10-01T14:00:00Z';

const ctx = (): RuntimeContext => ({
  orgId: ORG,
  agentSlug: 'seo-strategist',
  missionRunId: 701,
  connectorSources: [],
  searchConfig: {},
  harnessConfig: { model: 'claude-opus-5-5' },
  enabledPlugins: ['data-rooms', 'wiki', 'seo'],
  objectTypeSlugs: ['seo_batch', 'seo_page', 'data_room'],
  emit: () => {},
} as unknown as RuntimeContext);

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const t = seoTools(ctx()).find(x => x.name === name)! as unknown as { invoke: (input: Record<string, unknown>) => Promise<unknown> };
  return String(await t.invoke(args));
}

const req = (body: unknown) => new Request('http://localhost/api/v1/projects/1', { method: 'PATCH', body: JSON.stringify(body) }) as unknown as NextRequest;
const person = { orgId: ORG, actorId: PERSON, source: 'session' as const, principal: { kind: 'user', id: PERSON, role: 'admin', scope: { orgId: ORG } } } as never;
const token = { orgId: ORG, actorId: 'token:9', source: 'token' as const, principal: { kind: 'agent', id: 'token:9', scope: { orgId: ORG } } } as never;

let behind = 0;
let onPace = 0;
let noCadence = 0;

beforeAll(async () => {
  // The clock is the one thing faked: the month's pace is read from it. Pages
  // the database dates are still counted while in flight, whatever their day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  await db.insert(tenantAccountSchema).values({ id: 'acct-seo-cadence', name: 'Northwind Agency', slug: 'northwind-agency' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-seo-cadence', slug: 'northwind-agency', name: 'Northwind Agency', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
  const res = await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:dana' });

  expect(res.errors).toEqual([]);

  behind = (await createDataRoom(ORG, PERSON, { title: 'Northwind Home Services', domains: ['northwind-home.example'] })).id;
  onPace = (await createDataRoom(ORG, PERSON, { title: 'Kestrel Gear' })).id;
  noCadence = (await createDataRoom(ORG, PERSON, { title: 'Contoso Supply' })).id;
});

describe('the SEO app\'s automations in the one register', () => {
  it('stamps each with the app that installed it; the weekly check is listed, and the hidden hand-off is gone', async () => {
    const rows = await db.select().from(automationSchema).where(and(eq(automationSchema.orgId, ORG), like(automationSchema.slug, 'seo-%')));
    const bySlug = new Map(rows.map(r => [r.slug, r]));

    expect(bySlug.get('seo-opportunities')).toMatchObject({ source: 'plugin:seo', visibility: 'listed', name: 'New page opportunities', status: 'active' });
    expect(bySlug.get('seo-opportunities')?.whenConfig).toMatchObject({ schedule: '0 7 * * 1', timezone: 'America/Chicago' });
    // The page pipeline is workflows now (`pipeline.ts`): no hidden automation.
    expect(bySlug.has('seo-continue')).toBe(false);

    // Everything an app install wrote names the plugin it came from.
    const all = await db.select({ slug: automationSchema.slug, source: automationSchema.source }).from(automationSchema).where(eq(automationSchema.orgId, ORG));

    expect(all.filter(r => !r.source?.startsWith('plugin:'))).toEqual([]);
  });
});

describe('pages a month are a person\'s setting', () => {
  it('refuses an agent\'s write to seoCadence, whatever the bar', async () => {
    const refusal = await objectsUpdateMetaAction.precheck!({ orgId: ORG, proposedBy: 'agent:seo-strategist' }, { objectType: 'data_room', id: behind, set: { seoCadence: { pagesPerMonth: 50 } }, reason: 'more pages' });

    expect(refusal).toContain('set by a person on the project page');
  });

  it('a person sets it on the project page; a token may not; null clears it', async () => {
    expect((await patchProject(token, String(behind), req({ seoCadence: { pagesPerMonth: 8 } }))).status).toBe(403);
    expect((await patchProject(person, String(behind), req({ seoCadence: { pagesPerMonth: 0 } }))).status).toBe(400);
    expect((await patchProject(person, String(behind), req({ seoCadence: { pagesPerMonth: 8, focus: 'water heaters' } }))).status).toBe(200);
    expect((await getDataRoom(ORG, behind))?.meta.seoCadence).toEqual({ pagesPerMonth: 8, focus: 'water heaters' });

    expect((await patchProject(person, String(onPace), req({ seoCadence: { pagesPerMonth: 8 } }))).status).toBe(200);
    expect((await patchProject(person, String(noCadence), req({ seoCadence: { pagesPerMonth: 4 } }))).status).toBe(200);
    expect((await patchProject(person, String(noCadence), req({ seoCadence: null }))).status).toBe(200);
    expect((await getDataRoom(ORG, noCadence))?.meta.seoCadence).toBeUndefined();
  });
});

describe('the weekly check', () => {
  it('a project on pace gets nothing: no work queued and nothing said', async () => {
    // Kestrel Gear already has this week's two pages planned.
    expect(await call('seo_plan_batch', {
      project_id: onPace,
      topic: 'Trail shoes',
      pages: [{ keyword: 'trail running shoes', page_type: 'blog' }, { keyword: 'waterproof trail shoes', page_type: 'blog' }],
    })).toContain('Filed the keyword plan\'s sign-off');

    emitted.length = 0;

    const result = await runSeoOpportunitiesJob(ORG, { now: NOW });

    const kestrel = result.projects.find(p => p.projectId === onPace)!;

    expect(kestrel).toMatchObject({ queued: 0 });
    expect(kestrel.line).toContain('on pace');
    expect(emitted.some(e => e.payload?.projectId === onPace)).toBe(false);
  });

  it('never reads a project without a cadence', async () => {
    const result = await runSeoOpportunitiesJob(ORG, { now: NOW });

    expect(result.projects.some(p => p.projectId === noCadence)).toBe(false);
    expect(emitted.some(e => e.payload?.projectId === noCadence)).toBe(false);
  });

  it('a project behind pace queues the strategist\'s background run for just the pages it is short, keyed to the day', async () => {
    const queued = emitted.filter(e => e.payload?.projectId === behind);

    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0]).toMatchObject({
      type: 'seo.work_queued',
      payload: { reason: 'opportunities', projectId: behind, projectName: 'Northwind Home Services', pages: 2, pagesPerMonth: 8, focus: 'water heaters' },
      dedupeKey: `seo.work_queued:opportunities:${behind}:2026-10-01`,
    });
  });
});

describe('the plan it asks for', () => {
  it('refuses more pages than the project is short, and a project without a cadence', async () => {
    expect(await call('seo_plan_batch', {
      project_id: behind,
      cadence: true,
      topic: 'Water heaters',
      pages: [{ keyword: 'tankless water heater install' }, { keyword: 'water heater repair cost' }, { keyword: 'water heater flush' }],
    })).toContain('room for 2 pages');
    expect(await call('seo_plan_batch', { project_id: noCadence, cadence: true, topic: 'Shelving', pages: [{ keyword: 'warehouse shelving' }] })).toContain('no SEO cadence');
    expect(await listProjectSeoPages(ORG, behind)).toEqual([]);
  });

  it('files a normal keyword plan sign-off, in code, and then the project is on pace', async () => {
    const out = await call('seo_plan_batch', {
      project_id: behind,
      cadence: true,
      topic: 'Water heaters',
      why: 'Two water-heater questions the client\'s site does not answer yet rank in the local pack.',
      pages: [{ keyword: 'tankless water heater install', page_type: 'service' }, { keyword: 'water heater repair cost', page_type: 'blog' }],
    });

    expect(out).toContain('Filed the keyword plan\'s sign-off');

    const batch = Number(/batch #(\d+)/.exec(out)![1]);
    const asks = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), like(askSchema.sourceRef, `seo-plan:${batch}:%`)));

    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ kind: 'signoff', status: 'open' });

    expect(await call('seo_plan_batch', { project_id: behind, cadence: true, topic: 'Boilers', pages: [{ keyword: 'boiler service' }] })).toContain('on pace');
  });
});
