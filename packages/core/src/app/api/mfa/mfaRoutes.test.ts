/**
 * The `/api/mfa/*` routes over the real MFA service and local vault: who may
 * call which, that setting up from the profile asks for the password (or a
 * recent sign-in), that the lockout holds against a parallel burst, and that a
 * right code finishes a held sign-in through `unstable_update` with the
 * in-process proof (and never otherwise).
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { totpCode, totpStep } from '@/libs/identity/totp';

vi.mock('@/libs/DB');
const auth = vi.fn();
const unstableUpdate = vi.fn(async (_data: unknown) => null);
const keepThisSession = vi.fn(async (_userId: string) => {});
vi.mock('@/libs/Auth', () => ({
  auth: () => auth(),
  unstable_update: (data: unknown) => unstableUpdate(data),
  mfaCompletionProof: (userId: string) => `proof-for-${userId}`,
  keepThisSession: (userId: string) => keepThisSession(userId),
  isRecentSignIn: (authTime: number | null | undefined) => typeof authTime === 'number' && Date.now() - authTime <= 10 * 60_000,
}));

const { db } = await import('@/libs/DB');
const { hashPassword } = await import('@/libs/identity/password');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const schema = await import('@/models/Schema');
const { POST: enroll } = await import('./enroll/route');
const { POST: confirm } = await import('./enroll/confirm/route');
const { POST: verify } = await import('./verify/route');

const SAM = 'usr-sam';
const SAM_PASSWORD = 'sam-right-password';

function json(body: unknown) {
  return new Request('https://app.northwind.example/api/mfa', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.4' }, body: JSON.stringify(body) });
}

/**
 * Start setting up from the profile, with Sam's password unless told otherwise.
 * @param body - The JSON body to send.
 */
function startSetup(body: unknown = { password: SAM_PASSWORD }) {
  return enroll(json(body));
}

function signedIn(authTime: number | null = Date.now()) {
  auth.mockResolvedValue({ user: { id: SAM }, mfa: null, authTime });
}

function heldAt(state: 'verify' | 'enroll') {
  auth.mockResolvedValue({ user: { id: '' }, mfa: { state, userId: SAM } });
}

/** Set Sam up through the routes, returning the secret. */
async function enrolThroughRoutes(): Promise<string> {
  const started = await (await startSetup()).json() as { secret: string };
  const res = await confirm(json({ code: totpCode(started.secret, totpStep(new Date())) }));

  expect(res.status).toBe(200);

  return started.secret;
}

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('AUTH_SECRET', 'mfa-routes-test-secret');
  resetCredentialVault();
});

beforeEach(async () => {
  auth.mockReset();
  unstableUpdate.mockClear();
  keepThisSession.mockClear();
  vi.stubEnv('VOCION_DEMO_SEED_DIR', '');
  resetMemoryRateLimits();
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values({ id: SAM, email: 'sam@northwind.example', name: 'Sam', passwordHash: await hashPassword(SAM_PASSWORD) });
});

