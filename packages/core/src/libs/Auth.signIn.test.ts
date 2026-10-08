import type { Session } from 'next-auth';
/**
 * The sign-in steps inside the Auth.js config, called directly: the password
 * step and its lockout, the JWT callback's decision about what sign-in still
 * owes, and the session a half-signed-in token produces. Real rows in PGlite;
 * tenancy and the personal-workspace bootstrap are stubbed, since they have
 * their own tests.
 */
import type { JWT } from 'next-auth/jwt';
import { CredentialsSignin } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// next-auth's ESM build imports `next/server` without an extension, which
// plain Node cannot resolve outside Next. These tests call the steps directly,
// so Auth.js itself is a stand-in that only records the config.
vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  return {
    default: (config: unknown) => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn(), config }),
    CredentialsSignin,
  };
});
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('@/services/workspace/personalProject', () => ({ ensurePersonalProjectsForUser: vi.fn(async () => []) }));
vi.mock('@/services/adoption/track', () => ({ trackLogin: vi.fn() }));
vi.mock('./tenancy', () => ({
  resolveTenancyForUser: vi.fn(async () => ({ accountId: 'acct-northwind', projectId: 'proj-ops', role: 'member', workspaceRole: 'member' })),
}));

const { db } = await import('@/libs/DB');
const { hashPassword } = await import('./identity/password');
const { RATE_LIMITS, peek, resetMemoryRateLimits } = await import('./rateLimit');
const schema = await import('@/models/Schema');
const { authorizeCredentials, isMfaCompletionProof, jwtCallback, mfaCompletionProof, sessionCallback } = await import('./Auth');

const SAM = { id: 'usr-sam', email: 'sam@northwind.example' };

function signInParams(token: JWT, extra: Record<string, unknown> = {}) {
  return { token, user: { id: SAM.id, email: SAM.email }, account: { provider: 'credentials', type: 'credentials', providerAccountId: SAM.id }, trigger: 'signIn', ...extra } as unknown as Parameters<typeof jwtCallback>[0];
}

function updateParams(token: JWT, session: unknown) {
  return { token, trigger: 'update', session } as unknown as Parameters<typeof jwtCallback>[0];
}

function emptySession(): Session {
  return { user: { email: SAM.email }, expires: '2026-11-07T00:00:00.000Z' } as unknown as Session;
}

async function enableMfaForSam() {
  // A confirmed authenticator row is all the gate reads; the secret's
  // contents are the MFA service's business (services/auth/mfa.test.ts).
  const [dek] = await db.insert(schema.sourceDekSchema).values({ orgId: `user:${SAM.id}`, wrappedDek: 'x' }).returning();
  await db.insert(schema.userMfaSchema).values({ userId: SAM.id, dekId: dek!.id, ciphertext: 'c', nonce: 'n', authTag: 't', enabledAt: new Date() });
}

beforeEach(async () => {
  resetMemoryRateLimits();
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.sourceDekSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.userSchema).values({ ...SAM, name: 'Sam', passwordHash: await hashPassword('right-password') });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the password step', () => {
  it('signs in the right password, in any email case', async () => {
    expect(await authorizeCredentials({ email: 'Sam@Northwind.example', password: 'right-password' })).toMatchObject({ id: SAM.id });
  });

  it('locks an email after ten wrong passwords — from any address, even with the right one', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerAccount.limit; i++) {
      expect(await authorizeCredentials({ email: SAM.email, password: 'wrong' })).toBeNull();
    }

    const refusal = await authorizeCredentials({ email: SAM.email, password: 'right-password' }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(CredentialsSignin);
    expect((refusal as CredentialsSignin).code).toBe('rate_limited');
  });

  it('locks an email with no login the same way, so the lockout says nothing about who has one', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerAccount.limit; i++) {
      await authorizeCredentials({ email: 'nobody@northwind.example', password: 'wrong' });
    }

    expect((await peek(RATE_LIMITS.signInFailuresPerAccount, 'nobody@northwind.example')).allowed).toBe(false);
  });

  it('forgets earlier failures once the right password arrives', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerAccount.limit - 1; i++) {
      await authorizeCredentials({ email: SAM.email, password: 'wrong' });
    }
    await authorizeCredentials({ email: SAM.email, password: 'right-password' });

    expect((await peek(RATE_LIMITS.signInFailuresPerAccount, SAM.email)).allowed).toBe(true);
  });
});

describe('what sign-in still owes', () => {
  it('finishes straight away when no second factor is set up or required', async () => {
    const token = await jwtCallback(signInParams({} as JWT));

    expect(token).toMatchObject({ id: SAM.id, mfa: null, projectId: 'proj-ops' });
  });

  it('holds the session at "verify" for a person with an authenticator, with no tenancy on it', async () => {
    await enableMfaForSam();

    const token = await jwtCallback(signInParams({} as JWT));

    expect(token.mfa).toBe('verify');
    expect(token.projectId).toBeUndefined();
  });

  it('holds the session at "enroll" when the deployment requires a second factor nobody set up', async () => {
    vi.stubEnv('VOCION_REQUIRE_MFA', '1');

    expect((await jwtCallback(signInParams({} as JWT))).mfa).toBe('enroll');
  });

  it('ignores a browser that tries to finish the second step by updating its own session', async () => {
    const held = { id: SAM.id, mfa: 'verify' } as JWT;

    const token = await jwtCallback(updateParams({ ...held }, { mfaProof: 'verified', mfa: null }));

    expect(token.mfa).toBe('verify');
  });

  it('finishes the sign-in on the in-process proof that the code checked out', async () => {
    const held = { id: SAM.id, mfa: 'verify' } as JWT;

    const token = await jwtCallback(updateParams({ ...held }, { mfaProof: mfaCompletionProof(SAM.id) }));

    expect(token).toMatchObject({ mfa: null, projectId: 'proj-ops' });
  });

  it('refuses a proof made for someone else, or one older than a minute', () => {
    const now = Date.now();

    expect(isMfaCompletionProof(mfaCompletionProof('usr-kim', now), SAM.id, now)).toBe(false);
    expect(isMfaCompletionProof(mfaCompletionProof(SAM.id, now - 61_000), SAM.id, now)).toBe(false);
    expect(isMfaCompletionProof(mfaCompletionProof(SAM.id, now), SAM.id, now)).toBe(true);
  });
});

describe('the session a half-signed-in token gives', () => {
  it('reads as signed out to every guard, and says which step is left', async () => {
    const session = await sessionCallback({ session: emptySession(), token: { id: SAM.id, mfa: 'verify' } as JWT });

    expect(session.user.id).toBe('');
    expect(session.user.projectId).toBeNull();
    expect(session.mfa).toEqual({ state: 'verify', userId: SAM.id });
  });

  it('is a normal session once nothing is owed', async () => {
    const session = await sessionCallback({ session: emptySession(), token: { id: SAM.id, mfa: null } as JWT });

    expect(session.user).toMatchObject({ id: SAM.id, projectId: 'proj-ops' });
    expect(session.mfa).toBeNull();
  });
});
