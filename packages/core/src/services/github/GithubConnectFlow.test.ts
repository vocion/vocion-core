/**
 * Connecting GitHub from Connections, both round trips, against an in-memory
 * database and a stubbed github.com: the manifest carries this deployment's
 * URLs and the widest tier; GitHub's code becomes a sealed app; an install
 * callback binds nothing until a GitHub sign-in proves the person can reach
 * the installation; a state from someone else or an expired one does
 * nothing. Fictional accounts and keys throughout.
 */
import type { ApiCaller } from '@/services/writeApi';
import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.stubEnv('VOCION_CREDENTIAL_VAULT_KEY', Buffer.from('k'.repeat(32)).toString('base64'));
vi.stubEnv('AUTH_SECRET', 'test-auth-secret-for-github-app-state');

const { db } = await import('@/libs/DB');
const { githubAppSchema, githubInstallationSchema, eventLogSchema } = await import('@/models/Schema');
const { buildAppManifest } = await import('@/libs/github/appManifest');
const { signGithubAppState, verifyGithubAppState } = await import('@/libs/github/appState');
const flow = await import('./GithubConnectFlow');
const svc = await import('./GithubAppService');

const ORIGIN = 'https://vocion.northwind.example';
const ORG = 'org_northwind_factory';
const caller = (actorId = 'usr-owner', orgId = ORG): ApiCaller => ({ orgId, actorId, principal: { kind: 'user', id: actorId, role: 'admin' as const, scope: { orgId } }, source: 'session' as const });
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

async function seedApp() {
  return svc.saveApp({ appId: 1001, slug: 'vocion-northwind', name: 'Vocion Northwind', clientId: 'Iv1.fixture', ownerLogin: 'northwind', htmlUrl: null, permissions: {}, events: [], secrets: { privateKey, webhookSecret: 'whsec', clientSecret: 'cs' } }, 'usr-owner');
}

/**
 * github.com for one install: the sign-in, the person's installations, the installation, a token, its repos.
 * @param reachable
 */
function githubFor(reachable: number[]) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/login/oauth/access_token')) {
      return json({ access_token: 'ghu_fixture' });
    }
    if (url.includes('/user/installations')) {
      return json({ installations: reachable.map(id => ({ id, account: { login: 'Northwind' } })) });
    }
    if (url.endsWith('/access_tokens')) {
      return json({ token: 'ghs_fixture', expires_at: '2099-01-01T00:00:00Z' }, 201);
    }
    if (url.includes('/installation/repositories')) {
      return json({ total_count: 1, repositories: [{ full_name: 'northwind/orders-api' }] });
    }
    if (url.includes('/app/installations/')) {
      return json({ account: { login: 'Northwind', type: 'Organization' }, repository_selection: 'selected', permissions: { contents: 'write' } });
    }
    return json({ message: 'not stubbed' }, 404);
  });
}

beforeEach(async () => {
  await db.delete(githubInstallationSchema);
  await db.delete(githubAppSchema);
  svc.resetGithubAppCaches();
});

describe('the manifest', () => {
  it('points GitHub at this deployment and asks for the widest tier, public so any org owner can install it', () => {
    const m = buildAppManifest({ origin: ORIGIN });

    expect(m.name).toBe('Vocion vocion.northwind.example');
    expect(m.hook_attributes.url).toBe(`${ORIGIN}/api/webhooks/github-app`);
    expect(m.redirect_url).toBe(`${ORIGIN}/api/v1/connections/github/manifest/callback`);
    expect(m.setup_url).toBe(`${ORIGIN}/api/v1/connections/github/install/callback`);
    expect(m.callback_urls).toEqual([`${ORIGIN}/api/v1/connections/github/install/callback`]);
    expect(m.default_permissions).toMatchObject({ contents: 'write', pull_requests: 'write', actions: 'write', checks: 'read', workflows: 'write' });
    expect(m.default_events).toEqual(expect.arrayContaining(['pull_request', 'check_suite', 'workflow_run']));
    expect(m.public).toBe(true);
  });

  it('is handed to GitHub as a self-submitting form for the named organization', () => {
    const { html } = flow.startManifest({ caller: caller(), origin: ORIGIN, org: 'Northwind' });

    expect(html).toContain('action="https://github.com/organizations/Northwind/settings/apps/new?state=');
    expect(html).toContain('name="manifest"');
    expect(html).toContain('&quot;redirect_url&quot;');
  });
});

