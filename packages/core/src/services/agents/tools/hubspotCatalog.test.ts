/**
 * Catalog tools — live schema + lists reads:
 *
 *   - `hubspot_list_properties` returns the live schema (a custom property
 *     created minutes earlier is present), filters by name_contains and
 *     custom_only, and puts custom properties first.
 *   - `hubspot_list_lists` rows carry id, name, size, processing type,
 *     object type, updated-at; the name filter is passed through; limits
 *     clamp to 250.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForSource: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { hubspotCatalogTools } = await import('./hubspotCatalog');

const ORG = 'org_hs_catalog';

function ctxFor(): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: ['hubspot'],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(): Map<string, Invokable> {
  const list = hubspotCatalogTools(ctxFor()) as unknown as Invokable[];
  return new Map(list.map(t => [t.name, t]));
}

async function call(tool: Invokable | undefined, args: Record<string, unknown> = {}) {
  return JSON.parse(await tool!.invoke(args));
}

function res(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'pat-1' });
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } });
});

describe('hubspot_list_properties', () => {
  const SCHEMA = {
    results: [
      { name: 'email', label: 'Email', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true },
      { name: 'annualrevenue', label: 'Annual Revenue', type: 'number', fieldType: 'number', groupName: 'companyinformation', hubspotDefined: true },
      { name: 'prospect_brief', label: 'Prospect Brief', type: 'string', fieldType: 'textarea', groupName: 'sales', hubspotDefined: false },
      { name: 'dead_prop', label: 'Dead', archived: true },
    ],
  };

  it('returns the live schema per object type, custom properties first', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      return res(200, SCHEMA);
    }));
    const out = await call(toolsByName().get('hubspot_list_properties'), { object_type: 'deals' });

    expect(urls[0]).toContain('/crm/v3/properties/deals');
    expect(out.ok).toBe(true);
    expect(out.count).toBe(3);
    expect(out.properties[0]).toMatchObject({ name: 'prospect_brief', custom: true, field_type: 'textarea' });
    expect(out.properties.map((p: { name: string }) => p.name)).not.toContain('dead_prop');
  });

  it('name_contains and custom_only filter correctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, SCHEMA)));
    const tool = toolsByName().get('hubspot_list_properties');
    const byName = await call(tool, { name_contains: 'revenue' });

    expect(byName.count).toBe(1);
    expect(byName.properties[0].name).toBe('annualrevenue');

    const custom = await call(tool, { custom_only: true });

    expect(custom.count).toBe(1);
    expect(custom.properties[0].name).toBe('prospect_brief');
  });
});

describe('hubspot_list_lists', () => {
  it('rows carry id, name, size, processing type, object type, updated-at', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, {
        total: 2,
        lists: [
          { listId: '31', name: 'MQLs this quarter', processingType: 'DYNAMIC', objectTypeId: '0-1', updatedAt: '2026-08-20T00:00:00Z', additionalProperties: { hs_list_size: '113' } },
          { listId: '7', name: 'Newsletter', processingType: 'MANUAL', objectTypeId: '0-1', updatedAt: '2026-07-01T00:00:00Z', additionalProperties: {} },
        ],
      });
    }));
    const out = await call(toolsByName().get('hubspot_list_lists'), { query: 'mql' });

    expect(out).toMatchObject({ ok: true, count: 2, total: 2, query: 'mql' });
    expect(out.lists[0]).toEqual({
      id: '31',
      name: 'MQLs this quarter',
      size: 113,
      processing_type: 'DYNAMIC',
      object_type: '0-1',
      updated_at: '2026-08-20T00:00:00Z',
    });
    expect(out.lists[1].size).toBeNull();
    expect(bodies[0]).toContain('"query":"mql"');
  });

  it('clamps the limit to 250', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return res(200, { lists: [] });
    }));
    await call(toolsByName().get('hubspot_list_lists'), { limit: 9999 });

    expect(bodies[0]).toContain('"count":250');
  });
});
