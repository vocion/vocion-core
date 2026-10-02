/**
 * The REST tool family — what makes a source's declared reads trustworthy
 * as agent tools:
 *
 *   - Source-gated: absent without a REST source in `connectorSources`,
 *     absent when the per-user ACL excludes it, present through the registry.
 *   - One tool per declared read, named `<prefix>_<name>`, plus
 *     `<prefix>_list_actions` for the writes an agent may propose.
 *   - Executes with the source's vault credential against the live API; the
 *     picked response comes back as text, capped and saying so.
 *   - Failures are data: no credential, a refused token, a 404, a timeout, a
 *     missing path parameter. Nothing throws into a turn.
 *   - `loadRestSources` reads only this org's rows, only the REST ones.
 */
import type { RuntimeContext } from '../types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_CONFIG } from '@/libs/rest/spec.test';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { loadRestSources, restTools } = await import('./restDirect');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_rest_fixture';
const OTHER_ORG = 'org_rest_other_fixture';

type Invokable = { name: string; description: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function res(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status < 300, status, text: async () => text } as unknown as Response;
}

async function seedSource(orgId: string, slug: string, config: Record<string, unknown> = EXAMPLE_CONFIG, name = 'Acme Delivery API') {
  await db.insert(knowledgeSourceSchema).values({ orgId, slug, kind: 'plugin', configJson: { ...config, _connector: 'rest', _name: name } });
}

async function ctxFor(sources: string[] = ['acme-delivery'], allowed?: string[]): Promise<RuntimeContext> {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'delivery-lead',
    connectorSources: sources,
    ...(allowed ? { allowedSourceSlugs: allowed } : {}),
    restSources: await loadRestSources(ORG, sources),
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

async function toolsByName(ctx?: RuntimeContext): Promise<Map<string, Invokable>> {
  const list = restTools(ctx ?? await ctxFor()) as unknown as Invokable[];
  return new Map(list.map(t => [t.name, t]));
}

beforeEach(async () => {
  await db.delete(knowledgeSourceSchema);
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ baseUrl: 'https://api.northwind.example', token: 'tok-fixture' });
});

afterEach(() => vi.unstubAllGlobals());

describe('loadRestSources', () => {
  it('reads this org\'s REST sources among the named slugs, and nothing of another org\'s', async () => {
    await seedSource(ORG, 'acme-delivery');
    await seedSource(ORG, 'other-api', { tools: [] }, 'Other');
    await seedSource(OTHER_ORG, 'acme-delivery');
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } });

    const scoped = await loadRestSources(ORG, ['acme-delivery', 'hubspot']);

    expect(scoped.map(s => [s.slug, s.name])).toEqual([['acme-delivery', 'Acme Delivery API']]);
    expect((await loadRestSources(ORG)).map(s => s.slug)).toEqual(['acme-delivery', 'other-api']);
    expect(await loadRestSources(ORG, [])).toEqual([]);
  });

  it('recognises a row added by hand under the connector slug, and skips a row whose config does not parse', async () => {
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'rest', kind: 'plugin', configJson: { tools: [{ name: 'ping', method: 'GET', path: '/ping' }] } });
    await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'broken', kind: 'plugin', configJson: { _connector: 'rest', tools: 'nope' } });

    expect((await loadRestSources(ORG, ['rest', 'broken'])).map(s => s.slug)).toEqual(['rest']);
  });
});

describe('gating', () => {
  it('is absent without a REST source in scope, and present with one', async () => {
    await seedSource(ORG, 'acme-delivery');

    expect(restTools(await ctxFor(['hubspot'])).map(t => t.name)).toEqual([]);
    expect(restTools(await ctxFor()).map(t => t.name)).toEqual(['delivery_list_projects', 'delivery_get_project', 'delivery_list_actions']);
  });

  it('is absent when the per-user ACL allows no REST source', async () => {
    await seedSource(ORG, 'acme-delivery');

    expect(restTools(await ctxFor(['acme-delivery'], ['hubspot'])).map(t => t.name)).toEqual([]);
    expect(restTools(await ctxFor(['acme-delivery'], ['acme-delivery'])).map(t => t.name)).toHaveLength(3);
  });

  it('is built into the domain tool set through the registry', async () => {
    await seedSource(ORG, 'acme-delivery');
    const names = buildDomainTools(await ctxFor()).map(t => t.name);

    expect(names).toContain('delivery_list_projects');
    expect(names).toContain('delivery_list_actions');
    expect(buildDomainTools(await ctxFor(['web'])).map(t => t.name)).not.toContain('delivery_list_projects');
  });

  it('names tools by the slug when no prefix is declared', async () => {
    await seedSource(ORG, 'billing-api', { tools: [{ name: 'list_invoices', method: 'GET', path: '/invoices' }] }, 'Billing');

    expect(restTools(await ctxFor(['billing-api'])).map(t => t.name)).toEqual(['billing_api_list_invoices', 'billing_api_list_actions']);
  });
});

