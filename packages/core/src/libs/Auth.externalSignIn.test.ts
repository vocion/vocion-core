/**
 * The Auth.js wiring the invite-only rules depend on: the adapter never
 * makes a user, never links to "whoever is signed in", and keeps no provider
 * tokens; the `signIn` callback sends every non-password way in through the
 * gate. Real rows (PGlite).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// next-auth's ESM build imports `next/server` without an extension, which
// plain Node cannot resolve outside Next. These tests call the adapter and
// the callback directly, so Auth.js itself is a stand-in.
vi.mock('next-auth', () => ({
  default: () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock('next-auth/providers/credentials', () => ({ default: (config: unknown) => config }));
vi.mock('next-auth/providers/google', () => ({ default: (config: unknown) => ({ id: 'google', options: config }) }));
vi.mock('next-auth/providers/microsoft-entra-id', () => ({ default: (config: unknown) => ({ id: 'microsoft-entra-id', options: config }) }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.20' }),
  cookies: async () => ({ get: () => undefined }),
}));

process.env.AUTH_GOOGLE_ID = 'northwind-google-client';
process.env.AUTH_GOOGLE_SECRET = 'northwind-google-secret';
process.env.AUTH_SECRET ??= 'northwind-test-secret-not-a-real-one';

const { db } = await import('@/libs/DB');
const { authAccountSchema, inviteSchema, tenantAccountSchema, userSchema, verificationTokenSchema } = await import('@/models/Schema');
const { buildAdapter, signInCallback } = await import('./Auth');

beforeEach(async () => {
  await db.delete(authAccountSchema);
  await db.delete(inviteSchema);
  await db.delete(userSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(userSchema).values({ id: 'usr-sam', email: 'sam@northwind.example', passwordHash: 'hash' });
});

describe('buildAdapter', () => {
  it('never creates a user', async () => {
    await expect(buildAdapter().createUser!({ id: 'x', email: 'mallory@acme.example', emailVerified: null })).rejects.toThrow(/accepting an invite/);
  });

  it('does not hand Auth.js the signed-in user to link to', async () => {
    await expect(buildAdapter().getUser!('usr-sam')).resolves.toBeNull();
  });

  it('keeps who a link is, and drops the provider\'s tokens', async () => {
    await buildAdapter().linkAccount!({
      userId: 'usr-sam',
      type: 'oidc',
      provider: 'google',
      providerAccountId: 'google-sam',
      access_token: 'ya29.northwind-access',
      refresh_token: '1//northwind-refresh',
      id_token: 'eyJ.northwind.id',
      token_type: 'bearer',
    });

    const [row] = await db.select().from(authAccountSchema);

    expect(row).toMatchObject({ userId: 'usr-sam', provider: 'google', providerAccountId: 'google-sam', access_token: null, refresh_token: null, id_token: null });
  });
});

describe('buildAdapter — email-link tokens', () => {
  it('sweeps expired tokens when it stores a new one, and keeps live ones', async () => {
    await db.delete(verificationTokenSchema);
    await db.insert(verificationTokenSchema).values([
      { identifier: 'nobody@acme.example', token: 'hash-old', expires: new Date(Date.now() - 60_000) },
      { identifier: 'sam@northwind.example', token: 'hash-live', expires: new Date(Date.now() + 60_000) },
    ]);

    await buildAdapter().createVerificationToken!({ identifier: 'sam@northwind.example', token: 'hash-new', expires: new Date(Date.now() + 900_000) });

    const left = await db.select({ token: verificationTokenSchema.token }).from(verificationTokenSchema);

    expect(left.map(r => r.token).sort()).toEqual(['hash-live', 'hash-new']);
  });
});

describe('signInCallback', () => {
  it('leaves the password to `authorize`', async () => {
    await expect(signInCallback({ user: { id: 'usr-sam' }, account: { type: 'credentials', provider: 'credentials', providerAccountId: 'usr-sam' } } as never)).resolves.toBe(true);
  });

  it('refuses a provider this deployment does not offer', async () => {
    await expect(signInCallback({
      user: { name: 'Sam' },
      account: { type: 'oidc', provider: 'microsoft-entra-id', providerAccountId: 'entra-sam' },
      profile: { email: 'sam@northwind.example' },
    } as never)).resolves.toBe(false);
  });

  it('sends a Google sign-in through the invite-only gate with Google\'s own verdict on the address', async () => {
    const account = { type: 'oidc', provider: 'google', providerAccountId: 'google-sam' };

    await expect(signInCallback({ user: { name: 'Sam' }, account, profile: { email: 'sam@northwind.example', email_verified: true } } as never)).resolves.toBe(true);
    await expect(signInCallback({ user: { name: 'Sam' }, account, profile: { email: 'sam@northwind.example', email_verified: false } } as never))
      .resolves
      .toBe('/sign-in?error=AccessDenied&reason=unverified-email&provider=google');
    await expect(signInCallback({ user: {}, account: { ...account, providerAccountId: 'google-mallory' }, profile: { email: 'mallory@acme.example', email_verified: true } } as never))
      .resolves
      .toBe('/sign-in?error=AccessDenied&reason=no-invite&provider=google');
  });

  it('answers every link request alike until the limit, then with the wait', async () => {
    const request = (n: number) => signInCallback({
      user: { email: 'nobody@acme.example' },
      account: { type: 'email', provider: 'email', providerAccountId: 'nobody@acme.example' },
      email: { verificationRequest: true },
    } as never).then(answer => [n, answer]);

    const answers = await Promise.all([1, 2, 3, 4].map(request));

    expect(answers.map(([, a]) => a)).toEqual([true, true, true, expect.stringMatching(/^\/sign-in\?error=EmailLinkRateLimited&retryAfter=\d+$/)]);
  });

  it('refuses a used email link for an address nobody invited', async () => {
    await expect(signInCallback({
      user: { email: 'mallory@acme.example' },
      account: { type: 'email', provider: 'email', providerAccountId: 'mallory@acme.example' },
    } as never)).resolves.toBe('/sign-in?error=AccessDenied&reason=no-invite');
  });
});
