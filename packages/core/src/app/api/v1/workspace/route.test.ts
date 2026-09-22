/**
 * `GET /api/v1/workspace`, `POST /api/v1/workspace/pause` and `/resume` — the
 * off switch over a tenant token, for the operator who is not in the
 * dashboard: the one with a terminal at 11pm.
 *
 * Owner or PM only; a pause must say why; the read says what a pause refuses
 * and what it allows, so a client's copy of that list cannot drift from the
 * guard's.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { GET: read } = await import('./route');
const { POST: pause } = await import('./pause/route');
const { POST: resume } = await import('./resume/route');

const mockBearer = vi.mocked(authenticateBearer);
const mockSession = vi.mocked(clerkAuth);

const ORG = 'proj_workspace_route';
const ACCT = 'acct_workspace_route';

function identity(role: 'owner' | 'pm' | 'specialist' | 'client_reviewer', grants: string[] = []) {
  return { orgId: ORG, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role, scope: { orgId: ORG }, grants } };
}

function request(path: string, body?: unknown): Request {
  return new Request(`https://vocion.test/api/v1/workspace${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'authorization': 'Bearer vcn_live_fake', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * A POST with no body at all, which the note reader has to tolerate on resume.
 * @param path
 */
function bodiless(path: string): Request {
  return new Request(`https://vocion.test/api/v1/workspace${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer vcn_live_fake' },
  });
}

async function project() {
  const [row] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG));
  return row!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ userId: null, orgId: null, accountId: null, projectId: null, role: null, has: () => false } as never);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ACCT, name: 'Squatch', slug: 'squatch' } as never);
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCT, slug: 'factory', name: 'Squatch Factory' } as never);
});

afterAll(async () => {
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('GET /api/v1/workspace', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    expect((await read(request(''))).status).toBe(401);
  });

  it('reads null while the workspace is running, and names what a pause would refuse and allow', async () => {
    mockBearer.mockResolvedValue(identity('specialist') as never);

    const res = await read(request(''));

    expect(res.status).toBe(200);

    const body = await res.json();

    expect(body.paused).toBeNull();
    expect(body.refuses).toEqual(['an automation fire', 'a mission run', 'a worker run', 'a gated action']);
    expect(body.allows.join(' ')).toContain('chat with an agent');
  });

  it('reads the hold once the switch is pulled', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);
    await pause(request('/pause', { note: 'holding the factory' }));

    const body = await (await read(request(''))).json();

    expect(body.paused).toMatchObject({ by: { id: 'token:t1', name: 'API token t1' }, note: 'holding the factory' });
    expect(Date.parse(body.paused.at)).not.toBeNaN();
  });
});

describe('POST /api/v1/workspace/pause', () => {
  it('rejects an unauthenticated request', async () => {
    mockBearer.mockResolvedValue(null);

    expect((await pause(request('/pause', { note: 'x' }))).status).toBe(401);
  });

  it('refuses a token below owner/pm, and leaves the workspace running', async () => {
    mockBearer.mockResolvedValue(identity('specialist') as never);

    expect((await pause(request('/pause', { note: 'x' }))).status).toBe(403);
    expect((await project()).pausedAt).toBeNull();
  });

  it('requires a note — the banner has to say something to everyone else', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);

    const res = await pause(request('/pause', {}));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_FAILED');
    expect((await project()).pausedAt).toBeNull();
  });

  it('pauses on the record, naming the token', async () => {
    mockBearer.mockResolvedValue(identity('pm') as never);

    const res = await pause(request('/pause', { note: 'runaway debriefs, incident 2026-09-21' }));

    expect(res.status).toBe(200);
    expect((await res.json()).paused).toMatchObject({
      by: { id: 'token:t1', name: 'API token t1' },
      note: 'runaway debriefs, incident 2026-09-21',
    });

    const row = await project();

    expect(row.pausedBy).toBe('token:t1');
    expect(row.pausedNote).toBe('runaway debriefs, incident 2026-09-21');
  });

  it('answers 409 on a workspace that is already paused, so a second operator learns the first got there', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);
    await pause(request('/pause', { note: 'first' }));

    const again = await pause(request('/pause', { note: 'second' }));

    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('WORKSPACE_STATE');
    // The first note stands: a second pause changes nothing.
    expect((await project()).pausedNote).toBe('first');
  });
});

describe('POST /api/v1/workspace/resume', () => {
  it('lifts the hold and says whose it was', async () => {
    mockBearer.mockResolvedValue(identity('owner') as never);
    await pause(request('/pause', { note: 'holding for the release' }));

    const res = await resume(bodiless('/resume'));

    expect(res.status).toBe(200);

    const body = await res.json();

    expect(body.paused).toBeNull();
    expect(body.lifted).toMatchObject({ by: { id: 'token:t1' }, note: 'holding for the release' });
    expect((await project()).pausedAt).toBeNull();
  });

  it('refuses a token below owner/pm, and 409s a resume on a running workspace', async () => {
    mockBearer.mockResolvedValue(identity('client_reviewer') as never);

    expect((await resume(bodiless('/resume'))).status).toBe(403);

    mockBearer.mockResolvedValue(identity('owner') as never);
    const conflict = await resume(bodiless('/resume'));

    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('WORKSPACE_STATE');
  });
});