describe('a declared read, executed', () => {
  beforeEach(() => seedSource(ORG, 'acme-delivery'));

  it('calls the live API with the vault credential, the rendered query, and returns the picked JSON as text', async () => {
    const f = vi.fn(async () => res(200, { data: [{ documentId: 'p1', name: 'Kestrel rollout' }], meta: { pagination: { total: 1 } } }));
    vi.stubGlobal('fetch', f);
    const tool = (await toolsByName()).get('delivery_list_projects')!;

    expect(tool.description).toContain('List projects visible to the account');

    const out = await tool.invoke({ status: 'active' });

    expect(JSON.parse(out)).toEqual([{ documentId: 'p1', name: 'Kestrel rollout' }]);
    expect(getCredentialsForSource).toHaveBeenCalledWith(ORG, 'acme-delivery');

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe('https://api.northwind.example/api/projects?filters%5Bstatus%5D%5B%24eq%5D=active&pagination%5BpageSize%5D=100');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-fixture');
  });

  it('substitutes a path parameter, and refuses a call that lacks one before any request is made', async () => {
    const f = vi.fn(async () => res(200, { data: { documentId: 'p1' } }));
    vi.stubGlobal('fetch', f);
    const tool = (await toolsByName()).get('delivery_get_project')!;
    await tool.invoke({ documentId: 'p 1' });

    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.northwind.example/api/projects/p%201');

    // The zod schema requires documentId; a call around it (the endpoint
    // rebuilt by the container) still meets renderPath's refusal.
    const rendered = JSON.parse(await (tool as unknown as { func: (i: Record<string, unknown>) => Promise<string> }).func({}));

    expect(rendered).toMatchObject({ ok: false, error: 'missing_path_param', message: expect.stringContaining('"documentId"') });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('answers no_credentials as data when the vault holds nothing for the source', async () => {
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const out = JSON.parse(await (await toolsByName()).get('delivery_list_projects')!.invoke({}));

    expect(out).toMatchObject({ ok: false, error: 'no_credentials' });
    expect(out.message).toContain('Connectors page');
    expect(f).not.toHaveBeenCalled();
  });

  it('hands a refused token, a 404 and a timeout back as data, never the token itself', async () => {
    const tool = (await toolsByName()).get('delivery_list_projects')!;
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { error: { message: 'Missing or invalid credentials' } })));
    const refused = JSON.parse(await tool.invoke({}));

    expect(refused).toMatchObject({ ok: false, error: 'http_401', status: 401 });
    expect(refused.message).toMatch(/expired or lack the rights/);
    expect(JSON.stringify(refused)).not.toContain('tok-fixture');

    vi.stubGlobal('fetch', vi.fn(async () => res(404, { error: 'Not Found' })));

    expect(JSON.parse(await tool.invoke({}))).toMatchObject({ ok: false, error: 'http_404' });

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    }));

    expect(JSON.parse(await tool.invoke({}))).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('resolves built-in dates in the turn\'s zone, and never asks the model for them', async () => {
    await db.delete(knowledgeSourceSchema);
    await seedSource(ORG, 'acme-delivery', { toolPrefix: 'delivery', tools: [{ name: 'due_soon', method: 'GET', path: '/api/milestones', query: { 'filters[dueDate][$gte]': '{$today}', 'filters[dueDate][$lte]': '{$today+7d}' } }] });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T23:30:00Z'));
    const f = vi.fn(async () => res(200, []));
    vi.stubGlobal('fetch', f);
    try {
      const ctx = { ...(await ctxFor()), timeZone: 'Pacific/Auckland' };
      const tool = (restTools(ctx) as unknown as Invokable[]).find(t => t.name === 'delivery_due_soon')!;

      expect(JSON.stringify((tool as unknown as { schema: unknown }).schema)).not.toContain('today');

      await tool.invoke({});
    } finally {
      vi.useRealTimers();
    }

    expect(decodeURIComponent((f.mock.calls[0] as unknown as [string])[0])).toBe('https://api.northwind.example/api/milestones?filters[dueDate][$gte]=2026-09-30&filters[dueDate][$lte]=2026-10-07');
  });

  it('says when the picked path is missing from the answer rather than returning the whole document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { results: [] })));
    const out = JSON.parse(await (await toolsByName()).get('delivery_list_projects')!.invoke({}));

    expect(out).toMatchObject({ ok: false, error: 'pick_missing', message: expect.stringContaining('"data"') });
    expect(out.message).toContain('results');
  });

  it('returns only the leaves response.select names, after pick and before the cap, whatever else the API served', async () => {
    await db.delete(knowledgeSourceSchema);
    await seedSource(ORG, 'acme-delivery', {
      toolPrefix: 'delivery',
      tools: [
        { name: 'list_projects', method: 'GET', path: '/api/projects', response: { pick: 'data', select: ['[].documentId', '[].name', '[].company.name'], maxChars: 300 } },
        { name: 'page', method: 'GET', path: '/api/page', response: { select: ['data[].documentId', 'meta.pagination.total'] } },
      ],
    });
    const heavy = { blocks: Array.from({ length: 40 }, (_, i) => ({ i, text: 'a long paragraph of body copy' })) };
    const body = {
      data: [
        { documentId: 'p1', name: 'Kestrel rollout', company: { name: 'Kestrel Capital', notes: heavy }, brief: heavy },
        { documentId: 'p2', name: 'Bellwater refit', brief: heavy },
      ],
      meta: { pagination: { page: 1, total: 2 } },
    };
    vi.stubGlobal('fetch', vi.fn(async () => res(200, body)));
    const tools = await toolsByName();

    // Selected after pick — the rows only, each row down to its named leaves —
    // so 300 characters is room enough for what used to be thousands.
    const list = await tools.get('delivery_list_projects')!.invoke({});

    expect(list).not.toContain('truncated');
    expect(JSON.parse(list)).toEqual([
      { documentId: 'p1', name: 'Kestrel rollout', company: { name: 'Kestrel Capital' } },
      { documentId: 'p2', name: 'Bellwater refit' },
    ]);

    // Without pick, the nesting is kept and meta survives only where named.
    expect(JSON.parse(await tools.get('delivery_page')!.invoke({}))).toEqual({ data: [{ documentId: 'p1' }, { documentId: 'p2' }], meta: { pagination: { total: 2 } } });
  });

  it('caps a long response at the declared maxChars and says how long it was', async () => {
    await db.delete(knowledgeSourceSchema);
    await seedSource(ORG, 'acme-delivery', { toolPrefix: 'delivery', tools: [{ name: 'dump', method: 'GET', path: '/dump', response: { maxChars: 300 } }] });
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { rows: Array.from({ length: 100 }, (_, i) => ({ i, name: `row ${i}` })) })));
    const out = await (await toolsByName()).get('delivery_dump')!.invoke({});

    expect(out.length).toBeLessThan(500);
    expect(out).toMatch(/truncated: the response is \d+ characters; the first 300 are shown/);
  });
});

describe('<prefix>_list_actions', () => {
  it('returns the action catalog — name, description, input schema, reversibility — and how to propose one', async () => {
    await seedSource(ORG, 'acme-delivery');
    const out = JSON.parse(await (await toolsByName()).get('delivery_list_actions')!.invoke({}));

    expect(out.sourceSlug).toBe('acme-delivery');
    expect(out.how).toContain('rest.request');
    expect(out.actions).toEqual([{
      name: 'update_milestone',
      description: 'Change a milestone\'s name or due date.',
      method: 'PUT',
      path: '/api/milestones/{documentId}',
      input: EXAMPLE_CONFIG.actions[0]!.input,
      reversible: false,
    }]);
  });
});
