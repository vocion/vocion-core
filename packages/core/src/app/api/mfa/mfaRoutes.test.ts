/**
 * The `/api/mfa/*` routes over the real MFA service and local vault: who may
 * call which, and that a right code finishes a held sign-in through
 * `unstable_update` with the in-process proof (and never otherwise).
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { totpCode, totpStep } from '@/libs/identity/totp';

vi.mock('@/libs/DB');
const auth = vi.fn();
const unstableUpdate = vi.fn(async (_data: unknown) => null);
vi.mock('@/libs/Auth', () => ({
  auth: () => auth(),
  unstable_update: (data: unknown) => unstableUpdate(data),
  mfaCompletionProof: (userId: string) => `proof-for-${userId}`,
}));

const { db } = await import('@/libs/DB');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const schema = await import('@/models/Schema');
const { POST: enroll } = await import('./enroll/route');
const { POST: confirm } = await import('./enroll/confirm/route');
const { POST: verify } = await import('./verify/route');

const SAM = 'usr-sam';

function json(body: unknown) {
  return new Request('https://app.northwind.example/api/mfa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function signedIn() {
  auth.mockResolvedValue({ user: { id: SAM }, mfa: null });
}

function heldAt(state: 'verify' | 'enroll') {
  auth.mockResolvedValue({ user: { id: '' }, mfa: { state, userId: SAM } });
}

/** Set Sam up through the routes, returning the secret. */
async function enrolThroughRoutes(): Promise<string> {
  const started = await (await enroll()).json() as { secret: string };
  const res = await confirm(json({ code: totpCode(started.secret, totpStep(new Date())) }));

  expect(res.status).toBe(200);

  return started.secret;
}

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(32).toString('base64'));
  resetCredentialVault();
});

beforeEach(async () => {
  auth.mockReset();
  unstableUpdate.mockClear();
  resetMemoryRateLimits();
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values({ id: SAM, email: 'sam@northwind.example', name: 'Sam' });
});

describe('setting up from the profile page', () => {
  it('returns a QR code, then recovery codes for the first right code, without touching the session', async () => {
    signedIn();

    const started = await enroll();

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
  });

  it('refuses a caller with no session at all', async () => {
    auth.mockResolvedValue(null);

    expect((await enroll()).status).toBe(401);
  });
});

describe('the sign-in gate', () => {
  it('lets a held "enroll" sign-in set up, and finishes it with the proof', async () => {
    heldAt('enroll');

    await enrolThroughRoutes();

    expect(unstableUpdate).toHaveBeenCalledWith({ mfaProof: `proof-for-${SAM}` });
  });

  it('never lets a sign-in waiting on a code start a new setup — a password alone must not replace the app', async () => {
    signedIn();
    await enrolThroughRoutes();
    heldAt('verify');

    expect((await enroll()).status).toBe(401);
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