describe('setting up from the profile page', () => {
  it('returns a QR code, then recovery codes for the first right code, keeping this session while ending the others', async () => {
    signedIn();

    const started = await startSetup();

    expect(started.status).toBe(200);

    const { secret, qrSvg } = await started.json() as { secret: string; qrSvg: string };

    expect(qrSvg).toContain('<svg');

    const wrong = await confirm(json({ code: '000000' }));

    expect(wrong.status).toBe(400);
    await expect(wrong.json()).resolves.toMatchObject({ code: 'INVALID_CODE' });

    const res = await confirm(json({ code: totpCode(secret, totpStep(new Date())) }));

    expect(res.status).toBe(200);
    expect((await res.json() as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);
    expect(unstableUpdate).not.toHaveBeenCalled();
    expect(keepThisSession).toHaveBeenCalledWith(SAM);
  });

  it('asks for the current password first — a session alone cannot put an authenticator in front of the owner', async () => {
    signedIn();

    const missing = await startSetup({});

    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ code: 'PASSWORD_REQUIRED' });

    const wrong = await startSetup({ password: 'not-sams-password' });

    expect(wrong.status).toBe(400);
    await expect(wrong.json()).resolves.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect(await db.select().from(schema.userMfaSchema)).toHaveLength(0);
  });

  it('takes a sign-in from the last ten minutes in place of a password for a login that has none', async () => {
    await db.update(schema.userSchema).set({ passwordHash: null });

    signedIn(Date.now() - 11 * 60_000);
    const stale = await startSetup({});

    expect(stale.status).toBe(401);
    await expect(stale.json()).resolves.toMatchObject({ code: 'REAUTH_REQUIRED' });

    signedIn(Date.now() - 60_000);

    expect((await startSetup({})).status).toBe(200);
  });

  it('refuses a caller with no session at all', async () => {
    auth.mockResolvedValue(null);

    expect((await startSetup()).status).toBe(401);
  });

  it('is not offered in the demo sandbox, where every visitor shares one login', async () => {
    vi.stubEnv('VOCION_DEMO_SEED_DIR', 'demo-seed');
    signedIn();

    expect((await startSetup()).status).toBe(403);
  });

  it('lets at most five of twenty simultaneous wrong codes reach the check', async () => {
    signedIn();
    await startSetup();

    const burst = await Promise.all(Array.from({ length: 20 }, () => confirm(json({ code: '000000' }))));
    const statuses = burst.map(r => r.status);

    expect(statuses.filter(s => s === 400).length).toBeLessThanOrEqual(5);
    expect(statuses.filter(s => s === 429).length).toBeGreaterThanOrEqual(15);
  });
});

describe('the sign-in gate', () => {
  it('lets a held "enroll" sign-in set up without asking for the password again, and finishes it with the proof', async () => {
    heldAt('enroll');

    const started = await startSetup({});

    expect(started.status).toBe(200);

    const { secret } = await started.json() as { secret: string };
    const res = await confirm(json({ code: totpCode(secret, totpStep(new Date())) }));

    expect(res.status).toBe(200);
    expect(unstableUpdate).toHaveBeenCalledWith({ mfaProof: `proof-for-${SAM}` });
    expect(keepThisSession).not.toHaveBeenCalled();
  });

  it('never lets a sign-in waiting on a code start a new setup — a password alone must not replace the app', async () => {
    signedIn();
    await enrolThroughRoutes();
    heldAt('verify');

    expect((await startSetup()).status).toBe(401);
  });
});

describe('POST /api/mfa/verify', () => {
  it('finishes a held sign-in for a right code, and only then', async () => {
    signedIn();
    const secret = await enrolThroughRoutes();
    heldAt('verify');

    const wrong = await verify(json({ code: '000000' }));

    expect(wrong.status).toBe(400);
    expect(unstableUpdate).not.toHaveBeenCalled();

    // The enrolment spent the current step; the next one is the next code.
    const next = totpCode(secret, totpStep(new Date()) + 1);
    const res = await verify(json({ code: next }));

    expect(res.status).toBe(200);
    expect(unstableUpdate).toHaveBeenCalledWith({ mfaProof: `proof-for-${SAM}` });
  });

  it('lets at most five of twenty simultaneous wrong codes through, then refuses even the right one', async () => {
    signedIn();
    const secret = await enrolThroughRoutes();
    heldAt('verify');

    const burst = await Promise.all(Array.from({ length: 20 }, () => verify(json({ code: '000000' }))));

    expect(burst.filter(r => r.status === 400).length).toBeLessThanOrEqual(5);

    const right = await verify(json({ code: totpCode(secret, totpStep(new Date()) + 1) }));

    expect(right.status).toBe(429);
    expect(unstableUpdate).not.toHaveBeenCalled();
  });

  it('locks after five wrong codes with a 429 and Retry-After', async () => {
    signedIn();
    await enrolThroughRoutes();
    heldAt('verify');
    for (let i = 0; i < 5; i++) {
      await verify(json({ code: '000000' }));
    }

    const res = await verify(json({ code: '000000' }));

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('refuses a caller whose sign-in is not waiting on a code', async () => {
    signedIn();

    const res = await verify(json({ code: '123456' }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ code: 'NO_PENDING_SIGN_IN' });
  });

  it('takes JSON only', async () => {
    heldAt('verify');

    const res = await verify(new Request('https://app.northwind.example/api/mfa/verify', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'code=123456' }));

    expect(res.status).toBe(415);
  });
});
