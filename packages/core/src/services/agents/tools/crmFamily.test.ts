/**
 * The CRM family's reads: present only for an agent with a CRM source (by
 * kind), each answering through the source's provider, failures handed back
 * as data, and every schema sendable to a model. The provider is mocked; the
 * records are invented.
 */
import type { RuntimeContext } from '../types';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const provider = vi.hoisted(() => ({
  kind: 'salesforce',
  sourceSlug: 'salesforce',
  search: vi.fn(async () => [{ object: 'account', id: '001xx000003DGb2AAG', name: 'Kestrel Capital', url: null, owner: null, created: null, updated: null, fields: {} }]),
  getRecord: vi.fn(async () => {
    throw new Error('Salesforce has no deal 006xx000001a2bCAAQ that this user can see.');
  }),
  activity: vi.fn(async () => []),
  listDeals: vi.fn(async () => [{ object: 'deal', id: '7', name: 'Acme pilot', open: null, fields: {} }]),
  fields: vi.fn(async () => [{ name: 'StageName', label: 'Stage', type: 'picklist', writable: true }, { name: 'Id', label: 'Id', type: 'id', writable: false }]),
}));
const resolved = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock('@/services/crm/provider', () => ({ crmProviderFor: async (_org: string, opts: unknown) => {
  resolved.args.push(opts);
  return provider;
} }));

const { crmFamilyTools } = await import('./crmFamily');

type Invokable = { name: string; schema: unknown; invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxFor(sources: string[], kinds?: Record<string, string>): RuntimeContext {
  return { orgId: 'org_1', agentSlug: 'account-manager', connectorSources: sources, sourceKinds: kinds, objectTypeSlugs: [], searchConfig: {}, harnessConfig: {}, emit: () => {}, citationSeq: { current: 0 } } as RuntimeContext;
}

function byName(ctx: RuntimeContext): Map<string, Invokable> {
  return new Map((crmFamilyTools(ctx) as unknown as Invokable[]).map(t => [t.name, t]));
}

describe('the CRM family reads', () => {
  it('exist only for an agent whose sources include a CRM, by kind', () => {
    expect(crmFamilyTools(ctxFor([]))).toHaveLength(0);
    expect(crmFamilyTools(ctxFor(['hubspot', 'jira']))).toHaveLength(0);
    expect([...byName(ctxFor(['salesforce'])).keys()]).toEqual(['crm_search_records', 'crm_get_record', 'crm_record_activity', 'crm_list_deals', 'crm_list_fields']);
    expect(crmFamilyTools(ctxFor(['sales-crm'], { 'sales-crm': 'pipedrive' }))).toHaveLength(5);
  });

  it('every schema converts to JSON Schema, so it can be bound to a model', () => {
    for (const t of byName(ctxFor(['attio'])).values()) {
      expect(() => toJsonSchema(t.schema as never), t.name).not.toThrow();
      expect(t.schema).toBeInstanceOf(z.ZodType);
    }
  });

  it('searches through the agent\'s one CRM source', async () => {
    const out = JSON.parse(await byName(ctxFor(['salesforce'])).get('crm_search_records')!.invoke({ object: 'account', query: 'Kestrel' }));

    expect(resolved.args.at(-1)).toEqual({ sourceSlug: 'salesforce' });
    expect(provider.search).toHaveBeenCalledWith('account', 'Kestrel', 10);
    expect(out).toMatchObject({ ok: true, crm: 'salesforce', count: 1, records: [{ name: 'Kestrel Capital' }] });
  });

  it('hands a provider\'s failure back as data rather than throwing the turn away', async () => {
    const out = JSON.parse(await byName(ctxFor(['salesforce'])).get('crm_get_record')!.invoke({ object: 'deal', id: '006xx000001a2bCAAQ' }));

    expect(out).toEqual({ ok: false, error: 'Salesforce has no deal 006xx000001a2bCAAQ that this user can see.' });
  });

  it('refuses a source that is not one of the agent\'s', async () => {
    const out = JSON.parse(await byName(ctxFor(['salesforce'])).get('crm_list_deals')!.invoke({ source: 'pipedrive' }));

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not one of this agent's CRM sources/);
  });

  it('says when the CRM cannot tell open deals from closed ones', async () => {
    const out = JSON.parse(await byName(ctxFor(['attio'])).get('crm_list_deals')!.invoke({}));

    expect(provider.listDeals).toHaveBeenCalledWith({ status: 'open', limit: 50 });
    expect(out.note).toMatch(/does not say which stages are won or lost/);
  });

  it('lists only writable fields unless asked for all', async () => {
    const tool = byName(ctxFor(['salesforce'])).get('crm_list_fields')!;

    expect(JSON.parse(await tool.invoke({ object: 'deal' })).fields.map((f: { name: string }) => f.name)).toEqual(['StageName']);
    expect(JSON.parse(await tool.invoke({ object: 'deal', writable_only: false })).count).toBe(2);
  });
});
