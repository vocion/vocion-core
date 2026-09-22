/**
 * `POST /api/v1/automations/:slug/pause` and `/resume` — the emergency stop
 * over a tenant token. Owner or PM only; a pause must say why; both write
 * the same `control` row the dashboard does, naming the token.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/libs/temporal/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/temporal/client')>();
  return {
    ...actual,
    getTemporalClient: vi.fn(async () => {
      throw new Error('temporal unavailable in this test');
    }),
  };
});

const { db } = await import('@/libs/DB');
const { automationRunSchema, automationSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { CONTROL_RUN_KIND } = await import('@/services/AutomationService');
const { POST: pause } = await import('./route');
const { POST: resume } = await import('../resume/route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'org_pause_route';

function identity(role: 'owner' | 'pm' | 'specialist' | 'client_reviewer', grants: string[] = []) {
  return { orgId: ORG, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role, scope: { orgId: ORG }, grants } };
}

function post(path: string, body?: unknown): Request {
  return new Request(`https://vocion.test/api/v1/automations/${path}`, {
    method: 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function row(slug: string) {
  const [r] = await db.select().from(automationSchema).where(eq(automationSchema.slug, slug));
  return r!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
  await db.insert(automationSchema).values({ orgId: ORG, slug: 'wiki-debrief', name: 'wiki-debrief', status: 'active', whenConfig: { event: 'mission_run.completed' }, doConfig: { checkMission: 'wiki-debrief' } });
});

afterAll(async () => {
  await db.delete(automationRunSchema);
  await db.delete(automationSchema);
});

describe('POST /api/v1/automations/:slug/pause', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    const res = await pause(post('wiki-debrief/pause', { note: 'loop' }), params('wiki-debrief'));

    expect(res.status).toBe(401);
  });

  it('refuses a token below owner/pm', async () => {
    mockBearer.mockResolvedValue(identity('specialist') as never);

    const res = await pause(post('wiki-debrief/pause', { note: 'loop' }), params('wiki-debrief'));

    expect(res.status).toBe(403);
    expect((await row('wiki-debrief')).pausedAt).toBeNull();
  });

  it('requires a note — a stop with no reason is the row nobody can act on', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);

    const res = await pause(post('wiki-debrief/pause', {}), params('wiki-debrief'));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('pauses on the record, naming the token', async () => {
    mockBearer.mockResolvedValue(identity('pm') as never);

    const res = await pause(post('wiki-debrief/pause', { note: 'runaway on mission_run.completed, incident 2026-09-20' }), params('wiki-debrief'));

    expect(res.status).toBe(200);

    const body = await res.json();

    expect(body.paused).toMatchObject({ by: { id: 'token:t1', name: 'API token t1' }, note: 'runaway on mission_run.completed, incident 2026-09-20' });

    const r = await row('wiki-debrief');

    expect(r.pausedBy).toBe('token:t1');
    expect(r.pausedNote).toBe('runaway on mission_run.completed, incident 2026-09-20');

    const [control] = await db.select().from(automationRunSchema);

    expect(control).toMatchObject({ kind: CONTROL_RUN_KIND, invokedBy: 'user:token:t1', result: { action: 'pause', schedule: null } });
  });

  it('answers 409 for a pause on a paused automation, and 404 for a slug that is not one', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);
    await pause(post('wiki-debrief/pause', { note: 'first' }), params('wiki-debrief'));

    const again = await pause(post('wiki-debrief/pause', { note: 'second' }), params('wiki-debrief'));

    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('AUTOMATION_STATE');

    const missing = await pause(post('nope/pause', { note: 'x' }), params('nope'));

    expect(missing.status).toBe(404);
  });
});

describe('POST /api/v1/automations/:slug/resume', () => {
  it('lifts a pause with an optional note and records whose pause it was', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);
    await pause(post('wiki-debrief/pause', { note: 'hold' }), params('wiki-debrief'));

    const res = await resume(post('wiki-debrief/resume'), params('wiki-debrief'));

    expect(res.status).toBe(200);
    expect((await row('wiki-debrief')).pausedAt).toBeNull();

    const controls = await db.select().from(automationRunSchema);

    expect(controls.map(c => (c.result as { action: string }).action)).toEqual(['pause', 'resume']);
    expect((controls[1]!.result as { lifted: { by: string } }).lifted.by).toBe('token:t1');
  });

  it('refuses a token below owner/pm, and 409s a resume on a running automation', async () => {
    mockBearer.mockResolvedValue(identity('client_reviewer') as never);

    expect((await resume(post('wiki-debrief/resume'), params('wiki-debrief'))).status).toBe(403);

    mockBearer.mockResolvedValue(identity('owner') as never);

    expect((await resume(post('wiki-debrief/resume'), params('wiki-debrief'))).status).toBe(409);
  });
});
