/**
 * A plugin agent gets the workspace's sources of the kind it requires, on
 * Vocion Cloud, whichever came first: the app or the connection. On PGlite,
 * against the marketing plugin as it ships. Every workspace, person and
 * account here is fictional.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { togglePluginForProject } = await import('@/services/PluginService');
const { agentsRequiringSource, bindConnectedSource } = await import('./bindConnectedSource');

// The app first, then Google Ads: the order a person takes on Cloud.
const APP_FIRST = 'proj_bind_northwind';
// Google Ads connected before the app was turned on.
const ADS_FIRST = 'proj_bind_kestrel';
// Google Ads connected for one Project only.
const SCOPED = 'proj_bind_harbor';

const sourcesOf = async (orgId: string, slug: string) =>
  (await db.select({ s: agentSchema.connectorSources }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))))[0]?.s ?? null;
const addAdsSource = async (orgId: string, slug: string, projectId: string | null = null) =>
  db.insert(knowledgeSourceSchema).values({ orgId, slug, kind: 'plugin', projectId, configJson: { _connector: 'google-ads', customerId: '1234567890' } });

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-bind', name: 'Northwind Cloud', slug: 'northwind-bind' });
  await db.insert(projectSchema).values([
    { id: APP_FIRST, accountId: 'acct-bind', slug: 'northwind', name: 'Northwind', leadAgentSlug: 'workspace-lead' },
    { id: ADS_FIRST, accountId: 'acct-bind', slug: 'kestrel', name: 'Kestrel', leadAgentSlug: 'workspace-lead' },
    { id: SCOPED, accountId: 'acct-bind', slug: 'harbor', name: 'Harbor', leadAgentSlug: 'workspace-lead' },
  ]);
  await db.insert(agentSchema).values([
    { orgId: APP_FIRST, slug: 'research-helper', name: 'Research helper', systemPrompt: 'x', active: 'true' },
  ]);
});

describe('the app installed, then Google Ads connected', () => {
  it('installs a Marketing lead with no source while none is connected', async () => {
    await togglePluginForProject({ orgId: APP_FIRST, projectSlug: 'northwind', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: 'user:mara' });

    expect(await sourcesOf(APP_FIRST, 'marketing-lead')).toEqual([]);
  });

  it('gives the connected account to the Marketing lead, and to nobody else', async () => {
    await addAdsSource(APP_FIRST, 'google-ads');

    expect(await bindConnectedSource(APP_FIRST, { slug: 'google-ads', kind: 'google-ads' })).toEqual(['marketing-lead']);
    expect(await sourcesOf(APP_FIRST, 'marketing-lead')).toEqual(['google-ads']);
    expect(await sourcesOf(APP_FIRST, 'research-helper')).toEqual([]);
  });

  it('is idempotent', async () => {
    expect(await bindConnectedSource(APP_FIRST, { slug: 'google-ads', kind: 'google-ads' })).toEqual([]);
    expect(await sourcesOf(APP_FIRST, 'marketing-lead')).toEqual(['google-ads']);
  });

  it('binds nothing a plugin agent does not require', async () => {
    await db.insert(knowledgeSourceSchema).values({ orgId: APP_FIRST, slug: 'slack', kind: 'plugin', configJson: { _connector: 'slack' } });

    expect(await bindConnectedSource(APP_FIRST, { slug: 'slack', kind: 'slack' })).toEqual([]);
    expect(await sourcesOf(APP_FIRST, 'marketing-lead')).toEqual(['google-ads']);
  });
});

describe('Google Ads connected, then the app installed', () => {
  it('binds the workspace\'s own source at install, though the install declares none', async () => {
    await addAdsSource(ADS_FIRST, 'google-ads');
    await togglePluginForProject({ orgId: ADS_FIRST, projectSlug: 'kestrel', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: 'user:mara' });

    expect(await sourcesOf(ADS_FIRST, 'marketing-lead')).toEqual(['google-ads']);
  });
});

describe('a source connected for one Project', () => {
  it('is never bound workspace-wide, at install or on connect', async () => {
    await db.insert(projectSchema).values({ id: 'proj_bind_harbor_acme', accountId: 'acct-bind', slug: 'harbor-acme', name: 'Acme', leadAgentSlug: 'workspace-lead' });
    await addAdsSource(SCOPED, 'google-ads-acme', 'proj_bind_harbor_acme');
    await togglePluginForProject({ orgId: SCOPED, projectSlug: 'harbor', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: 'user:mara' });

    expect(await sourcesOf(SCOPED, 'marketing-lead')).toEqual([]);
    expect(await bindConnectedSource(SCOPED, { slug: 'google-ads-acme', kind: 'google-ads' })).toEqual([]);
  });
});

describe('the pieces', () => {
  it('names the agents whose requires reach a source\'s kind, by family or by kind', () => {
    const agents = [
      { slug: 'marketing-lead', requires: { connectors: ['ads'], optional: [] } },
      { slug: 'bookkeeper', requires: { connectors: ['finance'], optional: [] } },
      { slug: 'ads-watcher', requires: { connectors: [], optional: ['google-ads'] } },
      { slug: 'plain' },
    ];

    expect(agentsRequiringSource(agents, { slug: 'google-ads', kind: 'google-ads' })).toEqual(['marketing-lead', 'ads-watcher']);
    expect(agentsRequiringSource(agents, { slug: 'meta', kind: 'meta-ads' })).toEqual(['marketing-lead']);
    expect(agentsRequiringSource(agents, { slug: 'web', kind: 'web' })).toEqual([]);
  });
});
