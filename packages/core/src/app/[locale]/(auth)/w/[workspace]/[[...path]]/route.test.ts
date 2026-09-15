/**
 * `/w/[workspace]/[[...path]]` — the redirect semantics a mailed link relies on.
 * Slug resolution itself is covered in `services/ProjectService.test.ts`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/Auth', () => ({ auth: vi.fn() }));
vi.mock('@/services/ProjectService', () => ({ resolveProjectForUser: vi.fn() }));

const { auth } = await import('@/libs/Auth');
const { resolveProjectForUser } = await import('@/services/ProjectService');
const { GET } = await import('./route');

const mockAuth = vi.mocked(auth);
const mockResolve = vi.mocked(resolveProjectForUser);

function get(path: string, params: { locale?: string; workspace: string; path?: string[] }) {
  const request = new NextRequest(`http://0.0.0.0:3000${path}`, { headers: { 'x-forwarded-host': 'agents.example.com', 'x-forwarded-proto': 'https' } });
  return GET(request, { params: Promise.resolve({ locale: params.locale ?? 'en', workspace: params.workspace, path: params.path }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.AUTH_URL;
  mockAuth.mockResolvedValue({ user: { id: 'user-chris' } } as never);
  mockResolve.mockImplementation(async (_userId, selector) =>
    'slug' in selector && selector.slug.toLowerCase() === 'vocion-workforce'
      ? { id: 'proj-workforce', slug: 'vocion-workforce', name: 'Vocion Workforce', description: null, agentCount: 3 }
      : null,
  );
});

describe('GET /w/[workspace]/[[...path]]', () => {
  it('activates the workspace and 302s to the page, preserving path and query, on the public origin', async () => {
    const res = await get('/w/vocion-workforce/dashboard/inbox?status=open&x=1', { workspace: 'vocion-workforce', path: ['dashboard', 'inbox'] });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://agents.example.com/dashboard/inbox?status=open&x=1');
    expect(res.cookies.get('vocion_active_project')).toMatchObject({ value: 'proj-workforce', path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
    expect(mockResolve).toHaveBeenCalledWith('user-chris', { slug: 'vocion-workforce' });
  });

  it('lands on the dashboard home with no path, and accepts a bare page name', async () => {
    expect((await get('/w/vocion-workforce', { workspace: 'vocion-workforce' })).headers.get('location')).toBe('https://agents.example.com/dashboard');
    expect((await get('/w/vocion-workforce/team-report', { workspace: 'vocion-workforce', path: ['team-report'] })).headers.get('location')).toBe('https://agents.example.com/dashboard/team-report');
  });

  it('resolves the slug case-insensitively and keeps a non-default locale', async () => {
    const res = await get('/fr/w/Vocion-Workforce/dashboard/briefings', { locale: 'fr', workspace: 'Vocion-Workforce', path: ['dashboard', 'briefings'] });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://agents.example.com/fr/dashboard/briefings');
  });

  it('prefers NEXT_PUBLIC_APP_URL over forwarded headers for the redirect origin', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://agents.metacto.com/';
    const res = await get('/w/vocion-workforce/dashboard/inbox', { workspace: 'vocion-workforce', path: ['dashboard', 'inbox'] });

    expect(res.headers.get('location')).toBe('https://agents.metacto.com/dashboard/inbox');
  });

  it('404s an unknown slug and a project the user is not a member of, without touching the cookie', async () => {
    const res = await get('/w/revenue-team/dashboard/inbox', { workspace: 'revenue-team', path: ['dashboard', 'inbox'] });

    expect(res.status).toBe(404);
    expect(res.cookies.get('vocion_active_project')).toBeUndefined();
  });

  it('sends an unsigned reader to sign-in with a callbackUrl that round-trips the /w/ URL', async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await get('/w/vocion-workforce/dashboard/inbox?status=open', { workspace: 'vocion-workforce', path: ['dashboard', 'inbox'] });

    expect(res.status).toBe(302);

    const location = new URL(res.headers.get('location')!);

    expect(`${location.origin}${location.pathname}`).toBe('https://agents.example.com/sign-in');
    expect(location.searchParams.get('callbackUrl')).toBe('https://agents.example.com/w/vocion-workforce/dashboard/inbox?status=open');
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
