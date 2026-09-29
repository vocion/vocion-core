/**
 * The one builder for an agent's RuntimeContext.
 *
 * Six call sites used to assemble this object by hand and drifted: the MCP
 * bridge set neither `restSources` nor `filingTypes`, so a REST source had
 * tools in chat and none over MCP. These tests pin what the builder resolves
 * from the workspace (plugins, zone, filing types, REST sources), what it
 * forwards from the call (who, where, which run), and that a caller holding
 * a resolved scope pays for no second read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, businessObjectTypeSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { agentScope, runtimeContextForAgent, runtimeContextFromScope, workspaceScope } = await import('./runtimeContext');

const ORG = 'org_runtime_context';

const DELIVERY_CONFIG = {
  _connector: 'rest',
  _name: 'Acme Delivery API',
  toolPrefix: 'delivery',
  tools: [
    { name: 'list_projects', description: 'List projects.', method: 'GET', path: '/api/projects', input: { type: 'object', properties: { status: { type: 'string' } } } },
  ],
  actions: [
    { name: 'update_milestone', method: 'PUT', path: '/api/milestones/{id}', input: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  ],
};

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct_rc', name: 'Northwind', slug: 'northwind' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct_rc', slug: 'northwind', name: 'Northwind', enabledPlugins: ['wiki'], timeZone: 'Europe/Paris' });
  await db.insert(knowledgeSourceSchema).values([
    { orgId: ORG, slug: 'acme-delivery', kind: 'plugin', configJson: DELIVERY_CONFIG },
    { orgId: ORG, slug: 'other-api', kind: 'plugin', configJson: { ...DELIVERY_CONFIG, _name: 'Other API', toolPrefix: 'other' } },
  ]);
  await db.insert(businessObjectTypeSchema).values([
    { orgId: ORG, slug: 'request', label: 'Request', schema: { 'type': 'object', 'x-agent-file': true, 'properties': { title: { type: 'string' }, summary: { type: 'string' } } } },
    { orgId: ORG, slug: 'note', label: 'Note', schema: { type: 'object', properties: { title: { type: 'string' } } } },
  ]);
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: 'delivery-lead',
    name: 'Delivery Lead',
    systemPrompt: 'You run delivery.',
    connectorSources: ['acme-delivery'],
    objectTypeSlugs: ['request', 'note'],
    searchConfig: { maxResults: 3 },
    harnessConfig: { excludeTools: ['crawl_site'] },
  });
});

afterAll(async () => {
  await db.delete(agentSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
});

async function agentRow() {
  const [row] = await db.select().from(agentSchema);
  return row!;
}

describe('workspaceScope', () => {
  it('reads the plugins the workspace has on and its zone', async () => {
    await expect(workspaceScope(ORG)).resolves.toEqual({ enabledPlugins: ['wiki'], defaultTimeZone: 'Europe/Paris' });
  });

  it('answers for a workspace that does not exist rather than throwing', async () => {
    const scope = await workspaceScope('org_nowhere');

    expect(scope.enabledPlugins).toEqual([]);
    expect(typeof scope.defaultTimeZone).toBe('string');
  });
});

describe('agentScope', () => {
  it('resolves the REST sources the agent holds — and only those', async () => {
    const scope = await agentScope(ORG, await agentRow());

    expect(scope.restSources?.map(s => s.slug)).toEqual(['acme-delivery']);
    expect(scope.restSources?.[0]?.name).toBe('Acme Delivery API');
    expect(scope.restSources?.[0]?.config.tools.map(t => t.name)).toEqual(['list_projects']);
  });

  it('resolves the typed filing tools for the types that opt in', async () => {
    const scope = await agentScope(ORG, await agentRow());

    expect(scope.filingTypes?.map(t => t.toolName)).toEqual(['file_request']);
  });

  it('takes the workspace facts from the caller when it already has them', async () => {
    const scope = await agentScope(ORG, await agentRow(), { enabledPlugins: ['data-rooms'], defaultTimeZone: 'UTC' });

    expect(scope.enabledPlugins).toEqual(['data-rooms']);
    expect(scope.defaultTimeZone).toBe('UTC');
    expect(scope.restSources).toHaveLength(1);
  });
});

describe('runtimeContextForAgent', () => {
  it('builds the whole shape from the row and the workspace', async () => {
    const row = await agentRow();
    const ctx = await runtimeContextForAgent(ORG, row);

    expect(ctx).toMatchObject({
      orgId: ORG,
      agentSlug: 'delivery-lead',
      connectorSources: ['acme-delivery'],
      objectTypeSlugs: ['request', 'note'],
      enabledPlugins: ['wiki'],
      defaultTimeZone: 'Europe/Paris',
      timeZone: 'Europe/Paris',
      searchConfig: { maxResults: 3 },
      harnessConfig: { excludeTools: ['crawl_site'] },
      citationSeq: { current: 0 },
    });
    expect(ctx.restSources?.map(s => s.slug)).toEqual(['acme-delivery']);
    expect(ctx.filingTypes?.map(t => t.toolName)).toEqual(['file_request']);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.provider).toBeUndefined();
    // A caller that passes no emit gets a sink, never a throw.
    expect(() => ctx.emit({ type: 'done' } as never)).not.toThrow();
  });

  it('forwards what the call brings, and the person\'s zone over the workspace\'s', async () => {
    const events: unknown[] = [];
    const ctx = await runtimeContextForAgent(ORG, await agentRow(), {
      userId: 'user_owner',
      allowedSourceSlugs: ['acme-delivery'],
      missionSlug: 'weekly-review',
      missionRunId: 42,
      conversationId: 7,
      timeZone: 'America/New_York',
      provider: 'runtime',
      turnMessage: 'Change this',
      emit: e => events.push(e),
    });

    expect(ctx).toMatchObject({
      userId: 'user_owner',
      allowedSourceSlugs: ['acme-delivery'],
      missionSlug: 'weekly-review',
      missionRunId: 42,
      conversationId: 7,
      timeZone: 'America/New_York',
      defaultTimeZone: 'Europe/Paris',
      provider: 'runtime',
      turnMessage: 'Change this',
    });

    ctx.emit({ type: 'done' } as never);

    expect(events).toEqual([{ type: 'done' }]);
  });

  it('falls back to the workspace zone when the turn names one that is not a zone', async () => {
    const ctx = await runtimeContextForAgent(ORG, await agentRow(), { timeZone: 'Not/AZone' });

    expect(ctx.timeZone).toBe('Europe/Paris');
  });

  it('gives every call its own object, so nothing another turn does can reach in', async () => {
    const row = await agentRow();
    const [a, b] = await Promise.all([runtimeContextForAgent(ORG, row), runtimeContextForAgent(ORG, row)]);
    a.citationSeq.current = 5;

    expect(b.citationSeq.current).toBe(0);
    expect(a).not.toBe(b);
  });

  it('reads nothing when the caller hands it a resolved scope', async () => {
    const row = await agentRow();
    const scope = { enabledPlugins: ['data-rooms'], defaultTimeZone: 'UTC', filingTypes: [], restSources: [] };
    const ctx = await runtimeContextForAgent('org_nowhere', row, { scope });

    expect(ctx.enabledPlugins).toEqual(['data-rooms']);
    expect(ctx.defaultTimeZone).toBe('UTC');
    expect(ctx.restSources).toEqual([]);
    expect(ctx.filingTypes).toEqual([]);

    // The synchronous half alone gives the same answer, field for field.
    const { emit: _a, ...sync } = runtimeContextFromScope('org_nowhere', row, scope);
    const { emit: _b, ...built } = ctx;

    expect(built).toEqual(sync);
  });
});
