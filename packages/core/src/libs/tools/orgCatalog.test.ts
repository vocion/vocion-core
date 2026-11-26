/**
 * The workspace's tool catalog: the union of what its agents can reach.
 *
 * A workspace that had just connected a REST API with sixty tools saw six
 * on the Tools page, because the page rendered the static list. These tests
 * pin the union (two agents, one tool), the dedupe (each tool once, every
 * holder remembered), the families (built-in, records, a source family, a
 * REST source, the workspace's own) and readiness (a vaulted credential for
 * a source; the provider key for a paid built-in).
 *
 * The credential store and the paid providers are mocked; the agents,
 * sources and object types are real rows.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const credentialStatusForOrg = vi.fn();
vi.mock('@/services/SourceCredentialService', () => ({ credentialStatusForOrg: (orgId: string) => credentialStatusForOrg(orgId) }));

const capabilityStatuses = vi.fn();
vi.mock('./catalog', async (importOriginal) => {
  const original = await importOriginal<typeof import('./catalog')>();
  return { ...original, capabilityStatuses: (orgId?: string) => capabilityStatuses(orgId) };
});

const { db } = await import('@/libs/DB');
const { agentSchema, businessObjectTypeSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { catalogToolByName, toolCatalogForOrg, toolTitle } = await import('./orgCatalog');

const ORG = 'org_tool_catalog';

const DELIVERY = {
  _connector: 'rest',
  _name: 'Acme Delivery API',
  toolPrefix: 'delivery',
  tools: [
    { name: 'list_projects', description: 'List projects visible to the account.', method: 'GET', path: '/api/projects', input: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'archived'] } } }, query: { 'filters[status][$eq]': '{status}' }, response: { pick: 'data' } },
    { name: 'get_project', method: 'GET', path: '/api/projects/{documentId}', input: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] } },
  ],
  actions: [
    { name: 'update_milestone', description: 'Change a milestone\'s name or due date.', method: 'PUT', path: '/api/milestones/{documentId}', input: { type: 'object', properties: { documentId: { type: 'string' }, name: { type: 'string' } }, required: ['documentId'] }, body: { data: { name: '{name}' } } },
  ],
};

const CMS = { _connector: 'rest', _name: 'Contoso CMS', tools: [{ name: 'list_pages', method: 'GET', path: '/pages' }], actions: [] };

let deliveryId = 0;
let cmsId = 0;
let hubspotId = 0;
let zendeskId = 0;

const WEB_SEARCH_STATUS = { capability: 'web_search', provider: 'tavily', ready: true, missingEnv: [], keySource: 'workspace' as const };

/**
 * Replaces the zendesk source's config, so a test can add or drop `helpCenter.host`.
 * @param configJson - The new config.
 */
async function setZendeskConfig(configJson: Record<string, unknown>): Promise<void> {
  await db.update(knowledgeSourceSchema).set({ configJson }).where(eq(knowledgeSourceSchema.id, zendeskId));
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct_catalog', name: 'Northwind', slug: 'northwind-catalog' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_catalog', slug: 'northwind-catalog', name: 'Northwind', enabledPlugins: [] });
  const [delivery, cms, hubspot, zendesk] = await db.insert(knowledgeSourceSchema).values([
    { orgId: ORG, slug: 'acme-delivery', kind: 'plugin', configJson: DELIVERY },
    { orgId: ORG, slug: 'contoso-cms', kind: 'plugin', configJson: CMS },
    { orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: {} },
    { orgId: ORG, slug: 'zendesk', kind: 'plugin', configJson: { _connector: 'zendesk' } },
  ]).returning({ id: knowledgeSourceSchema.id });
  deliveryId = delivery!.id;
  cmsId = cms!.id;
  hubspotId = hubspot!.id;
  zendeskId = zendesk!.id;
  await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { 'type': 'object', 'x-agent-file': true, 'properties': { title: { type: 'string' }, summary: { type: 'string' } } } });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'delivery-lead', name: 'Delivery Lead', systemPrompt: 'Run delivery.', connectorSources: ['acme-delivery', 'hubspot'], objectTypeSlugs: ['request'], harnessConfig: {} },
    { orgId: ORG, slug: 'analyst', name: 'Analyst', systemPrompt: 'Analyse.', connectorSources: ['acme-delivery'], objectTypeSlugs: [], harnessConfig: { excludeTools: ['crawl_site'] } },
    { orgId: ORG, slug: 'support-lead', name: 'Support Lead', systemPrompt: 'Answer from the Help Center.', connectorSources: ['zendesk'], objectTypeSlugs: [], harnessConfig: {} },
  ]);
});

