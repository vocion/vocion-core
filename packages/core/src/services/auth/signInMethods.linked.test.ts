/**
 * "Google added to your sign-in methods" (real rows, PGlite).
 *
 * Pinned: a provider linked to a login that already had a way in is
 * recorded on the adoption stream and told to the person as a
 * `sign-in-method-added` notification in the workspace they land in, opening
 * their profile; a provider that is the login's only way in — the login this
 * very sign-in made from an invite — is how they joined, not an addition, so
 * nobody is told; and it never throws, since it rides on a sign-in.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const tenancy = vi.hoisted(() => ({ fail: false }));
vi.mock('@/libs/tenancy', () => ({
  resolveTenancyForUser: vi.fn(async () => {
    if (tenancy.fail) {
      throw new Error('tenancy unavailable');
    }
    return { accountId: 'acct-northwind', projectId: 'proj-northwind-ops', role: 'member', workspaceRole: 'member' };
  }),
}));

const { db } = await import('@/libs/DB');
const schema = await import('@/models/Schema');
const { methodAddedNotice, signInMethodLinked } = await import('./signInMethods');

async function notificationsFor(userId: string) {
  return db.select().from(schema.notificationSchema).where(and(eq(schema.notificationSchema.userId, userId), eq(schema.notificationSchema.kind, 'sign-in-method-added')));
}

beforeEach(async () => {
  tenancy.fail = false;
  vi.stubEnv('AUTH_GOOGLE_ID', 'northwind-google-client');
  vi.stubEnv('AUTH_GOOGLE_SECRET', 'northwind-google-secret');
  await db.delete(schema.notificationDeliverySchema);
  await db.delete(schema.notificationSchema);
  await db.delete(schema.eventLogSchema);
  await db.delete(schema.userActivityEventSchema);
  await db.delete(schema.authAccountSchema);
  await db.delete(schema.accountMembershipSchema);
  await db.delete(schema.projectSchema);
  await db.delete(schema.tenantAccountSchema);
  await db.delete(schema.userSchema);
  await db.insert(schema.tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
  await db.insert(schema.projectSchema).values({ id: 'proj-northwind-ops', accountId: 'acct-northwind', slug: 'northwind-ops', name: 'Northwind Ops' });
  await db.insert(schema.userSchema).values([
    { id: 'usr-sam', email: 'sam@northwind.example', name: 'Sam', passwordHash: 'hash' },
    { id: 'usr-dana', email: 'dana@northwind.example', name: 'Dana', passwordHash: null },
  ]);
  await db.insert(schema.accountMembershipSchema).values([
    { accountId: 'acct-northwind', userId: 'usr-sam', role: 'member' },
    { accountId: 'acct-northwind', userId: 'usr-dana', role: 'member' },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('methodAddedNotice', () => {
  it('names the provider and says what to do if it was not you', () => {
    expect(methodAddedNotice('Google')).toEqual({
      title: 'Google added to your sign-in methods',
      body: 'You can now sign in with Google. If you did not add it, remove it from your profile and change your password.',
    });
  });
});

describe('signInMethodLinked', () => {
  it('tells a person with a password that Google was added, opening their profile', async () => {
    await db.insert(schema.authAccountSchema).values({ userId: 'usr-sam', type: 'oidc', provider: 'google', providerAccountId: 'google-sam' });

    await signInMethodLinked('usr-sam', 'google');

    const rows = await notificationsFor('usr-sam');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: 'proj-northwind-ops',
      title: 'Google added to your sign-in methods',
      link: '/w/northwind-ops/dashboard/profile',
      eventType: 'account.sign_in_method_added',
    });

    const recorded = await db.select().from(schema.userActivityEventSchema).where(eq(schema.userActivityEventSchema.userId, 'usr-sam'));

    expect(recorded.map(r => r.eventType)).toContain('auth.method_linked');
  });

  it('tells nobody when the provider is the login\'s only way in — that is how they joined', async () => {
    await db.insert(schema.authAccountSchema).values({ userId: 'usr-dana', type: 'oidc', provider: 'google', providerAccountId: 'google-dana' });

    await signInMethodLinked('usr-dana', 'google');

    expect(await notificationsFor('usr-dana')).toHaveLength(0);
  });

  it('tells a password-less person who adds a second provider', async () => {
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_ID', 'northwind-entra-client');
    vi.stubEnv('AUTH_MICROSOFT_ENTRA_ID_SECRET', 'northwind-entra-secret');
    await db.insert(schema.authAccountSchema).values([
      { userId: 'usr-dana', type: 'oidc', provider: 'google', providerAccountId: 'google-dana' },
      { userId: 'usr-dana', type: 'oidc', provider: 'microsoft-entra-id', providerAccountId: 'entra-dana' },
    ]);

    await signInMethodLinked('usr-dana', 'microsoft-entra-id');

    expect((await notificationsFor('usr-dana')).map(r => r.title)).toEqual(['Microsoft added to your sign-in methods']);
  });

  it('never throws', async () => {
    tenancy.fail = true;

    await expect(signInMethodLinked('usr-sam', 'google')).resolves.toBeUndefined();
    expect(await notificationsFor('usr-sam')).toHaveLength(0);
  });
});
