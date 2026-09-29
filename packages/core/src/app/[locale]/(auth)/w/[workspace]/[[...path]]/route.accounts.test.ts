/**
 * `/w/<slug>` for a person in two accounts that both own the slug
 * (vocion-core#128), on real rows in PGlite. In the demo sandbox the proxy
 * does not resolve workspaces, so this route is what a cross-account switch
 * (`?account=`) lands on there. Redirect mechanics are in `route.test.ts`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { auth } = await import('@/libs/Auth');
const { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { GET } = await import('./route');

const mockAuth = vi.mocked(auth);

/**
 * Open `/w/sales/dashboard`, with any query and cookie.
 * @param search - The query, e.g. `?account=contoso`.
 * @param cookie - The last-active workspace, if any.
 */
function openSales(search = '', cookie?: string) {
  const request = new NextRequest(`http://0.0.0.0:3000/w/sales/dashboard${search}`, {
    headers: {
      'x-forwarded-host': 'agents.example.com',
      'x-forwarded-proto': 'https',
      ...(cookie ? { cookie: `vocion_active_project=${cookie}` } : {}),
    },
  });
  return GET(request, { params: Promise.resolve({ locale: 'en', workspace: 'sales', path: ['dashboard'] }) });
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
    { id: 'acct-fabrikam', name: 'Fabrikam', slug: 'fabrikam' },
  ]);
  // Metacto joined first, so it wins a tie with nothing else to go on.
  await db.insert(accountMembershipSchema).values([
    { accountId: 'acct-metacto', userId: 'user-sam', role: 'admin', createdAt: new Date('2025-01-01T00:00:00Z') },
    { accountId: 'acct-contoso', userId: 'user-sam', role: 'member', createdAt: new Date('2026-01-01T00:00:00Z') },
  ]);
  await db.insert(projectSchema).values([
    { id: 'proj-metacto-sales', accountId: 'acct-metacto', slug: 'sales', name: 'Metacto Sales' },
    { id: 'proj-contoso-sales', accountId: 'acct-contoso', slug: 'sales', name: 'Contoso Sales' },
    { id: 'proj-fabrikam-sales', accountId: 'acct-fabrikam', slug: 'sales', name: 'Fabrikam Sales' },
  ]);
  mockAuth.mockResolvedValue({ user: { id: 'user-sam' } } as never);
});

describe('GET /w/<slug> with the slug on two of the person\'s accounts', () => {
  it('opens the named account\'s workspace, even when "last active" is on the other', async () => {
    const res = await openSales('?account=contoso', 'proj-metacto-sales');

    expect(res.status).toBe(302);
    expect(res.cookies.get('vocion_active_project')?.value).toBe('proj-contoso-sales');
  });

  it('with no account named, stays on the account of the last-active workspace', async () => {
    const res = await openSales('', 'proj-contoso-sales');

    expect(res.cookies.get('vocion_active_project')?.value).toBe('proj-contoso-sales');
  });

  it('with nothing to go on, opens the one on the account joined first', async () => {
    const res = await openSales();

    expect(res.cookies.get('vocion_active_project')?.value).toBe('proj-metacto-sales');
  });

  it('404s an account they are not in rather than opening theirs', async () => {
    const res = await openSales('?account=fabrikam');

    expect(res.status).toBe(404);
    expect(res.cookies.get('vocion_active_project')).toBeUndefined();
  });
});
