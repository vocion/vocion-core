/**
 * `PUT /api/v1/squarespace/session`: what the operator's CLI sends after a
 * person signs in on their own machine. Admin only, Squarespace connectors
 * only, cookies for squarespace.com only, sealed. Against PGlite, with only
 * the bearer check and the session stubbed. Every site and value is fictional.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));
vi.mock('@/services/ApiTokenService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/ApiTokenService')>();
  return { ...actual, authenticateBearer: vi.fn() };
});

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { clerkAuth } = await import('@/libs/Auth');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { openKeptSignIn } = await import('@/services/browser/keptSignIn');
const { PUT } = await import('./route');

const ORG = 'org_squarespace_session';
const SITE = 'https://example-site.squarespace.com';
const VALUE = 'fixture-session-value-7';

function tokenCaller(role: 'admin' | 'member') {
  return { orgId: ORG, tokenId: 't1', principal: { kind: 'user' as const, id: 'token:t1', role, scope: { orgId: ORG }, grants: [] } };
}

function cookie(domain: string, name: string) {
  return { name, value: VALUE, domain, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const };
}

const STATE = { cookies: [cookie('login.squarespace.com', 'crumb'), cookie('.squarespace.com', 'member'), cookie('example-site.squarespace.com', 'site')], origins: [] };

function put(body: unknown, auth = true): Request {
  return new Request('https://vocion.test/api/v1/squarespace/session', {
    method: 'PUT',
    headers: { ...(auth ? { authorization: 'Bearer vcn_live_fake_token' } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let sourceId = 0;

beforeEach(async () => {
  vi.mocked(clerkAuth).mockResolvedValue({ userId: null, orgId: null, role: null, has: () => false } as never);
  vi.mocked(authenticateBearer).mockResolvedValue(tokenCaller('admin') as never);
  await db.delete(knowledgeSourceSchema);
  const [row] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'squarespace', configJson: { _connector: 'squarespace', siteUrl: `${SITE}/` } }).returning();
  sourceId = row!.id;
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'web', kind: 'web', configJson: { siteUrl: 'https://northwind-home.example' } });
});

describe('PUT /api/v1/squarespace/session', () => {
  it('keeps a sign-in for the site\'s connector, sealed, and never answers with it', async () => {
    const res = await PUT(put({ site: SITE, state: STATE, savedFrom: 'the operator CLI on a laptop' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session).toMatchObject({ connector: 'squarespace', cookies: 3, savedFrom: 'the operator CLI on a laptop', resumed: [] });
    expect(JSON.stringify(body)).not.toContain(VALUE);

    const [row] = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, sourceId));

    expect(JSON.stringify(row!.keptSignIn)).not.toContain(VALUE);
    expect((await openKeptSignIn(ORG, sourceId))?.state.cookies).toHaveLength(3);
  });

  it('refuses a caller with no token, and a member', async () => {
    expect((await PUT(put({ site: SITE, state: STATE }, false))).status).toBe(401);

    vi.mocked(authenticateBearer).mockResolvedValue(tokenCaller('member') as never);
    const res = await PUT(put({ site: SITE, state: STATE }));

    expect(res.status).toBe(403);
    expect(await openKeptSignIn(ORG, sourceId)).toBeNull();
  });

  it('refuses a cookie for any domain but squarespace.com, keeping nothing', async () => {
    const res = await PUT(put({ site: SITE, state: { cookies: [...STATE.cookies, cookie('.northwind-home.example', 'tracker')] } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.details.field).toBe('state.cookies[3].domain');
    expect(await openKeptSignIn(ORG, sourceId)).toBeNull();
  });

  it('answers 404 for a site no Squarespace connector reads, and 400 for no site', async () => {
    expect((await PUT(put({ site: 'https://northwind-home.example', state: STATE }))).status).toBe(404);
    expect((await PUT(put({ state: STATE }))).status).toBe(400);
  });

  it('refuses a token from another workspace than the one named', async () => {
    const res = await PUT(put({ site: SITE, workspace: 'kestrel-capital', state: STATE }));

    expect(res.status).toBe(400);
    expect((await res.json()).error.details.field).toBe('workspace');
  });

  it('takes the workspace by its slug', async () => {
    await db.delete(projectSchema).where(eq(projectSchema.id, ORG));
    await db.insert(tenantAccountSchema).values({ id: 'acct_northwind', name: 'Northwind Home Services', slug: 'northwind-home-services' } as never).onConflictDoNothing();
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_northwind', slug: 'northwind-seo', name: 'Northwind SEO' } as never);

    expect((await PUT(put({ site: SITE, workspace: 'northwind-seo', state: STATE }))).status).toBe(200);
  });
});
