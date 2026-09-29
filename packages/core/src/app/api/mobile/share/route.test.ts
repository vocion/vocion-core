/**
 * `POST /api/mobile/share` for a person in two accounts (vocion-core#128).
 *
 * The phone's workspace list (`/api/mobile/workspaces`) offers only the
 * account the session is in, so a share may only land there too: a slug that
 * exists only on the person's other account is not one the phone showed.
 * Real rows in PGlite; only the session is stubbed. No file is sent, so a
 * request that gets past the workspace check stops at "nothing to share".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { auth } = await import('@/libs/Auth');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { POST } = await import('./route');

const mockAuth = vi.mocked(auth);

/**
 * A share naming a workspace and carrying no file.
 * @param workspace - The slug to share to.
 */
function share(workspace: string) {
  const form = new FormData();
  form.set('workspace', workspace);
  return new Request('http://localhost/api/mobile/share', { method: 'POST', body: form });
}

beforeEach(async () => {
  await db.delete(accountMembershipSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.delete(userSchema);

  await db.insert(userSchema).values({ id: 'user-sam', email: 'sam@example.com', name: 'Sam' });
  await db.insert(tenantAccountSchema).values([
    { id: 'acct-metacto', name: 'Metacto', slug: 'metacto' },
    { id: 'acct-contoso', name: 'Contoso', slug: 'contoso' },
  ]);
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-metacto', userId: 'user-sam', role: 'admin' },
    { accountId: 'acct-contoso', userId: 'user-sam', role: 'member' },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-metacto-sales', accountId: 'acct-metacto', slug: 'sales', name: 'Metacto Sales' },
    { id: 'proj-contoso-ops', accountId: 'acct-contoso', slug: 'ops', name: 'Contoso Ops' },
  ]);
  // In Metacto, which is all the phone lists.
  mockAuth.mockResolvedValue({ user: { id: 'user-sam', accountId: 'acct-metacto', projectId: 'proj-metacto-sales' } } as never);
});

describe('POST /api/mobile/share', () => {
  it('404s a workspace that exists only on their other account', async () => {
    expect((await POST(share('ops'))).status).toBe(404);
  });

  it('accepts a workspace on the session\'s account', async () => {
    const res = await POST(share('sales'));

    // Past the workspace check; stopped only because no file was sent.
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { message: expect.stringContaining('Nothing to share') } });
  });
});
