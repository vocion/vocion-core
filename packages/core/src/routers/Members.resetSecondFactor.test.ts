/**
 * An account admin resetting a member's two-step sign-in from the Members
 * page: admin-only, refused with a reason for anyone it would reach beyond
 * this account, and recorded on the adoption stream as the audit trail. The
 * rules themselves are tested in `services/auth/mfa.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({ guardAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { resetCredentialVault } = await import('@/libs/crypto/credentialVault');
const { totpCode, totpStep } = await import('@/libs/identity/totp');
const schema = await import('@/models/Schema');
const mfa = await import('@/services/auth/mfa');
const { guardAuth } = await import('./AuthGuards');
const { resetSecondFactorRoute } = await import('./Members');

function call<T = unknown>(route: unknown, input: unknown): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

function signedInAs(userId: string, role: 'admin' | 'member') {
  const ctx = { userId, orgId: 'proj-ops', accountId: 'acct-northwind', projectId: 'proj-ops', role, has: ({ role: wanted }: { role: string }) => wanted === 'org:member' || role === 'admin' };
  vi.mocked(guardAuth).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardAuth>>);
}

async function enrol(userId: string) {
  const started = await mfa.beginEnrollment(userId);
  if ('error' in started) {
    throw new Error(started.error);
  }
  await mfa.confirmEnrollment(userId, totpCode(started.secret, totpStep(new Date())));
}

beforeAll(() => {
  vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', randomBytes(32).toString('base64'));
  vi.stubEnv('AUTH_SECRET', 'members-reset-test-secret');
  resetCredentialVault();
});

beforeEach(async () => {
  await db.delete(schema.userActivityEventSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values([
    { id: 'usr-ana', email: 'ana@northwind.example', name: 'Ana' },
    { id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam' },
  ]);
  await db.insert(schema.tenantAccountSchema).values([
    { id: 'acct-northwind', name: 'Northwind', slug: 'northwind' },
    { id: 'acct-kestrel', name: 'Kestrel Capital', slug: 'kestrel' },
  ]);
  await db.insert(schema.accountMembershipSchema).values([
    { accountId: 'acct-northwind', userId: 'usr-ana', role: 'admin' },
    { accountId: 'acct-northwind', userId: 'usr-sam', role: 'member' },
  ]);
});

describe('members.resetSecondFactor', () => {
  it('lets an admin reset a member who lost their phone and codes, and records who did it', async () => {
    await enrol('usr-sam');
    signedInAs('usr-ana', 'admin');

    expect(await call(resetSecondFactorRoute, { userId: 'usr-sam' })).toEqual({ ok: true, hadSecondFactor: true });
    expect(await mfa.mfaEnabled('usr-sam')).toBe(false);

    const events = await db.select().from(schema.userActivityEventSchema).where(eq(schema.userActivityEventSchema.eventType, 'auth.second_factor_reset'));

    expect(events).toEqual([expect.objectContaining({ userId: 'usr-ana', resourceType: 'user', resourceId: 'usr-sam' })]);
  });

  it('refuses a member who is not an admin', async () => {
    signedInAs('usr-sam', 'member');

    await expect(call(resetSecondFactorRoute, { userId: 'usr-ana' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses, with the reason, a person who also belongs to another account', async () => {
    await db.insert(schema.accountMembershipSchema).values({ accountId: 'acct-kestrel', userId: 'usr-sam', role: 'member' });
    await enrol('usr-sam');
    signedInAs('usr-ana', 'admin');

    await expect(call(resetSecondFactorRoute, { userId: 'usr-sam' })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('another account') });
    expect(await mfa.mfaEnabled('usr-sam')).toBe(true);
  });
});
