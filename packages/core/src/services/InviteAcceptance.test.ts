/**
 * An existing login accepting an invite into another account (vocion-core#128).
 *
 * Sam is an admin of Metacto and is invited to Contoso as a member. Both
 * accounts own a `sales` workspace, so the landing URL has to name Contoso.
 * Real rows in PGlite.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { acceptInviteAsExistingUser, describeInviteForUser } = await import('./InviteAcceptance');

const IN_A_WEEK = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const LAST_WEEK = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

/**
 * An invite row with sensible defaults: open, to Sam, into Contoso as a member.
 * @param overrides - The columns this test cares about.
 */
function invite(overrides: Partial<typeof inviteSchema.$inferInsert> & { token: string }) {
  return { id: `inv-${overrides.token}`, accountId: 'acct-contoso', email: 'sam@example.com', role: 'member', expiresAt: IN_A_WEEK, ...overrides };
}

/** Sam's memberships, as `accountId:role`. */
async function samsMemberships(): Promise<string[]> {
  const rows = await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, 'user-sam'));
  return rows.map(r => `${r.accountId}:${r.role}`).sort();
}

beforeEach(async () => {
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values([
    { id: 'user-sam', email: 'sam@example.com', name: 'Sam' },
    { id: 'user-kim', email: 'kim@example.com', name: 'Kim' },
  ]);
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
    { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-metacto', userId: 'user-sam', role: 'admin' },
    { accountId: 'acct-contoso', userId: 'user-kim', role: 'admin' },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-metacto-sales', accountId: 'acct-metacto', slug: 'sales', name: 'Metacto Sales', createdAt: new Date('2025-01-01T00:00:00Z') },
    { id: 'proj-contoso-sales', accountId: 'acct-contoso', slug: 'sales', name: 'Contoso Sales', createdAt: new Date('2025-02-01T00:00:00Z') },
    { id: 'proj-contoso-ops', accountId: 'acct-contoso', slug: 'ops', name: 'Contoso Ops', createdAt: new Date('2025-03-01T00:00:00Z') },
  ]);
});

