/**
 * Which finance system answers, and with whose key: each org's call spends
 * that org's own credential, resolved per call, never one cached from the
 * org before it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type Row = { id: number; slug: string; kind: string; config: Record<string, unknown>; apiTokenId: string | null };

const state = vi.hoisted(() => ({
  sources: {} as Record<string, Row[]>,
  credentials: {} as Record<string, Record<string, unknown>>,
}));

vi.mock('@/libs/connectors/families', () => {
  const FAMILY_KINDS = { finance: ['stripe', 'quickbooks', 'xero', 'netsuite', 'ramp', 'bill'], people: ['gusto', 'rippling', 'workday'] };
  return { FAMILY_KINDS, familySourcesForOrg: async (orgId: string, family: 'finance' | 'people') => (state.sources[orgId] ?? []).filter(s => FAMILY_KINDS[family].includes(s.kind)) };
});
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async ({ orgId, apiTokenId }: { orgId: string; apiTokenId: string | null }) => (apiTokenId ? state.credentials[`${orgId}:${apiTokenId}`] : undefined),
}));

const { financeProviderFor } = await import('./provider');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('financeProviderFor', () => {
  it('spends each org\'s own Stripe key, in sequence, with nothing carried between them', async () => {
    state.sources = {
      org_a: [{ id: 1, slug: 'stripe', kind: 'stripe', config: {}, apiTokenId: 'tok_a' }],
      org_b: [{ id: 2, slug: 'stripe', kind: 'stripe', config: {}, apiTokenId: 'tok_b' }],
    };
    state.credentials = {
      'org_a:tok_a': { apiKey: 'rk_live_FixtureNorthwind0001' },
      'org_b:tok_b': { apiKey: 'rk_live_FixtureKestrel00002' },
    };
    const auths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      auths.push((init?.headers as Record<string, string>).authorization ?? '');
      return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
    }));

    await (await financeProviderFor('org_a')).list('customer', { limit: 1 });
    await (await financeProviderFor('org_b')).list('customer', { limit: 1 });
    await (await financeProviderFor('org_a')).list('customer', { limit: 1 });

    expect(auths).toEqual(['Bearer rk_live_FixtureNorthwind0001', 'Bearer rk_live_FixtureKestrel00002', 'Bearer rk_live_FixtureNorthwind0001']);
  });

  it('answers with the only source, the named one, or a refusal that names what is connected', async () => {
    state.sources = {
      org_a: [
        { id: 1, slug: 'stripe', kind: 'stripe', config: {}, apiTokenId: 'tok_a' },
        { id: 3, slug: 'books', kind: 'netsuite', config: {}, apiTokenId: null },
        { id: 4, slug: 'jira', kind: 'jira', config: {}, apiTokenId: null },
      ],
    };
    state.credentials = { 'org_a:tok_a': { apiKey: 'rk_live_FixtureNorthwind0001' } };

    await expect(financeProviderFor('org_a')).rejects.toThrow(/reaches 2 finance sources; name one \(source\)\. Connected: stripe \(stripe\); books \(netsuite\)/);
    await expect(financeProviderFor('org_a', { sourceSlug: 'stripe' })).resolves.toMatchObject({ kind: 'stripe', sourceSlug: 'stripe' });
    await expect(financeProviderFor('org_a', { allowed: ['stripe'] })).resolves.toMatchObject({ sourceSlug: 'stripe' });
    await expect(financeProviderFor('org_a', { sourceSlug: 'ledger' })).rejects.toThrow(/No finance source named ledger/);
    await expect(financeProviderFor('org_a', { allowed: [] })).rejects.toThrow(/No finance system is connected for this agent/);
  });
});
