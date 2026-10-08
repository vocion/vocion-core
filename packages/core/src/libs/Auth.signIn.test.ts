import type { Session } from 'next-auth';
/**
 * The sign-in steps inside the Auth.js config, called directly: the password
 * step and its lockout (including a parallel burst), the invites a completed
 * sign-in joins, the JWT callback's decision about what sign-in still owes,
 * how long a hold lasts, and the session version that ends other sessions.
 * (The adapter and the provider gate are `Auth.externalSignIn.test.ts`.) Real rows in PGlite; tenancy and
 * the personal-workspace bootstrap are stubbed, since they have their own
 * tests.
 */
import type { JWT } from 'next-auth/jwt';
import { CredentialsSignin } from 'next-auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// next-auth's ESM build imports `next/server` without an extension, which
// plain Node cannot resolve outside Next. These tests call the steps directly,
// so Auth.js itself is a stand-in that only records the config.
const captured = vi.hoisted(() => ({ config: null as unknown }));
vi.mock('next-auth', () => {
  class CredentialsSignin extends Error {
    code = 'credentials';
  }
  return {
    // Auth.ts hands Auth.js a function that builds the config on first use.
    default: (config: typeof captured.config | (() => typeof captured.config)) => {
      captured.config = typeof config === 'function' ? config() : config;
      return { auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn(), unstable_update: vi.fn(), config };
    },
    CredentialsSignin,
  };
});
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/microsoft-entra-id', () => ({ default: (config: unknown) => config }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
// The real join, wrapped so one test can make it fail.
vi.mock('@/services/auth/joinInvites', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/auth/joinInvites')>();
  return { ...real, joinPendingInvites: vi.fn(real.joinPendingInvites) };
});
vi.mock('@/services/workspace/personalProject', () => ({ ensurePersonalProjectsForUser: vi.fn(async () => []) }));
vi.mock('@/services/adoption/track', () => ({ trackLogin: vi.fn() }));
vi.mock('./tenancy', () => ({
  resolveTenancyForUser: vi.fn(async () => ({ accountId: 'acct-northwind', projectId: 'proj-ops', role: 'member', workspaceRole: 'member' })),
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { hashPassword } = await import('./identity/password');
const { RATE_LIMITS, hit, resetMemoryRateLimits } = await import('./rateLimit');
const { passwordLockout } = await import('@/services/auth/passwordCheck');
const schema = await import('@/models/Schema');
const {
  authorizeCredentials,
  HELD_SIGN_IN_TTL_MS,
  isMfaCompletionProof,
  jwtCallback,
  mfaCompletionProof,
  sessionCallback,
  sessionRefreshProof,
} = await import('./Auth');

const SAM = { id: 'usr-sam', email: 'sam@northwind.example' };

function from(ip: string) {
  return new Request('https://app.northwind.example/api/auth/callback/credentials', { method: 'POST', headers: { 'x-forwarded-for': ip } });
}

async function locked(email: string, ip: string | null = null): Promise<boolean> {
  return !(await passwordLockout(email, ip)).allowed;
}

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
  vi.stubEnv('VOCION_DEMO_SEED_DIR', '');
  await db.delete(schema.rateLimitHitSchema);
  await db.delete(schema.userMfaRecoveryCodeSchema);
  await db.delete(schema.userMfaSchema);
  await db.delete(schema.sourceDekSchema);
  await db.delete(schema.inviteSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.authAccountSchema);
  await db.delete(schema.tenantAccountSchema);
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

  it('locks an email from an address after ten wrong passwords from it, even with the right one', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerEmailIp.limit; i++) {
      expect(await authorizeCredentials({ email: SAM.email, password: 'wrong' }, from('203.0.113.7'))).toBeNull();
    }

    const refusal = await authorizeCredentials({ email: SAM.email, password: 'right-password' }, from('203.0.113.7')).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(CredentialsSignin);
    expect((refusal as CredentialsSignin).code).toBe('rate_limited');
  });

  it('still signs the person in from their own address — a stranger\'s wrong passwords lock only the stranger\'s', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerEmailIp.limit + 3; i++) {
      await authorizeCredentials({ email: SAM.email, password: 'wrong' }, from('203.0.113.7')).catch(() => null);
    }

    expect(await authorizeCredentials({ email: SAM.email, password: 'right-password' }, from('198.51.100.4'))).toMatchObject({ id: SAM.id });
  });

  it('locks the email everywhere once attempts from every address together reach the ceiling', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerAccount.limit; i++) {
      await hit(RATE_LIMITS.signInFailuresPerAccount, SAM.email);
    }

    const refusal = await authorizeCredentials({ email: SAM.email, password: 'right-password' }, from('198.51.100.4')).catch((error: unknown) => error);

    expect((refusal as CredentialsSignin).code).toBe('rate_limited');
  });

  it('lets at most ten of twenty simultaneous wrong passwords reach bcrypt', async () => {
    const burst = await Promise.all(Array.from({ length: 20 }, () =>
      authorizeCredentials({ email: SAM.email, password: 'wrong' }, from('203.0.113.7')).then(() => 'checked', (error: unknown) => (error as CredentialsSignin).code)));

    // Counting before checking is what holds this: checking first let every
    // request in the burst pass before any failure was recorded.
    expect(burst.filter(r => r === 'checked').length).toBeLessThanOrEqual(RATE_LIMITS.signInFailuresPerEmailIp.limit);
    expect(burst.filter(r => r === 'rate_limited').length).toBeGreaterThanOrEqual(20 - RATE_LIMITS.signInFailuresPerEmailIp.limit);
    expect(await locked(SAM.email, '203.0.113.7')).toBe(true);
  });

  it('locks an email with no login the same way, so the lockout says nothing about who has one', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerEmailIp.limit; i++) {
      await authorizeCredentials({ email: 'nobody@northwind.example', password: 'wrong' });
    }

    expect(await locked('nobody@northwind.example')).toBe(true);
  });

  it('forgets earlier failures once the right password arrives', async () => {
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerEmailIp.limit - 1; i++) {
      await authorizeCredentials({ email: SAM.email, password: 'wrong' });
    }
    await authorizeCredentials({ email: SAM.email, password: 'right-password' });

    expect(await locked(SAM.email)).toBe(false);
  });

  it('never locks the demo sandbox\'s shared login, which every visitor uses', async () => {
    vi.stubEnv('VOCION_DEMO_SEED_DIR', 'demo-seed');
    vi.stubEnv('VOCION_DEMO_HINT_EMAIL', SAM.email);
    for (let i = 0; i < RATE_LIMITS.signInFailuresPerEmailIp.limit + 2; i++) {
      await authorizeCredentials({ email: SAM.email, password: 'wrong' }, from('203.0.113.7'));
    }

    expect(await locked(SAM.email, '203.0.113.7')).toBe(false);
    expect(await authorizeCredentials({ email: SAM.email, password: 'right-password' }, from('203.0.113.7'))).toMatchObject({ id: SAM.id });
  });
});