describe('acceptInviteAsExistingUser', () => {
  it('adds Contoso to Sam\'s existing user with the invite\'s role, and opens Contoso\'s workspace by name', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-open' }));

    const result = await acceptInviteAsExistingUser('user-sam', 'tok-open');

    // Contoso's oldest workspace shares its slug with Metacto's, so the URL
    // must say which account.
    expect(result).toEqual({ ok: true, accountId: 'acct-contoso', openPath: '/w/sales/dashboard?account=contoso' });
    // One login, two memberships, each with its own role.
    expect(await samsMemberships()).toEqual(['acct-contoso:member', 'acct-metacto:admin']);
    expect(await db.select().from(userSchema).where(eq(userSchema.email, 'sam@example.com'))).toHaveLength(1);

    const [row] = await db.select().from(inviteSchema).where(eq(inviteSchema.token, 'tok-open'));

    expect(row?.acceptedAt).toBeInstanceOf(Date);
  });

  it('gives an admin invite admin on the new account only', async () => {
    await db.update(accountMembershipSchema).set({ role: 'member' }).where(eq(accountMembershipSchema.userId, 'user-sam'));
    await db.insert(inviteSchema).values(invite({ token: 'tok-admin', role: 'admin' }));

    await acceptInviteAsExistingUser('user-sam', 'tok-admin');

    expect(await samsMemberships()).toEqual(['acct-contoso:admin', 'acct-metacto:member']);
  });

  it('accepts an invite whose email differs from the login only in case', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-caps', email: 'Sam@Example.com' }));

    expect(await acceptInviteAsExistingUser('user-sam', 'tok-caps')).toMatchObject({ ok: true });
  });

  it('refuses an invite addressed to someone else, and adds nothing', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-other', email: 'lee@example.com' }));

    expect(await acceptInviteAsExistingUser('user-sam', 'tok-other')).toEqual({ ok: false, status: 403, error: 'This invite was issued for a different email.' });
    expect(await samsMemberships()).toEqual(['acct-metacto:admin']);
  });

  it('refuses an invite into an account they are already in, and keeps their role there', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-metacto', accountId: 'acct-metacto', role: 'member' }));

    expect(await acceptInviteAsExistingUser('user-sam', 'tok-metacto')).toEqual({ ok: false, status: 409, error: 'You are already a member of this account.' });
    expect(await samsMemberships()).toEqual(['acct-metacto:admin']);
  });

  it('accepts an invite once: the second try is refused as used', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-once' }));
    await acceptInviteAsExistingUser('user-sam', 'tok-once');
    // Removed from Contoso since, so only the used invite stands in the way.
    await db.delete(accountMembershipSchema).where(eq(accountMembershipSchema.accountId, 'acct-contoso'));

    expect(await acceptInviteAsExistingUser('user-sam', 'tok-once')).toEqual({ ok: false, status: 410, error: 'This invite has already been used.' });
  });

  it('adds one membership when the same invite is accepted twice at once', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-race' }));

    const results = await Promise.all([acceptInviteAsExistingUser('user-sam', 'tok-race'), acceptInviteAsExistingUser('user-sam', 'tok-race')]);

    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await samsMemberships()).toEqual(['acct-contoso:member', 'acct-metacto:admin']);
  });

  it('refuses an expired invite', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-old', expiresAt: LAST_WEEK }));

    expect(await acceptInviteAsExistingUser('user-sam', 'tok-old')).toEqual({ ok: false, status: 410, error: 'This invite has expired.' });
  });

  it('refuses a token that names no invite', async () => {
    expect(await acceptInviteAsExistingUser('user-sam', 'tok-nothing')).toEqual({ ok: false, status: 404, error: 'Invalid invite token.' });
  });

  it('with access enforced, joins a new member who holds no workspace yet and names no URL, rather than one that would 404', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-enforced' }));
    process.env.VOCION_ENFORCE_WORKSPACE_ACCESS = '1';
    try {
      expect(await acceptInviteAsExistingUser('user-sam', 'tok-enforced')).toEqual({ ok: true, accountId: 'acct-contoso', openPath: null });
    } finally {
      delete process.env.VOCION_ENFORCE_WORKSPACE_ACCESS;
    }
  });
});

describe('describeInviteForUser', () => {
  it('offers an open invite with the account\'s name and the role it grants', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-open', role: 'admin' }));

    expect(await describeInviteForUser('user-sam', 'tok-open')).toEqual({ accountName: 'Contoso', role: 'admin', standing: 'open', openPath: null });
  });

  it('says an invite for another email is not theirs, without saying whose it is', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-other', email: 'lee@example.com' }));

    const summary = await describeInviteForUser('user-sam', 'tok-other');

    expect(summary?.standing).toBe('other-email');
    expect(JSON.stringify(summary)).not.toContain('lee@example.com');
  });

  it('tells someone already in the account where to open it, even once the invite is used', async () => {
    await db.insert(inviteSchema).values(invite({ token: 'tok-used', acceptedAt: new Date() }));
    await db.insert(accountMembershipSchema).values({ accountId: 'acct-contoso', userId: 'user-sam', role: 'member' });

    expect(await describeInviteForUser('user-sam', 'tok-used')).toMatchObject({ standing: 'member', openPath: '/w/sales/dashboard?account=contoso' });
  });

  it('marks a used invite and an expired one, and knows nothing of an unknown token', async () => {
    await db.insert(inviteSchema).values([invite({ token: 'tok-used', acceptedAt: new Date() }), invite({ token: 'tok-old', expiresAt: LAST_WEEK })]);

    expect((await describeInviteForUser('user-sam', 'tok-used'))?.standing).toBe('accepted');
    expect((await describeInviteForUser('user-sam', 'tok-old'))?.standing).toBe('expired');
    expect(await describeInviteForUser('user-sam', 'tok-nothing')).toBeNull();
  });
});
