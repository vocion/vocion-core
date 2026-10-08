/**
 * Every prebuilt connector's live reads spend the credential of the workspace
 * that asked, and only that one: two orgs read in sequence through the same
 * family provider, and each outbound call carries its own org's key to its
 * own org's account. Nothing is cached between them (CLAUDE.md, "Never cache
 * a client keyed on anything less than the exact key in use").
 *
 * Sources and credentials are mocked per org; the vendors are recorded
 * answers. Northwind and Kestrel Capital are the two fixture workspaces.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Env', () => ({ Env: {} }));

type Org = 'org_northwind' | 'org_kestrel';
const KEY: Record<Org, string> = { org_northwind: 'nw', org_kestrel: 'kc' };

function src(id: number, kind: string, config: Record<string, unknown>): FamilySource {
  return { id, slug: kind, kind, config, apiTokenId: null };
}

function sourcesFor(org: Org): Record<string, FamilySource[]> {
  const k = KEY[org];
  return {
    support: [src(1, 'zendesk', {}), src(2, 'intercom', { region: 'us' }), src(3, 'freshdesk', {})],
    tracker: [src(4, 'linear', { projectKeys: ['ENG'] })],
    repo: [src(5, 'gitlab', { baseUrl: `https://gitlab.${k}.example`, repos: ['acme/api'] })],
    incident: [src(6, 'pagerduty', { region: 'us' })],
    docs: [src(7, 'confluence', { baseUrl: `https://${k}.atlassian.example`, spaceKeys: ['ENG'] })],
    files: [src(8, 'dropbox', { path: '' }), src(9, 'box', { folderId: '0' })],
  };
}

function credentialsFor(org: Org, connector: string): Record<string, unknown> | undefined {
  const k = KEY[org];
  const table: Record<string, Record<string, unknown>> = {
    zendesk: { subdomain: k, email: `ops@${k}.example`, apiToken: `zd-${k}` },
    intercom: { token: `ic-${k}` },
    freshdesk: { domain: k, apiKey: `fd-${k}` },
    linear: { token: `lin_api_${k}` },
    gitlab: { token: `glpat-${k}` },
    pagerduty: { token: `pd-${k}` },
    confluence: { email: `ops@${k}.example`, apiToken: `cf-${k}` },
    dropbox: { token: `dbx-${k}` },
    box: { clientId: `box-client-${k}`, clientSecret: 's', developerToken: `boxdev-${k}` },
  };
  return table[connector];
}

vi.mock('@/libs/connectors/families', async importActual => ({
  ...(await importActual<typeof import('@/libs/connectors/families')>()),
  familySourcesForOrg: vi.fn(async (orgId: Org, family: string) => sourcesFor(orgId)[family] ?? []),
}));
vi.mock('@/services/SourceCredentialService', () => ({
  ConnectorCredentialError: class ConnectorCredentialError extends Error {},
  getCredentialsForConnector: vi.fn(async (input: { orgId: Org; connectorSlug: string }) => credentialsFor(input.orgId, input.connectorSlug)),
}));
vi.mock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: vi.fn(async () => null) }));

const calls: Array<{ url: string; auth: string }> = [];

function answer(url: string, body: string): unknown {
  if (url.includes('api.linear.app')) {
    return body.includes('urlKey') ? { data: { viewer: { organization: { urlKey: 'acme' } } } } : { data: { issues: { nodes: [] } } };
  }
  if (url.includes('/conversations/')) {
    return { id: '1', state: 'open' };
  }
  if (url.endsWith('/me')) {
    return { id: '9', app: { id_code: 'app1' } };
  }
  if (url.includes('freshdesk') && url.includes('/tickets?')) {
    return [];
  }
  if (url.includes('/repository/files/')) {
    return 'readme text';
  }
  return { results: [], incidents: [], matches: [], entries: [] };
}

function stubVendors() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: headers.authorization ?? '' });
    const body = answer(url, typeof init.body === 'string' ? init.body : '');
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  calls.length = 0;
});

type Case = { name: string; read: (org: Org) => Promise<unknown>; host: (org: Org) => string; auth: (org: Org) => string };

const cases: Case[] = [
  {
    name: 'zendesk',
    read: async org => (await (await import('@/services/support/provider')).supportProviderFor(org, { sourceSlug: 'zendesk' })).searchTickets('', { limit: 5 }),
    host: org => `https://${KEY[org]}.zendesk.com/`,
    auth: org => `Basic ${Buffer.from(`ops@${KEY[org]}.example/token:zd-${KEY[org]}`).toString('base64')}`,
  },
  {
    name: 'intercom',
    read: async org => (await (await import('@/services/support/provider')).supportProviderFor(org, { sourceSlug: 'intercom' })).readTicket('1'),
    host: () => 'https://api.intercom.io/',
    auth: org => `Bearer ic-${KEY[org]}`,
  },
  {
    name: 'freshdesk',
    read: async org => (await (await import('@/services/support/provider')).supportProviderFor(org, { sourceSlug: 'freshdesk' })).searchTickets('', { limit: 5 }),
    host: org => `https://${KEY[org]}.freshdesk.com/`,
    auth: org => `Basic ${Buffer.from(`fd-${KEY[org]}:X`).toString('base64')}`,
  },
  {
    name: 'linear',
    read: async org => (await (await import('@/services/tracker/provider')).trackerProviderFor(org)).searchIssues('', 5),
    host: () => 'https://api.linear.app/',
    auth: org => `lin_api_${KEY[org]}`,
  },
  {
    name: 'gitlab',
    read: async org => (await (await import('@/services/repo/providers/gitlab')).gitlabRepoProvider(`https://gitlab.${KEY[org]}.example`)).readFile(org, 'acme/api', 'README.md', 'main'),
    host: org => `https://gitlab.${KEY[org]}.example/`,
    auth: org => `Bearer glpat-${KEY[org]}`,
  },
  {
    name: 'pagerduty',
    read: async org => (await (await import('@/services/incident/provider')).incidentProviderFor(org)).listIncidents({ limit: 5 }),
    host: () => 'https://api.pagerduty.com/',
    auth: org => `Token token=pd-${KEY[org]}`,
  },
  {
    name: 'confluence',
    read: async org => (await (await import('@/services/docs/provider')).docsProviderFor(org)).searchPages('runbook', 5),
    host: org => `https://${KEY[org]}.atlassian.example/`,
    auth: org => `Basic ${Buffer.from(`ops@${KEY[org]}.example:cf-${KEY[org]}`).toString('base64')}`,
  },
  {
    name: 'dropbox',
    read: async org => (await (await import('@/services/files/provider')).filesProviderFor(org, { sourceSlug: 'dropbox' })).search('contract', 5),
    host: () => 'https://api.dropboxapi.com/',
    auth: org => `Bearer dbx-${KEY[org]}`,
  },
  {
    name: 'box',
    read: async org => (await (await import('@/services/files/provider')).filesProviderFor(org, { sourceSlug: 'box' })).search('contract', 5),
    host: () => 'https://api.box.com/',
    auth: org => `Bearer boxdev-${KEY[org]}`,
  },
];

describe('two workspaces, one connector: each spends its own credential', () => {
  it.each(cases)('$name', async ({ read, host, auth }) => {
    stubVendors();

    await read('org_northwind');
    const first = [...calls];
    calls.length = 0;
    await read('org_kestrel');
    const second = [...calls];

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);

    for (const call of first) {
      expect(call.url.startsWith(host('org_northwind'))).toBe(true);
      expect(call.auth).toBe(auth('org_northwind'));
    }
    for (const call of second) {
      expect(call.url.startsWith(host('org_kestrel'))).toBe(true);
      expect(call.auth).toBe(auth('org_kestrel'));
    }
  });
});
