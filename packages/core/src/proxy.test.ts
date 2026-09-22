/**
 * The proxy's routing contract: who is let in, and which workspace a URL means.
 *
 * The workspace half is the point — a canonical `/w/<slug>/…` is rewritten
 * (the address bar keeps it) with the resolved project on a request header,
 * and a bare `/dashboard/…` is sent to its canonical spelling. Slug
 * resolution itself lives in `services/ProjectService.test.ts`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next({ headers: { 'x-i18n': 'handled' } }) }));
vi.mock('./libs/Auth', () => ({ auth: vi.fn() }));
vi.mock('./services/ProjectService', () => ({ resolveProjectForUser: vi.fn(), activeWorkspaceForUser: vi.fn() }));

const { auth } = await import('./libs/Auth');
const { activeWorkspaceForUser, resolveProjectForUser } = await import('./services/ProjectService');
const proxy = (await import('./proxy')).default;

const mockAuth = vi.mocked(auth);
const mockResolve = vi.mocked(resolveProjectForUser);
const mockActive = vi.mocked(activeWorkspaceForUser);

const WORKFORCE = { id: 'proj-workforce', slug: 'vocion-workforce', name: 'Vocion Workforce', description: null, agentCount: 3 };

/** The origin the Next server itself answers on, behind the public one. */
const SERVER_ORIGIN = 'http://0.0.0.0:3000';

