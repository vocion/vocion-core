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

const WEB_SEARCH_STATUS = { capability: 'web_search', provider: 'tavily', ready: true, missingEnv: [], keySource: 'workspace' as const };

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct_catalog', name: 'Northwind', slug: 'northwind-catalog' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_catalog', slug: 'northwind-catalog', name: 'Northwind', enabledPlugins: [] });
  const [delivery, cms, hubspot] = await db.insert(knowledgeSourceSchema).values([
    { orgId: ORG, slug: 'acme-delivery', kind: 'plugin', configJson: DELIVERY },
    { orgId: ORG, slug: 'contoso-cms', kind: 'plugin', configJson: CMS },
    { orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: {} },
  ]).returning({ id: knowledgeSourceSchema.id });
  deliveryId = delivery!.id;
  cmsId = cms!.id;
  hubspotId = hubspot!.id;
  await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'request', label: 'Request', schema: { 'type': 'object', 'x-agent-file': true, 'properties': { title: { type: 'string' }, summary: { type: 'string' } } } });
  await db.insert(agentSchema).values([
    { orgId: ORG, slug: 'delivery-lead', name: 'Delivery Lead', systemPrompt: 'Run delivery.', connectorSources: ['acme-delivery', 'hubspot'], objectTypeSlugs: ['request'], harnessConfig: {} },
    { orgId: ORG, slug: 'analyst', name: 'Analyst', systemPrompt: 'Analyse.', connectorSources: ['acme-delivery'], objectTypeSlugs: [], harnessConfig: { excludeTools: ['crawl_site'] } },
  ]);
});

beforeEach(() => {
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

    expect(catalog.families.map(f => f.id)).toEqual(['builtin', 'records', 'hubspot', 'rest:acme-delivery', 'rest:contoso-cms', 'workspace']);
    expect(catalog.agents).toEqual([{ slug: 'delivery-lead', name: 'Delivery Lead' }, { slug: 'analyst', name: 'Analyst' }]);
  });

  it('unions the agents\' tools once each and remembers every holder', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const listProjects = catalogToolByName(catalog, 'delivery_list_projects');
    const crawl = catalogToolByName(catalog, 'crawl_site');
    const search = catalogToolByName(catalog, 'web_search');

    expect(listProjects?.tool.agents).toEqual(['delivery-lead', 'analyst']);
    // The analyst excludes it, so only the lead holds it.
    expect(crawl?.tool.agents).toEqual(['delivery-lead']);
    expect(search?.tool.agents).toEqual(['delivery-lead', 'analyst']);

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

  it('carries the provider/key status onto the paid built-ins, and skips it when asked', async () => {
    const catalog = await toolCatalogForOrg(ORG);
    const builtin = catalog.families[0]!;

    expect(builtin.tools.map(t => t.name)).toEqual(['web_search', 'fetch_url', 'crawl_site', 'generate_image', 'create_artifact', 'run_code']);
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