beforeEach(async () => {
  await setZendeskConfig({ _connector: 'zendesk' });
  credentialStatusForOrg.mockReset();
  credentialStatusForOrg.mockResolvedValue({
    byConnectorSlug: {},
    bySourceId: { [deliveryId]: { connected: true, updatedAt: null, broken: null } },
  });
  capabilityStatuses.mockReset();
  capabilityStatuses.mockResolvedValue([WEB_SEARCH_STATUS]);
});

afterAll(async () => {
  await db.delete(agentSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

describe('toolCatalogForOrg', () => {
  it('lists the families in order: built-in, records, the connected source, each REST source, then the workspace\'s own', async () => {
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.map(f => f.id)).toEqual(['builtin', 'records', 'hubspot', 'zendesk', 'rest:acme-delivery', 'rest:contoso-cms', 'workspace']);
    expect(catalog.agents).toEqual([{ slug: 'delivery-lead', name: 'Delivery Lead' }, { slug: 'analyst', name: 'Analyst' }, { slug: 'support-lead', name: 'Support Lead' }]);
  });

  it('unions the agents\' tools once each and remembers every holder', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const listProjects = catalogToolByName(catalog, 'delivery_list_projects');
    const crawl = catalogToolByName(catalog, 'crawl_site');
    const search = catalogToolByName(catalog, 'web_search');

    expect(listProjects?.tool.agents).toEqual(['delivery-lead', 'analyst']);
    // The analyst excludes it, so only the other two hold it.
    expect(crawl?.tool.agents).toEqual(['delivery-lead', 'support-lead']);
    expect(search?.tool.agents).toEqual(['delivery-lead', 'analyst', 'support-lead']);

    // Each name appears exactly once across every family.
    const names = catalog.families.flatMap(f => f.tools.map(t => t.name));

    expect(new Set(names).size).toBe(names.length);
  });

  it('shows a REST source as its reads, its action catalog tool and its writes, with the endpoint behind each', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const delivery = catalog.families.find(f => f.id === 'rest:acme-delivery')!;

    expect(delivery.label).toBe('Acme Delivery API');
    expect(delivery.kind).toBe('rest');
    expect(delivery.tools.map(t => t.name)).toEqual(['delivery_list_projects', 'delivery_get_project', 'delivery_list_actions']);
    expect(delivery.tools[0]).toMatchObject({
      title: 'List projects',
      description: 'List projects visible to the account.',
      rest: { sourceSlug: 'acme-delivery', sourceName: 'Acme Delivery API', method: 'GET', path: '/api/projects', query: { 'filters[status][$eq]': '{status}' }, pick: 'data' },
    });
    // The schema is the one the model sees, from the registry.
    expect((delivery.tools[0]!.inputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('status');
    expect(delivery.actions).toEqual([
      expect.objectContaining({ name: 'update_milestone', description: 'Change a milestone\'s name or due date.', method: 'PUT', path: '/api/milestones/{documentId}', reversible: false, sourceSlug: 'acme-delivery' }),
    ]);
    // A vaulted credential: ready.
    expect(delivery.readiness).toEqual({ ready: true, keyStateUnknown: false });
    expect(delivery.sources).toEqual([{ id: deliveryId, slug: 'acme-delivery', name: 'Acme Delivery API' }]);
  });

  it('lists a REST source nobody holds, with no agents and no credential', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const cms = catalog.families.find(f => f.id === 'rest:contoso-cms')!;

    expect(cms.tools.map(t => t.name)).toEqual(['contoso_cms_list_pages', 'contoso_cms_list_actions']);
    expect(cms.tools.every(t => t.agents.length === 0)).toBe(true);
    expect(cms.readiness).toEqual({ ready: false, keyStateUnknown: false });
    expect(cms.actions).toEqual([]);
  });

  it('puts the typed filing tools under Records and everything else an agent has under Workspace', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const records = catalog.families.find(f => f.id === 'records')!;
    const workspace = catalog.families.find(f => f.id === 'workspace')!;

    expect(records.tools.map(t => t.name)).toEqual(['file_request']);
    expect(records.tools[0]!.agents).toEqual(['delivery-lead']);
    expect(records.readiness).toBeNull();
    expect(workspace.tools.map(t => t.name)).toContain('search_knowledge');
    expect(workspace.tools.map(t => t.name)).toContain('propose_action');
    expect(workspace.tools.map(t => t.name)).not.toContain('file_request');
    expect(workspace.tools.map(t => t.name)).not.toContain('delivery_list_projects');
    expect(workspace.tools.map(t => t.name)).not.toContain('web_search');
  });

  it('shows a source family with its sources and says when none has a credential', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const hubspot = catalog.families.find(f => f.id === 'hubspot')!;

    expect(hubspot.label).toBe('HubSpot');
    expect(hubspot.sources).toEqual([{ id: hubspotId, slug: 'hubspot', name: 'hubspot' }]);
    expect(hubspot.tools.map(t => t.name)).toContain('hubspot_get_contact');
    expect(hubspot.tools.every(t => t.agents.includes('delivery-lead') && !t.agents.includes('analyst'))).toBe(true);
    expect(hubspot.readiness).toEqual({ ready: false, keyStateUnknown: false });
  });

  it('puts the two Help Center tools under a Zendesk family held only by the agent with the zendesk source, not under Workspace', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const zendesk = catalog.families.find(f => f.id === 'zendesk')!;
    const workspace = catalog.families.find(f => f.id === 'workspace')!;

    expect(zendesk.label).toBe('Zendesk');
    expect(zendesk.tools.map(t => t.name)).toEqual(['zendesk_list_help_center_articles', 'zendesk_get_help_center_articles']);
    expect(zendesk.tools.every(t => t.agents.length === 1 && t.agents[0] === 'support-lead')).toBe(true);
    expect(workspace.tools.map(t => t.name).filter(name => name.startsWith('zendesk_'))).toEqual([]);
  });

  it('says the Zendesk family needs a credential when the source sets no helpCenter.host and none is connected', async () => {
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: false, keyStateUnknown: false });
  });

  it('treats the Zendesk family as ready with a helpCenter.host and no credential, because the Help Center tools read anonymously', async () => {
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host: 'https://help.example.com' } });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: true, keyStateUnknown: false });
  });

  it('treats the Zendesk family as ready when a credential is connected, with no helpCenter.host', async () => {
    credentialStatusForOrg.mockResolvedValue({ byConnectorSlug: { zendesk: { connected: true, updatedAt: null, broken: null } }, bySourceId: {} });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: true, keyStateUnknown: false });
  });

  it.each(['http://help.example.com', 'help.example.com', 'https://help.example.com/hc', 'https://help.example.com:8443', 'https://203.0.113.9'])('does not call the Zendesk family ready for the host %s, which the Help Center tools refuse', async (host) => {
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host } });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: false, keyStateUnknown: false, notReadyCause: 'settings' });
  });

  it('does not count a blank helpCenter.host as a way to read without a credential', async () => {
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host: '  ' } });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: false, keyStateUnknown: false, notReadyCause: 'settings' });
  });

  it('does not call the Zendesk family ready when a credential is connected but the source host is one the tools refuse', async () => {
    credentialStatusForOrg.mockResolvedValue({ byConnectorSlug: { zendesk: { connected: true, updatedAt: null, broken: null } }, bySourceId: {} });
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host: 'http://x' } });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: false, keyStateUnknown: false, notReadyCause: 'settings' });
  });

  it('does not call the Zendesk family ready when a credential is connected but the locale is one the tools refuse', async () => {
    credentialStatusForOrg.mockResolvedValue({ byConnectorSlug: { zendesk: { connected: true, updatedAt: null, broken: null } }, bySourceId: {} });
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { locale: 'english' } });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: false, keyStateUnknown: false, notReadyCause: 'settings' });
  });

  it('does not blame the credential when a connected source has bad helpCenter settings: the cause is the settings', async () => {
    credentialStatusForOrg.mockResolvedValue({ byConnectorSlug: { zendesk: { connected: true, updatedAt: null, broken: null } }, bySourceId: {} });
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host: 'http://x' } });
    const readiness = (await toolCatalogForOrg(ORG)).families.find(f => f.id === 'zendesk')!.readiness;

    expect(readiness?.notReadyCause).toBe('settings');
    expect(readiness?.ready).toBe(false);
  });

  it('leaves the cause empty for a plain missing credential, so the page keeps its credential wording', async () => {
    const readiness = (await toolCatalogForOrg(ORG)).families.find(f => f.id === 'zendesk')!.readiness;

    expect(readiness?.notReadyCause).toBeUndefined();
  });

  it('judges the lowest-id zendesk source, the one the tools read for an agent holding both, not any source that would be served', async () => {
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host: 'http://broken' } });
    const [second] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'zendesk-eu', kind: 'plugin', configJson: { _connector: 'zendesk', helpCenter: { host: 'https://help.example.com' } } }).returning({ id: knowledgeSourceSchema.id });
    try {
      const readiness = (await toolCatalogForOrg(ORG)).families.find(f => f.id === 'zendesk')!.readiness;

      expect(readiness).toEqual({ ready: false, keyStateUnknown: false, notReadyCause: 'settings' });
    } finally {
      await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, second!.id));
    }
  });

  it('judges the real zendesk source, not a local-files source that holds the slug zendesk', async () => {
    // The guide's sample-tickets setup: a local-files source took the slug
    // `zendesk`, so the real one is `zendesk-2`. The local-files source needs no
    // credential, so judging it would say Ready while the tools, which pick
    // sources by kind, read `zendesk-2` and find no host and no credential.
    await setZendeskConfig({ _connector: 'local-files' });
    const [real] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'zendesk-2', kind: 'plugin', configJson: { _connector: 'zendesk' } }).returning({ id: knowledgeSourceSchema.id });
    try {
      const family = (await toolCatalogForOrg(ORG)).families.find(f => f.id === 'zendesk')!;

      expect(family.readiness).toEqual({ ready: false, keyStateUnknown: false });
      expect(family.sources.map(s => s.slug)).toEqual(['zendesk-2']);
    } finally {
      await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.id, real!.id));
    }
  });

  it('treats the Zendesk family as ready when a credential is connected and the source has an empty helpCenter block', async () => {
    credentialStatusForOrg.mockResolvedValue({ byConnectorSlug: { zendesk: { connected: true, updatedAt: null, broken: null } }, bySourceId: {} });
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: {} });
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'zendesk')!.readiness).toEqual({ ready: true, keyStateUnknown: false });
  });

  it('carries the provider/key status onto the paid built-ins, and skips it when asked', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const builtin = catalog.families[0]!;

    expect(builtin.tools.map(t => t.name)).toEqual(['web_search', 'fetch_url', 'crawl_site', 'serp_search', 'serp_compare', 'keyword_metrics', 'generate_image', 'create_artifact', 'run_code']);
    expect(builtin.tools[0]!.status).toEqual(WEB_SEARCH_STATUS);
    expect(builtin.tools[0]!.title).toBe('Web search');
    expect(catalog.statuses).toEqual([WEB_SEARCH_STATUS]);

    const bare = await toolCatalogForOrg(ORG, { withStatuses: false });

    expect(bare.statuses).toEqual([]);
    expect(bare.families[0]!.tools[0]!.status).toBeUndefined();
    expect(capabilityStatuses).toHaveBeenCalledTimes(1);
  });

  it('says it could not check rather than "needs key" when the credential store will not answer', async () => {
    credentialStatusForOrg.mockRejectedValue(new Error('store down'));
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalog.families.find(f => f.id === 'rest:acme-delivery')!.readiness).toEqual({ ready: false, keyStateUnknown: true });
    expect(catalog.families.find(f => f.id === 'hubspot')!.readiness).toEqual({ ready: false, keyStateUnknown: true });
  });

  it('says it could not check the Zendesk credential, rather than "needs key", when the store will not answer and the source names no host', async () => {
    credentialStatusForOrg.mockRejectedValue(new Error('store down'));
    await setZendeskConfig({ _connector: 'zendesk' });

    const readiness = (await toolCatalogForOrg(ORG)).families.find(f => f.id === 'zendesk')!.readiness;

    expect(readiness).toEqual({ ready: false, keyStateUnknown: true });
  });

  it('still calls the Zendesk family ready when the store will not answer but the source names a valid host, since no credential is needed', async () => {
    credentialStatusForOrg.mockRejectedValue(new Error('store down'));
    await setZendeskConfig({ _connector: 'zendesk', helpCenter: { host: 'https://help.example.com' } });

    const readiness = (await toolCatalogForOrg(ORG)).families.find(f => f.id === 'zendesk')!.readiness;

    expect(readiness).toEqual({ ready: true, keyStateUnknown: false });
  });

  it('still lists the built-ins and the REST sources for a workspace with no agents', async () => {
    const catalog = await toolCatalogForOrg('org_without_agents');

    expect(catalog.families.map(f => f.id)).toEqual(['builtin']);
    expect(catalog.families[0]!.tools.every(t => t.agents.length === 0)).toBe(true);
    expect(catalog.agents).toEqual([]);
  });
});

