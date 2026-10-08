/**
 * The Pipedrive CRM provider: each workspace spends its own token; a search
 * reads the matches whole; an update turns an option's label into its id,
 * routes a custom field under `custom_fields` and records what it
 * overwrote; a note is created on the record and deleted by Undo. Every
 * company, record and token is invented.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));

const TOKENS: Record<string, Record<string, unknown>> = {
  org_northwind: { token: 'pd_token_northwind_000000000001' },
  org_contoso: { token: 'pd_token_contoso_00000000000002' },
};
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string }) => TOKENS[input.orgId],
}));

const { pipedriveCrmProvider } = await import('./pipedrive');

const SOURCE: FamilySource = { id: 5, slug: 'pipedrive', kind: 'pipedrive', config: {}, apiTokenId: null };
const TIER = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

type Call = { url: string; method: string; token: string | null; body: string };

function recorder(answer: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url: decodeURIComponent(url), method: init?.method ?? 'GET', token: new Headers(init?.headers).get('x-api-token'), body: String(init?.body ?? '') };
    calls.push(call);
    const path = new URL(url).pathname;
    const own = answer(call);
    if (own) {
      return own;
    }
    if (path === '/v1/users/me') {
      return json({ data: { company_domain: 'northwind' } });
    }
    return json({ success: true, data: [] });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('pipedriveCrmProvider', () => {
  it('spends each workspace\'s own token, in turn', async () => {
    const calls = recorder(() => undefined);
    await (await pipedriveCrmProvider('org_northwind', SOURCE)).listDeals({ status: 'open', limit: 5 });
    await (await pipedriveCrmProvider('org_contoso', SOURCE)).listDeals({ status: 'open', limit: 5 });
    const deals = calls.filter(c => c.url.includes('/api/v2/deals'));

    expect(deals.map(c => c.token)).toEqual(['pd_token_northwind_000000000001', 'pd_token_contoso_00000000000002']);
    expect(deals[0]!.url).toContain('status=open');
    expect(deals[0]!.url).toContain('sort_by=update_time');
  });

  it('reads the search matches whole, with their organization\'s name', async () => {
    const calls = recorder((call) => {
      if (call.url.includes('/api/v2/persons/search')) {
        return json({ data: { items: [{ item: { id: 60, organization: { id: 50, name: 'Contoso Supply' } } }] } });
      }
      if (call.url.includes('/api/v2/persons?')) {
        return json({ data: [{ id: 60, name: 'Lee Park', emails: [{ value: 'lee@contoso.example', primary: true }], org_id: 50 }] });
      }
      return undefined;
    });
    const records = await (await pipedriveCrmProvider('org_northwind', SOURCE)).search('contact', 'Lee', 10);

    expect(records).toMatchObject([{ id: '60', name: 'Lee Park', email: 'lee@contoso.example', account: { id: '50', name: 'Contoso Supply' }, url: 'https://northwind.pipedrive.com/person/60' }]);
    expect(calls.find(c => c.url.includes('/api/v2/persons?'))!.url).toContain('ids=60');
  });

  it('writes an option by its id, a custom field under custom_fields, and records what it overwrote', async () => {
    const calls = recorder((call) => {
      if (call.url.includes('/v1/dealFields')) {
        return json({ data: [{ key: TIER, name: 'Tier', field_type: 'enum', options: [{ id: 12, label: 'Enterprise' }, { id: 11, label: 'Growth' }] }, { key: 'title', name: 'Title', field_type: 'varchar' }] });
      }
      if (call.url.endsWith('/api/v2/deals/70') && call.method === 'GET') {
        return json({ data: { id: 70, title: 'Contoso rollout', custom_fields: { [TIER]: 11 } } });
      }
      if (call.method === 'PATCH') {
        return json({ data: { id: 70 } });
      }
      return undefined;
    });
    const out = await (await pipedriveCrmProvider('org_northwind', SOURCE)).updateRecord('deal', '70', { [TIER]: 'Enterprise', title: 'Contoso rollout, phase 1' });

    expect(out.previous).toEqual({ [TIER]: 11, title: 'Contoso rollout' });
    expect(JSON.parse(calls.find(c => c.method === 'PATCH')!.body)).toEqual({ title: 'Contoso rollout, phase 1', custom_fields: { [TIER]: 12 } });
  });

  it('adds a note on the record and deletes it', async () => {
    const calls = recorder(call => (call.method === 'POST' ? json({ data: { id: 95 } }) : call.method === 'DELETE' ? json({ data: { id: 95 } }) : undefined));
    const provider = await pipedriveCrmProvider('org_northwind', SOURCE);
    const note = await provider.addNote('deal', '70', { text: 'Budget <approved>.\nNext: SSO.' });
    await provider.deleteNote(note.id);

    expect(JSON.parse(calls.find(c => c.method === 'POST')!.body)).toEqual({ content: 'Budget &lt;approved&gt;.<br>Next: SSO.', deal_id: 70 });
    expect(calls.find(c => c.method === 'DELETE')!.url).toContain('/v1/notes/95');
    expect(note).toEqual({ id: '95', url: 'https://northwind.pipedrive.com/deal/70' });
  });

  it('refuses an id that is not a number', async () => {
    recorder(() => undefined);

    await expect((await pipedriveCrmProvider('org_northwind', SOURCE)).getRecord('deal', 'Contoso rollout')).rejects.toThrow(/not a Pipedrive id/);
  });

  it('says plainly when the source has no token', async () => {
    await expect(pipedriveCrmProvider('org_nobody', SOURCE)).rejects.toThrow(/No Pipedrive API token/);
  });
});
