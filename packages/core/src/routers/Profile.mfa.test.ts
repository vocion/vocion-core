/**
 * The profile page's two-step moves: turning it off and minting new recovery
 * codes each take a current code (behind the lockout), and only an account
 * admin flips the account's requirement.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.4' }) }));
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));
// Auth.js itself cannot load outside Next; the routes only need to keep the
// caller's session after a change that ends the others.
const keepThisSession = vi.fn(async (_userId: string) => {});
vi.mock('@/libs/Auth', () => ({ keepThisSession: (userId: string) => keepThisSession(userId) }));

const { db } = await import('@/libs/DB');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const schema = await import('@/models/Schema');
const mfa = await import('@/services/auth/mfa');
const { guardAuth } = await import('./AuthGuards');
const { changePasswordRoute, disableMfaRoute, mfaStatusRoute, regenerateRecoveryCodesRoute, setAccountMfaRequirementRoute } = await import('./Profile');
const { hashPassword } = await import('@/libs/identity/password');
const { eq } = await import('drizzle-orm');

const SAM = 'usr-sam';

function call<T = unknown>(route: unknown, input: unknown = undefined): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

function signedInAs(role: 'admin' | 'member') {
  const ctx = { userId: SAM, orgId: 'proj-ops', accountId: 'acct-northwind', projectId: 'proj-ops', role, has: ({ role: wanted }: { role: string }) => wanted === 'org:member' || role === 'admin' };
  vi.mocked(guardAuth).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

async function enrolSam(): Promise<string[]> {
  const started = await mfa.beginEnrollment(SAM);
  if ('error' in started) {
    throw new Error(started.error);
  }
  const { totpCode, totpStep } = await import('@/libs/identity/totp');
  const confirmed = await mfa.confirmEnrollment(SAM, totpCode(started.secret, totpStep(new Date())));
  if (!confirmed.ok) {
    throw new Error(confirmed.reason);
  }
  return confirmed.recoveryCodes;
}

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('AUTH_SECRET', 'profile-mfa-test-secret');
  resetCredentialVault();
});

beforeEach(async () => {
  keepThisSession.mockClear();
  vi.stubEnv('VOCION_DEMO_SEED_DIR', '');
  resetMemoryRateLimits();
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values({ id: SAM, email: 'sam@northwind.example', name: 'Sam' });
  await db.insert(schema.tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
  await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-northwind', userId: SAM, role: 'admin' });
});

describe('profile.mfa', () => {
  it('reports the state and whether this person may flip the account switch', async () => {
    signedInAs('member');

    expect(await call(mfaStatusRoute)).toMatchObject({ enabled: false, available: true, hasPassword: false, account: { required: false, canChange: false } });
  });

  it('is unavailable in the demo sandbox, and its account switch cannot be flipped there', async () => {
    vi.stubEnv('VOCION_DEMO_SEED_DIR', 'demo-seed');
    signedInAs('admin');

    expect(await call(mfaStatusRoute)).toMatchObject({ available: false });
    await expect(call(setAccountMfaRequirementRoute, { required: true })).rejects.toMatchObject({ status: 403 });
    expect(await mfa.accountRequiresMfa('acct-northwind')).toBe(false);
  });

  it('turns two-step off only with a working code', async () => {
    signedInAs('member');
    const codes = await enrolSam();

    await expect(call(disableMfaRoute, { code: '000000' })).rejects.toMatchObject({ status: 400 });
    expect(await mfa.mfaEnabled(SAM)).toBe(true);

    await call(disableMfaRoute, { code: codes[0] });

    expect(await mfa.mfaEnabled(SAM)).toBe(false);
    // Turning it off ended Sam's other sessions; this one is kept.
    expect(keepThisSession).toHaveBeenCalledWith(SAM);
  });

  it('answers a run of wrong codes with a 429', async () => {
    signedInAs('member');
    await enrolSam();
    for (let i = 0; i < 5; i++) {
      await call(regenerateRecoveryCodesRoute, { code: '000000' }).catch(() => {});
    }

    await expect(call(regenerateRecoveryCodesRoute, { code: '000000' })).rejects.toMatchObject({ status: 429 });
  });

  it('mints new recovery codes for a working code', async () => {
    signedInAs('member');
    const codes = await enrolSam();

    const result = await call<{ recoveryCodes: string[] }>(regenerateRecoveryCodesRoute, { code: codes[0] });

    expect(result.recoveryCodes).toHaveLength(10);
  });

  it('lets only an account admin require two-step for everyone', async () => {
    signedInAs('member');

    await expect(call(setAccountMfaRequirementRoute, { required: true })).rejects.toMatchObject({ status: 403 });
    expect(await mfa.accountRequiresMfa('acct-northwind')).toBe(false);

    signedInAs('admin');
    await call(setAccountMfaRequirementRoute, { required: true });

    expect(await mfa.accountRequiresMfa('acct-northwind')).toBe(true);
    expect(await mfa.signInGateFor(SAM)).toBe('enroll');
  });

  it('ends other sessions when the password changes, and keeps the one it was changed from', async () => {
    signedInAs('member');
    await db.update(schema.userSchema).set({ passwordHash: await hashPassword('old-password') });

    await call(changePasswordRoute, { currentPassword: 'old-password', newPassword: 'a-new-password' });

    const [row] = await db.select({ v: schema.userSchema.sessionVersion }).from(schema.userSchema).where(eq(schema.userSchema.id, SAM));

    expect(row?.v).toBe(1);
    expect(keepThisSession).toHaveBeenCalledWith(SAM);
  });
});
