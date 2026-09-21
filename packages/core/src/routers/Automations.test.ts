/**
 * `Automations.ts` — the pause and resume routes. The service is mocked, so
 * this is about what the router does around it: it names the actor from the
 * session and never from the input, it is gated by the same guard the mission
 * mutations use, and its refusals come back as codes a client can act on.
 */
import { ORPCError } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// A factory, not an automock, same as Missions.resume.test.ts: AuthGuards
// pulls in next-auth, which does not import cleanly in the unit environment.
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
}));
vi.mock('@/services/UserProfileService', () => ({
  getProfile: vi.fn(),
}));
vi.mock('@/services/AutomationService', () => {
  class AutomationNotFoundError extends Error {}
  class AutomationPauseStateError extends Error {}
  return {
    AutomationNotFoundError,
    AutomationPauseStateError,
    pauseAutomation: vi.fn(),
    resumeAutomation: vi.fn(),
  };
});

const { guardAuth } = await import('./AuthGuards');
const { getProfile } = await import('@/services/UserProfileService');
const { AutomationNotFoundError, AutomationPauseStateError, pauseAutomation, resumeAutomation } = await import('@/services/AutomationService');
const { pause, resume } = await import('./Automations');
const { ApiError } = await import('./ApiError');

const ORG = 'org_router_automations';

function signedIn(userId = 'usr-1') {
  vi.mocked(guardAuth).mockResolvedValue({ orgId: ORG, userId } as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProfile).mockResolvedValue({ name: 'Chris', email: 'chris@example.com' });
});

describe('pause', () => {
  it('names the actor from the session — the caller cannot choose who the record says', async () => {
    signedIn('usr-chris');
    vi.mocked(pauseAutomation).mockResolvedValue({ by: { id: 'usr-chris', name: 'Chris' }, at: new Date(), note: 'CRM' });

    await call(pause, { slug: 'hourly-sweep', note: 'CRM', by: { id: 'usr-forged', name: 'Nobody' } });

    expect(pauseAutomation).toHaveBeenCalledWith(ORG, 'hourly-sweep', { by: { id: 'usr-chris', name: 'Chris' }, note: 'CRM' });
  });

  it('falls back to the email when the person has not set a name', async () => {
    signedIn('usr-chris');
    vi.mocked(getProfile).mockResolvedValue({ name: null, email: 'chris@example.com' });
    vi.mocked(pauseAutomation).mockResolvedValue({ by: { id: 'usr-chris', name: 'chris@example.com' }, at: new Date(), note: null });

    await call(pause, { slug: 'hourly-sweep' });

    expect(pauseAutomation).toHaveBeenCalledWith(ORG, 'hourly-sweep', { by: { id: 'usr-chris', name: 'chris@example.com' }, note: undefined });
  });

  it('refuses without a session, before touching the service', async () => {
    vi.mocked(guardAuth).mockRejectedValue(ApiError.unauthorized());

    const rejection = await call(pause, { slug: 'hourly-sweep' }).catch(err => err);

    expect(rejection).toBeInstanceOf(ORPCError);
    expect((rejection as InstanceType<typeof ORPCError>).status).toBe(401);
    expect(pauseAutomation).not.toHaveBeenCalled();
  });

  it('maps an unknown slug to NOT_FOUND and an already-paused automation to CONFLICT', async () => {
    signedIn();
    vi.mocked(pauseAutomation).mockRejectedValueOnce(new AutomationNotFoundError('nope'));

    const missing = await call(pause, { slug: 'nope' }).catch(err => err);

    expect((missing as InstanceType<typeof ORPCError>).status).toBe(404);

    vi.mocked(pauseAutomation).mockRejectedValueOnce(new AutomationPauseStateError('automation "x" is already paused'));

    const stale = await call(pause, { slug: 'x' }).catch(err => err);

    expect(stale).toBeInstanceOf(ORPCError);
    expect((stale as InstanceType<typeof ORPCError>).code).toBe('CONFLICT');
    expect((stale as Error).message).toMatch(/already paused/);
  });

  it('lets an unrelated error pass through unchanged', async () => {
    signedIn();
    vi.mocked(pauseAutomation).mockRejectedValue(new Error('database connection lost'));

    const rejection = await call(pause, { slug: 'x' }).catch(err => err);

    expect(rejection).not.toBeInstanceOf(ORPCError);
    expect((rejection as Error).message).toBe('database connection lost');
  });
});

describe('resume', () => {
  it('names the actor from the session and passes the note through', async () => {
    signedIn('usr-sam');
    vi.mocked(getProfile).mockResolvedValue({ name: 'Sam', email: 'sam@example.com' });
    vi.mocked(resumeAutomation).mockResolvedValue(undefined);

    const res = await call(resume, { slug: 'hourly-sweep', note: 'sync is back' });

    expect(res).toEqual({ ok: true });
    expect(resumeAutomation).toHaveBeenCalledWith(ORG, 'hourly-sweep', { by: { id: 'usr-sam', name: 'Sam' }, note: 'sync is back' });
  });

  it('refuses without a session', async () => {
    vi.mocked(guardAuth).mockRejectedValue(ApiError.unauthorized());

    const rejection = await call(resume, { slug: 'hourly-sweep' }).catch(err => err);

    expect((rejection as InstanceType<typeof ORPCError>).status).toBe(401);
    expect(resumeAutomation).not.toHaveBeenCalled();
  });

  it('maps a not-paused automation to CONFLICT', async () => {
    signedIn();
    vi.mocked(resumeAutomation).mockRejectedValue(new AutomationPauseStateError('automation "x" is not paused'));

    const rejection = await call(resume, { slug: 'x' }).catch(err => err);

    expect((rejection as InstanceType<typeof ORPCError>).code).toBe('CONFLICT');
  });
});