describe('invites joined at sign-in', () => {
  const NEXT_WEEK = () => new Date(Date.now() + 7 * 86_400_000);

  async function northwindInvitesSam() {
    await db.insert(schema.tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
    await db.insert(schema.inviteSchema).values({ id: 'inv-sam', accountId: 'acct-northwind', email: 'Sam@Northwind.example', role: 'member', token: 'tok-sam', expiresAt: NEXT_WEEK() });
  }

  async function samsOrgs() {
    const rows = await db.select().from(schema.accountMembershipSchema).where(eq(schema.accountMembershipSchema.userId, SAM.id));
    return rows.map(r => `${r.accountId}:${r.role}`);
  }

  it('accepts an invite still open for the login\'s address when the password signs in — no second registration', async () => {
    await northwindInvitesSam();

    const token = await jwtCallback(signInParams({} as JWT));

    expect(token).toMatchObject({ id: SAM.id, mfa: null });
    expect(await samsOrgs()).toEqual(['acct-northwind:member']);

    const [invite] = await db.select().from(schema.inviteSchema).where(eq(schema.inviteSchema.id, 'inv-sam'));

    expect(invite?.acceptedAt).toBeInstanceOf(Date);
  });

  it('waits for the second factor before joining anything', async () => {
    await northwindInvitesSam();
    await enableMfaForSam();

    const held = await jwtCallback(signInParams({} as JWT));

    expect(held.mfa).toBe('verify');
    expect(await samsOrgs()).toEqual([]);

    await jwtCallback(updateParams(held, { mfaProof: mfaCompletionProof(SAM.id) }));

    expect(await samsOrgs()).toEqual(['acct-northwind:member']);
  });

  it('never lets a failure joining invites stop the sign-in', async () => {
    const { joinPendingInvites } = await import('@/services/auth/joinInvites');
    vi.mocked(joinPendingInvites).mockRejectedValueOnce(new Error('invite store down'));

    await northwindInvitesSam();

    expect(await jwtCallback(signInParams({} as JWT))).toMatchObject({ id: SAM.id, mfa: null });
    expect(joinPendingInvites).toHaveBeenCalledWith(SAM.id);
    // The invite keeps its link, and the next sign-in joins it.
    expect(await samsOrgs()).toEqual([]);

    await jwtCallback(signInParams({} as JWT));

    expect(await samsOrgs()).toEqual(['acct-northwind:member']);
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
    expect(token.mfaSince).toEqual(expect.any(Number));
    expect(token.projectId).toBeUndefined();
  });

  it('stamps a finished sign-in with when it finished and the person\'s session version', async () => {
    await db.update(schema.userSchema).set({ sessionVersion: 3 });

    const token = await jwtCallback(signInParams({} as JWT));

    expect(token).toMatchObject({ sessionVersion: 3, authTime: expect.any(Number) });
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
    const held = { id: SAM.id, mfa: 'verify', mfaSince: Date.now() } as JWT;

    const token = await jwtCallback(updateParams({ ...held }, { mfaProof: mfaCompletionProof(SAM.id) }));

    expect(token).toMatchObject({ mfa: null, projectId: 'proj-ops' });
  });

  it('will not finish a hold older than ten minutes, even with the proof', async () => {
    const stale = { id: SAM.id, mfa: 'verify', mfaSince: Date.now() - HELD_SIGN_IN_TTL_MS - 1_000 } as JWT;

    const token = await jwtCallback(updateParams({ ...stale }, { mfaProof: mfaCompletionProof(SAM.id) }));

    expect(token.mfa).toBe('verify');
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
    const session = await sessionCallback({ session: emptySession(), token: { id: SAM.id, mfa: 'verify', mfaSince: Date.now() } as JWT });

    expect(session.user.id).toBe('');
    expect(session.user.projectId).toBeNull();
    expect(session.mfa).toEqual({ state: 'verify', userId: SAM.id });
  });

  it('sends a hold older than ten minutes back to the password — no step is left to finish', async () => {
    const session = await sessionCallback({ session: emptySession(), token: { id: SAM.id, mfa: 'verify', mfaSince: Date.now() - HELD_SIGN_IN_TTL_MS - 1_000 } as JWT });

    expect(session.user.id).toBe('');
    expect(session.mfa).toBeNull();
  });

  it('is a normal session once nothing is owed', async () => {
    const session = await sessionCallback({ session: emptySession(), token: { id: SAM.id, mfa: null, authTime: 1_790_000_000_000 } as JWT });

    expect(session.user).toMatchObject({ id: SAM.id, projectId: 'proj-ops' });
    expect(session.mfa).toBeNull();
    expect(session.authTime).toBe(1_790_000_000_000);
  });
});

describe('ending other sessions', () => {
  it('reads a token issued before the person\'s last password or two-step change as signed out', async () => {
    await db.update(schema.userSchema).set({ sessionVersion: 2 });

    const older = await sessionCallback({ session: emptySession(), token: { id: SAM.id, sessionVersion: 1 } as JWT });
    const current = await sessionCallback({ session: emptySession(), token: { id: SAM.id, sessionVersion: 2 } as JWT });

    expect(older.user.id).toBe('');
    expect(older.user.projectId).toBeNull();
    expect(current.user.id).toBe(SAM.id);
  });

  it('keeps a token from before session versions existed while the person has changed nothing', async () => {
    const session = await sessionCallback({ session: emptySession(), token: { id: SAM.id } as JWT });

    expect(session.user.id).toBe(SAM.id);
  });

  it('reads a token for a person who no longer exists as signed out', async () => {
    const session = await sessionCallback({ session: emptySession(), token: { id: 'usr-gone', sessionVersion: 0 } as JWT });

    expect(session.user.id).toBe('');
  });

  it('moves the session a change was made from onto the new version, on the server\'s proof only', async () => {
    await db.update(schema.userSchema).set({ sessionVersion: 4 });

    const forged = await jwtCallback(updateParams({ id: SAM.id, sessionVersion: 3 } as JWT, { sessionProof: 'keep-me', sessionVersion: 4 }));

    expect(forged.sessionVersion).toBe(3);

    const kept = await jwtCallback(updateParams({ id: SAM.id, sessionVersion: 3 } as JWT, { sessionProof: sessionRefreshProof(SAM.id) }));

    expect(kept.sessionVersion).toBe(4);
  });

  it('will not take a second-factor proof as a session refresh, or the other way round', async () => {
    await db.update(schema.userSchema).set({ sessionVersion: 1 });

    const token = await jwtCallback(updateParams({ id: SAM.id, sessionVersion: 0 } as JWT, { sessionProof: mfaCompletionProof(SAM.id) }));

    expect(token.sessionVersion).toBe(0);
    expect(isMfaCompletionProof(sessionRefreshProof(SAM.id), SAM.id)).toBe(false);
  });
});