describe('catalogToolByName', () => {
  it('finds a tool with its family, and answers null for a name nobody has', async () => {
    const catalog = await toolCatalogForOrg(ORG);

    expect(catalogToolByName(catalog, 'delivery_get_project')?.family.id).toBe('rest:acme-delivery');
    expect(catalogToolByName(catalog, 'file_request')?.family.label).toBe('Records');
    expect(catalogToolByName(catalog, 'drop_all_tables')).toBeNull();
  });
});

describe('toolTitle', () => {
  it('humanises a snake_case name', () => {
    expect(toolTitle('list_projects')).toBe('List projects');
    expect(toolTitle('file_request')).toBe('File request');
    expect(toolTitle('hubspot-get_contact')).toBe('Hubspot get contact');
  });
});

// `cmsId` is read so the row is proven to exist; the family test above names it by slug.
it('seeded the second REST source', () => {
  expect(cmsId).toBeGreaterThan(0);
});

describe('a remote MCP server', () => {
  const MCP_ORG = 'org_tool_catalog_mcp';

  beforeAll(async () => {
    await db.insert(projectSchema).values({ id: MCP_ORG, accountId: 'acct_catalog', slug: 'northwind-catalog-mcp', name: 'Northwind Finance', enabledPlugins: [] });
    await db.insert(knowledgeSourceSchema).values({ orgId: MCP_ORG, slug: 'company-knowledge', kind: 'plugin', configJson: { _connector: 'mcp', _name: 'Company Knowledge', auth: 'person', url: 'https://knowledge.northwind.example/mcp', readTools: ['search_knowledge', 'get_document'] } });
    await db.insert(agentSchema).values({ orgId: MCP_ORG, slug: 'controller', name: 'Controller', systemPrompt: 'Close the books.', connectorSources: ['company-knowledge'], objectTypeSlugs: [], harnessConfig: {} });
  });

  it('is its own family of declared reads, namespaced by source, held by the agents assigned to it', async () => {
    credentialStatusForOrg.mockResolvedValue({ bySourceId: {}, byConnectorSlug: {} });
    const catalog = await toolCatalogForOrg(MCP_ORG, { withStatuses: false });
    const family = catalog.families.find(f => f.id === 'mcp:company-knowledge')!;

    expect(family).toMatchObject({ kind: 'mcp', label: 'Company Knowledge', readiness: { ready: true } });
    expect(family.tools.map(t => [t.name, t.title, t.agents])).toEqual([
      ['company-knowledge.search_knowledge', 'Search knowledge', ['controller']],
      ['company-knowledge.get_document', 'Get document', ['controller']],
    ]);
    expect(catalog.families.find(f => f.kind === 'workspace')?.tools.map(t => t.name) ?? []).not.toContain('mcp_read');
    expect(catalogToolByName(catalog, 'search_knowledge')?.family.id).not.toBe('mcp:company-knowledge');
  });
});