describe('finishManifest', () => {
  it('trades GitHub\'s code for the app and seals its key, then lands on Connections', async () => {
    const state = signGithubAppState({ purpose: 'manifest', orgId: ORG, userId: 'usr-owner' });
    const fetchImpl = vi.fn(async (_url: string) => json({ id: 1001, slug: 'vocion-northwind', name: 'Vocion Northwind', client_id: 'Iv1.fixture', client_secret: 'cs', webhook_secret: 'whsec', pem: privateKey, owner: { login: 'Northwind' }, html_url: 'https://github.com/apps/vocion-northwind' }, 201));

    const out = await flow.finishManifest({ caller: caller(), origin: ORIGIN, code: 'code-1', state }, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(out.redirect).toBe(`${ORIGIN}/dashboard/connectors?github=created`);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.github.com/app-manifests/code-1/conversions');

    const app = await svc.activeApp();

    expect(app).toMatchObject({ appId: 1001, slug: 'vocion-northwind', ownerLogin: 'Northwind' });
    expect((await svc.appSecrets(app!)).webhookSecret).toBe('whsec');
  });

  it('does nothing for a state someone else started, and says so', async () => {
    const state = signGithubAppState({ purpose: 'manifest', orgId: ORG, userId: 'usr-someone-else' });
    const fetchImpl = vi.fn();
    const out = await flow.finishManifest({ caller: caller(), origin: ORIGIN, code: 'code-1', state }, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(new URL(out.redirect).searchParams.get('github')).toBe('error');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await svc.activeApp()).toBeNull();
  });
});

describe('the install round trip', () => {
  it('sends the person to the app\'s install screen with a signed state', async () => {
    await seedApp();
    const out = await flow.startInstall({ caller: caller(), origin: ORIGIN, returnTo: '/dashboard/chat?c=12' });
    const u = new URL(out.redirect);

    expect(u.origin + u.pathname).toBe('https://github.com/apps/vocion-northwind/installations/new');
    expect(verifyGithubAppState(u.searchParams.get('state'), 'install')).toMatchObject({ orgId: ORG, userId: 'usr-owner', returnTo: '/dashboard/chat?c=12' });
  });

  it('binds nothing on GitHub\'s installation id alone: it asks GitHub who the person is first', async () => {
    await seedApp();
    const state = signGithubAppState({ purpose: 'install', orgId: ORG, userId: 'usr-owner' });
    const out = await flow.finishInstall({ caller: caller(), origin: ORIGIN, query: { installationId: '555', setupAction: 'install', state, code: null } });
    const u = new URL(out.redirect);

    expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('Iv1.fixture');
    expect(verifyGithubAppState(u.searchParams.get('state'), 'install')?.installationId).toBe(555);
    expect(await db.select().from(githubInstallationSchema)).toHaveLength(0);
  });

  it('binds the installation when GitHub says the person can reach it, and raises github.connected', async () => {
    await seedApp();
    const state = signGithubAppState({ purpose: 'install', orgId: ORG, userId: 'usr-owner', installationId: 555, returnTo: '/dashboard/chat?c=12' });
    const out = await flow.finishInstall({ caller: caller(), origin: ORIGIN, query: { installationId: null, setupAction: null, state, code: 'oauth-code' } }, { fetchImpl: githubFor([555]) as unknown as typeof fetch });

    expect(out.redirect).toBe(`${ORIGIN}/dashboard/chat?c=12&github=connected&account=Northwind`);

    const [row] = await db.select().from(githubInstallationSchema);

    expect(row).toMatchObject({ orgId: ORG, installationId: 555, accountLogin: 'Northwind', repos: ['northwind/orders-api'], status: 'active', connectedBy: 'usr-owner' });

    const events = await db.select({ type: eventLogSchema.type }).from(eventLogSchema);

    expect(events.map(e => e.type)).toContain('github.connected');
  });

  it('refuses an installation the person\'s GitHub account cannot reach', async () => {
    await seedApp();
    const state = signGithubAppState({ purpose: 'install', orgId: ORG, userId: 'usr-owner', installationId: 555 });
    const out = await flow.finishInstall({ caller: caller(), origin: ORIGIN, query: { installationId: null, setupAction: null, state, code: 'oauth-code' } }, { fetchImpl: githubFor([777]) as unknown as typeof fetch });

    expect(new URL(out.redirect).searchParams.get('github')).toBe('error');
    expect(await db.select().from(githubInstallationSchema)).toHaveLength(0);
  });

  it('says an install request went to an organization owner', async () => {
    await seedApp();
    const out = await flow.finishInstall({ caller: caller(), origin: ORIGIN, query: { installationId: null, setupAction: 'request', state: null, code: null } });

    expect(new URL(out.redirect).searchParams.get('github')).toBe('requested');
  });
});
