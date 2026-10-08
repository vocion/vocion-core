/**
 * The profile page's sign-in methods, and the unlink guard: a person may
 * unlink a provider only while a password or another offered provider
 * still gets them in.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { authAccountSchema, userActivityEventSchema, userSchema } = await import('@/models/Schema');
const { listSignInMethods, unlinkProblem, unlinkSignInMethod } = await import('./signInMethods');

const ACTOR = { orgId: 'proj-northwind', projectId: 'proj-northwind', accountId: 'acct-northwind', userId: 'usr-dana' };

describe('unlinkProblem', () => {
  const offered = ['google', 'microsoft-entra-id'];

  it('lets a provider go while a password remains', () => {
    expect(unlinkProblem({ provider: 'google', hasPassword: true, linkedProviders: ['google'], offeredProviders: offered })).toBeNull();
  });

  it('lets a provider go while another offered provider remains', () => {
    expect(unlinkProblem({ provider: 'google', hasPassword: false, linkedProviders: ['google', 'microsoft-entra-id'], offeredProviders: offered })).toBeNull();
  });

  it('refuses to remove the last way in', () => {
    expect(unlinkProblem({ provider: 'google', hasPassword: false, linkedProviders: ['google'], offeredProviders: offered }))
      .toMatch(/only way to sign in/);
  });

  it('does not count a linked provider this deployment no longer offers', () => {
    expect(unlinkProblem({ provider: 'google', hasPassword: false, linkedProviders: ['google', 'microsoft-entra-id'], offeredProviders: ['google'] }))
      .toMatch(/only way to sign in/);
  });

  it('says so when the provider is not linked at all', () => {
    expect(unlinkProblem({ provider: 'google', hasPassword: true, linkedProviders: [], offeredProviders: offered })).toMatch(/not linked/);
  });
});

describe('listSignInMethods / unlinkSignInMethod', () => {
  beforeEach(async () => {
    vi.stubEnv('AUTH_GOOGLE_ID', 'northwind-google-client');
    vi.stubEnv('AUTH_GOOGLE_SECRET', 'northwind-google-secret');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'northwind-entra-client');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'northwind-entra-secret');
    vi.stubEnv('VOCION_MAIL_ENABLED', '');
    await db.delete(userActivityEventSchema);
    await db.delete(authAccountSchema);
    await db.delete(userSchema);
    await db.insert(userSchema).values({ id: 'usr-dana', email: 'dana@northwind.example', name: 'Dana' });
    await db.insert(authAccountSchema).values({ userId: 'usr-dana', type: 'oidc', provider: 'google', providerAccountId: 'google-dana' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists the password, each offered provider, and what stops an unlink', async () => {
    await expect(listSignInMethods('usr-dana')).resolves.toEqual({
      email: 'dana@northwind.example',
      password: false,
      emailLink: false,
      providers: [
        { id: 'google', label: 'Google', linked: true, offered: true, unlinkProblem: expect.stringMatching(/only way to sign in/) },
        { id: 'microsoft-entra-id', label: 'Microsoft', linked: false, offered: true, unlinkProblem: null },
      ],
    });
  });

  it('refuses to unlink a Google-only login\'s Google', async () => {
    const result = await unlinkSignInMethod(ACTOR, 'google');

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/only way to sign in/) });
    expect(await db.select().from(authAccountSchema).where(eq(authAccountSchema.userId, 'usr-dana'))).toHaveLength(1);
  });

  it('unlinks once Microsoft is linked too, and records it', async () => {
    await db.insert(authAccountSchema).values({ userId: 'usr-dana', type: 'oidc', provider: 'microsoft-entra-id', providerAccountId: 'entra-dana' });

    await expect(unlinkSignInMethod(ACTOR, 'google')).resolves.toEqual({ ok: true });

    const left = await db.select({ provider: authAccountSchema.provider }).from(authAccountSchema).where(eq(authAccountSchema.userId, 'usr-dana'));

    expect(left).toEqual([{ provider: 'microsoft-entra-id' }]);

    const events = await db.select().from(userActivityEventSchema).where(eq(userActivityEventSchema.eventType, 'auth.method_unlinked'));

    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).toEqual({ provider: 'google' });
  });

  it('unlinks when a password is set', async () => {
    await db.update(userSchema).set({ passwordHash: 'hash' }).where(eq(userSchema.id, 'usr-dana'));

    await expect(unlinkSignInMethod(ACTOR, 'google')).resolves.toEqual({ ok: true });
  });
});
