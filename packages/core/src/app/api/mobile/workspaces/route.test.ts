/**
 * `GET /api/mobile/workspaces` for a person in two accounts (vocion-core#128).
 *
 * The web switcher lists every account; the phone lists only the account the
 * session is in, because the share route names a workspace by slug alone and
 * both accounts here own a `sales`. Real rows in PGlite; only the session is
 * stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { auth } = await import('@/libs/Auth');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { GET } = await import('./route');

const mockAuth = vi.mocked(auth);

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
    { accountId: 'acct-metacto', userId: 'user-sam', role: 'admin', createdAt: new Date('2025-01-01T00:00:00Z') },
    { accountId: 'acct-contoso', userId: 'user-sam', role: 'member', createdAt: new Date('2026-01-01T00:00:00Z') },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-metacto-sales', accountId: 'acct-metacto', slug: 'sales', name: 'Metacto Sales' },
    { id: 'proj-contoso-sales', accountId: 'acct-contoso', slug: 'sales', name: 'Contoso Sales' },
    { id: 'proj-contoso-ops', accountId: 'acct-contoso', slug: 'ops', name: 'Contoso Ops' },
  ]);
});

describe('GET /api/mobile/workspaces', () => {
  it('lists only the account the session is in, named, with its active workspace', async () => {
    // The person switched to Contoso on the web; the session follows.
    mockAuth.mockResolvedValue({ user: { id: 'user-sam', accountId: 'acct-contoso', projectId: 'proj-contoso-sales' } } as never);

    const body = await (await GET()).json();

    expect(body.account).toEqual({ name: 'Contoso', slug: 'contoso' });
    expect(body.workspaces.map((w: { id: string }) => w.id)).toEqual(['proj-contoso-ops', 'proj-contoso-sales']);
    expect(body.active).toBe('sales');
  });

  it('401s without a session', async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await GET()).status).toBe(401);
  });
});