function request(path: string, init?: { method?: string; cookie?: string }) {
  return new NextRequest(`${SERVER_ORIGIN}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'x-forwarded-host': 'agents.example.com',
      'x-forwarded-proto': 'https',
      ...(init?.cookie ? { cookie: `vocion_active_project=${init.cookie}` } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VOCION_DEMO_SEED_DIR;
  // Every URL the proxy builds is on the PUBLIC origin (libs/http/publicOrigin).
  process.env.NEXT_PUBLIC_APP_URL = 'https://agents.example.com';
  mockAuth.mockResolvedValue({ user: { id: 'user-chris' } } as never);
  mockResolve.mockImplementation(async (_userId, selector) =>
    'slug' in selector && selector.slug === 'vocion-workforce' ? WORKFORCE : null,
  );
  mockActive.mockResolvedValue({ id: WORKFORCE.id, accountId: 'acct-metacto', slug: WORKFORCE.slug });
});

describe('a canonical /w/<slug>/… URL', () => {
  it('is rewritten, not redirected — so the address bar keeps the workspace across a refresh', async () => {
    const res = await proxy(request('/w/vocion-workforce/dashboard/inbox?status=open'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-rewrite')).toBe(`${SERVER_ORIGIN}/en/dashboard/inbox?status=open`);
  });

  it('carries the resolved project to the page, which is what makes the URL beat the cookie', async () => {
    const res = await proxy(request('/w/vocion-workforce/dashboard/inbox', { cookie: 'proj-revenue' }));

    expect(res.headers.get('x-middleware-request-x-vocion-project-id')).toBe('proj-workforce');
    expect(res.headers.get('x-middleware-request-x-vocion-workspace-slug')).toBe('vocion-workforce');
  });

  it('brings "last active" along, so a later bare link opens the same workspace', async () => {
    const res = await proxy(request('/w/vocion-workforce/dashboard', { cookie: 'proj-revenue' }));

    expect(res.cookies.get('vocion_active_project')).toMatchObject({ value: 'proj-workforce', path: '/', maxAge: 60 * 60 * 24 * 365 });
  });

  it('leaves the cookie alone when it already agrees', async () => {
    const res = await proxy(request('/w/vocion-workforce/dashboard', { cookie: 'proj-workforce' }));

    expect(res.cookies.get('vocion_active_project')).toBeUndefined();
  });

  it('accepts a bare page name and a registered surface, and keeps a non-default locale', async () => {
    await expect(proxy(request('/w/vocion-workforce/inbox')).then(r => r.headers.get('x-middleware-rewrite')))
      .resolves
      .toBe(`${SERVER_ORIGIN}/en/dashboard/inbox`);
    await expect(proxy(request('/w/vocion-workforce/gtm/discovery')).then(r => r.headers.get('x-middleware-rewrite')))
      .resolves
      .toBe(`${SERVER_ORIGIN}/en/gtm/discovery`);
    await expect(proxy(request('/fr/w/vocion-workforce/inbox')).then(r => r.headers.get('x-middleware-rewrite')))
      .resolves
      .toBe(`${SERVER_ORIGIN}/fr/dashboard/inbox`);
  });

  it('404s an unknown slug and one on another account alike — the reader learns nothing either way', async () => {
    const res = await proxy(request('/w/someone-elses/dashboard'));

    expect(res.status).toBe(404);
    await expect(res.text()).resolves.toBe('No such workspace');
  });

  it('sends an unsigned reader to sign-in with the canonical URL to come back to', async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await proxy(request('/w/vocion-workforce/dashboard/inbox'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://agents.example.com/sign-in?callbackUrl=https%3A%2F%2Fagents.example.com%2Fw%2Fvocion-workforce%2Fdashboard%2Finbox');
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe('a bare /dashboard/… URL', () => {
  it('is sent to its canonical spelling, so there is one URL per page per workspace', async () => {
    const res = await proxy(request('/dashboard/inbox?status=open', { cookie: 'proj-workforce' }));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://agents.example.com/w/vocion-workforce/dashboard/inbox?status=open');
    expect(mockActive).toHaveBeenCalledWith('user-chris', 'proj-workforce');
  });

  it('keeps a non-default locale in front of the workspace', async () => {
    const res = await proxy(request('/fr/dashboard/inbox'));

    expect(res.headers.get('location')).toBe('https://agents.example.com/fr/w/vocion-workforce/dashboard/inbox');
  });

  it('is left alone when the user has no workspace yet — onboarding has nothing to canonicalise', async () => {
    mockActive.mockResolvedValue(null);

    const res = await proxy(request('/dashboard'));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-i18n')).toBe('handled');
  });

  it('never redirects the transport, the account-wide pages or a non-GET', async () => {
    for (const path of ['/rpc/records', '/api-docs', '/onboarding']) {
      const res = await proxy(request(path));

      expect(res.headers.get('location'), path).toBeNull();
    }
    const posted = await proxy(request('/dashboard/inbox', { method: 'POST' }));

    expect(posted.headers.get('location')).toBeNull();
  });

  it('never redirects /api — those routes own their own routing', async () => {
    const res = await proxy(request('/api/v1/records'));

    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-i18n')).toBeNull();
    expect(mockAuth).not.toHaveBeenCalled();
  });
});

describe('the chain a signed-in reader actually walks', () => {
  /**
   * Follow a URL the way a browser and the server really do, so a cycle shows
   * up as a cycle instead of hiding behind a passing one-hop assertion.
   *
   * A 3xx is followed the way a browser follows it. A rewrite is followed only
   * when its target is NOT on the server's own origin, because a cross-origin
   * `NextResponse.rewrite` is not an internal rewrite: Next turns it into an
   * outbound HTTP request, that request arrives back at this same proxy, and
   * whatever it answers with is what the browser is handed.
   * @param start - The pathname the reader asked for.
   * @param limit - How many hops before we call it a loop.
   */
  async function walk(start: string, limit = 8): Promise<{ visited: string[]; ended: 'rendered' | 'rewritten' | 'looping' }> {
    const visited: string[] = [];
    let path = start;
    for (let hop = 0; hop < limit; hop++) {
      if (visited.includes(path)) {
        return { visited: [...visited, path], ended: 'looping' };
      }
      visited.push(path);
      const res = await proxy(request(path));
      const rewrite = res.headers.get('x-middleware-rewrite');
      if (rewrite) {
        const url = new URL(rewrite);
        if (url.origin === SERVER_ORIGIN) {
          return { visited, ended: 'rewritten' };
        }
        path = `${url.pathname}${url.search}`;
        continue;
      }
      const location = res.headers.get('location');
      if (location) {
        const url = new URL(location);
        path = `${url.pathname}${url.search}`;
        continue;
      }
      return { visited, ended: 'rendered' };
    }
    return { visited, ended: 'looping' };
  }

  it('rewrites on the server\'s own origin, because a cross-origin rewrite is an outbound request and not a rewrite', async () => {
    const res = await proxy(request('/en/w/vocion-workforce/dashboard/p/factory'));

    expect(new URL(res.headers.get('x-middleware-rewrite') ?? '').origin).toBe(SERVER_ORIGIN);
  });

  it('serves the locale-prefixed canonical URL in one hop, the URL that looped in production', async () => {
    await expect(walk('/en/w/vocion-workforce/dashboard/p/factory')).resolves.toEqual({
      visited: ['/en/w/vocion-workforce/dashboard/p/factory'],
      ended: 'rewritten',
    });
  });

  it('settles every other shape a reader can arrive by, and settles it quickly', async () => {
    for (const start of [
      '/w/vocion-workforce/dashboard/inbox',
      '/dashboard/p/factory?tab=runs',
      '/en/dashboard/p/factory',
      '/fr/w/vocion-workforce/inbox',
      '/fr/dashboard/inbox',
      '/w/vocion-workforce/gtm/discovery',
    ]) {
      const { visited, ended } = await walk(start);

      expect(ended, start).toBe('rewritten');
      expect(visited.length, start).toBeLessThanOrEqual(2);
    }
  });

  it('stops on a workspace the reader may not have, rather than bouncing them', async () => {
    for (const start of ['/w/someone-elses/dashboard', '/en/w/no-such-workspace/dashboard/inbox']) {
      const res = await proxy(request(start));

      expect(res.status, start).toBe(404);
    }
  });

  it('sends a signed-out reader to sign-in and stops there', async () => {
    mockAuth.mockResolvedValue(null as never);

    const { visited, ended } = await walk('/en/w/vocion-workforce/dashboard/p/factory');

    expect(ended).toBe('rendered');
    expect(visited).toEqual([
      '/en/w/vocion-workforce/dashboard/p/factory',
      '/en/sign-in?callbackUrl=https%3A%2F%2Fagents.example.com%2Fen%2Fw%2Fvocion-workforce%2Fdashboard%2Fp%2Ffactory',
    ]);
  });
});

describe('the demo sandbox', () => {
  it('gates on the session cookie and resolves no workspace — PGlite cannot run in this bundle', async () => {
    process.env.VOCION_DEMO_SEED_DIR = '/tmp/seed';

    const res = await proxy(request('/w/vocion-workforce/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/sign-in');
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
