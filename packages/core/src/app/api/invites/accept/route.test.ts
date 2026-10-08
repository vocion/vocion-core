/**
 * `POST /api/invites/accept` (vocion-core#128): the invite is accepted by
 * whoever the session says is signed in, never by an id in the body. Real
 * rows in PGlite; only the session is stubbed. The acceptance rules
 * themselves are in `services/InviteAcceptance.test.ts`.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { auth } = await import('@/libs/Auth');
const { accountMembershipSchema, inviteSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { POST } = await import('./route');

const mockAuth = vi.mocked(auth);

/**
 * A POST to the route with a JSON body.
 * @param body - What to send.
 */
function post(body: unknown) {
  return new Request('http://localhost/api/invites/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  await db.delete(inviteSchema);
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values({ id: 'user-sam', email: 'sam@example.com', name: 'Sam' });
  await db.insert(tenantAccountSchema).values({ id: 'acct-contoso', name: 'Contoso', slug: 'contoso' });
  await db.insert(projectSchema).values({ id: 'proj-contoso-ops', accountId: 'acct-contoso', slug: 'ops', name: 'Contoso Ops' });
  await db.insert(inviteSchema).values({
    id: 'inv-1',
    accountId: 'acct-contoso',
    email: 'sam@example.com',
    role: 'member',
    token: 'tok-1',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
});

describe('POST /api/invites/accept', () => {
  it('adds the signed-in person to the account and answers with where to go', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-sam' } } as never);

    const res = await POST(post({ inviteToken: 'tok-1' }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, openPath: '/w/ops/dashboard?org=contoso' });
    expect(await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, 'user-sam'))).toHaveLength(1);
  });

  it('401s without a session and leaves the invite open', async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await POST(post({ inviteToken: 'tok-1' }));

    expect(res.status).toBe(401);

    const [row] = await db.select().from(inviteSchema).where(eq(inviteSchema.id, 'inv-1'));

    expect(row?.acceptedAt).toBeNull();
  });

  it('passes a refusal through with its status', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-sam' } } as never);

    const res = await POST(post({ inviteToken: 'tok-unknown' }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid invite token.' });
  });

  it('refuses a body that is not JSON, so a cross-site form cannot post it', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-sam' } } as never);

    const res = await POST(new Request('http://localhost/api/invites/accept', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ inviteToken: 'tok-1' }) }));

    expect(res.status).toBe(415);
    expect(await db.select().from(accountMembershipSchema).where(eq(accountMembershipSchema.userId, 'user-sam'))).toHaveLength(0);
  });

  it('400s a body without a token', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-sam' } } as never);

    expect((await POST(post({}))).status).toBe(400);
  });
});
