/**
 * `POST /api/signup`: accepting an invite is the only way to make a login
 * through the web, and it takes the same path (`acceptInviteAsNewUser`) as a
 * first sign-in with Google, Microsoft or an email link. Real rows in PGlite.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/identity/password', () => ({
  hashPassword: vi.fn(async () => 'hashed'),
}));

const { db } = await import('@/libs/DB');
const { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { POST } = await import('./route');

const IN_A_MINUTE = new Date(Date.now() + 60_000);
const A_MINUTE_AGO = new Date(Date.now() - 60_000);

function signupRequest(body: Record<string, unknown>) {
  return new Request('https://example.test/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function addInvite(over: Partial<typeof inviteSchema.$inferInsert> = {}) {
  await db.insert(inviteSchema).values({ id: 'inv-1', accountId: 'acct-1', email: 'invited@example.test', role: 'admin', token: 'tok-1', expiresAt: IN_A_MINUTE, ...over });
}

beforeEach(async () => {
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-1', name: 'Northwind', slug: 'northwind' });
});

describe('POST /api/signup', () => {
  it('rejects a signup with no invite token, even on an instance with no users', async () => {
    const res = await POST(signupRequest({
      name: 'Squatter',
      email: 'squatter@example.test',
      password: 'password123',
      accountName: 'Claimed',
    }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'An invite token is required to create an account.' });
    expect(await db.select().from(userSchema)).toHaveLength(0);
  });

  it('rejects an unparseable body', async () => {
    const res = await POST(new Request('https://example.test/api/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }));

    expect(res.status).toBe(403);
  });

  it('refuses to make a second user for an email that already has a login, and tells the form to send them to sign in', async () => {
    await db.insert(userSchema).values({ id: 'usr-existing', email: 'taken@example.test' });

    const res = await POST(signupRequest({ name: 'Someone', email: 'Taken@example.test', password: 'password123', inviteToken: 'tok-1' }));

    expect(res.status).toBe(409);
    // The form turns this into "sign in to accept", which joins the account
    // on the existing user (`/api/invites/accept`).
    await expect(res.json()).resolves.toMatchObject({ code: 'EXISTING_USER' });
  });

  it('rejects an invite token that does not exist', async () => {
    const res = await POST(signupRequest({ name: 'Someone', email: 'someone@example.test', password: 'password123', inviteToken: 'tok-unknown' }));

    expect(res.status).toBe(404);
  });

  it('rejects an invite already accepted', async () => {
    await addInvite({ email: 'someone@example.test', acceptedAt: A_MINUTE_AGO });

    const res = await POST(signupRequest({ name: 'Someone', email: 'someone@example.test', password: 'password123', inviteToken: 'tok-1' }));

    expect(res.status).toBe(410);
  });

  it('rejects an expired invite', async () => {
    await addInvite({ email: 'someone@example.test', expiresAt: A_MINUTE_AGO });

    const res = await POST(signupRequest({ name: 'Someone', email: 'someone@example.test', password: 'password123', inviteToken: 'tok-1' }));

    expect(res.status).toBe(410);
  });

  it('rejects an invite issued for a different email', async () => {
    await addInvite();

    const res = await POST(signupRequest({ name: 'Someone', email: 'someone-else@example.test', password: 'password123', inviteToken: 'tok-1' }));

    expect(res.status).toBe(403);
    expect(await db.select().from(userSchema)).toHaveLength(0);
  });

  it('creates the user and consumes the invite when everything matches', async () => {
    await addInvite();

    const res = await POST(signupRequest({ name: 'Invited', email: 'invited@example.test', password: 'password123', inviteToken: 'tok-1' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, mode: 'invite-accept' });

    const [user] = await db.select().from(userSchema).where(eq(userSchema.email, 'invited@example.test'));

    expect(user).toMatchObject({ name: 'Invited', passwordHash: 'hashed' });
    expect(await db.select({ role: accountMembershipSchema.role }).from(accountMembershipSchema)).toEqual([{ role: 'admin' }]);

    const [invite] = await db.select().from(inviteSchema);

    expect(invite?.acceptedAt).toBeInstanceOf(Date);
  });
});
