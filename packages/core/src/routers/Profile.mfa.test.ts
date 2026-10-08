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

const { db } = await import('@/libs/DB');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { resetMemoryRateLimits } = await import('@/libs/rateLimit');
const schema = await import('@/models/Schema');
const mfa = await import('@/services/auth/mfa');
const { guardAuth } = await import('./AuthGuards');
const { disableMfaRoute, mfaStatusRoute, regenerateRecoveryCodesRoute, setAccountMfaRequirementRoute } = await import('./Profile');

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
  resetCredentialVault();
});

beforeEach(async () => {
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

    expect(await call(mfaStatusRoute)).toMatchObject({ enabled: false, account: { required: false, canChange: false } });
  });

  it('turns two-step off only with a working code', async () => {
    signedInAs('member');
    const codes = await enrolSam();

    await expect(call(disableMfaRoute, { code: '000000' })).rejects.toMatchObject({ status: 400 });
    expect(await mfa.mfaEnabled(SAM)).toBe(true);

    await call(disableMfaRoute, { code: codes[0] });

    expect(await mfa.mfaEnabled(SAM)).toBe(false);
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
});
