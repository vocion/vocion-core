/**
 * The Attio CRM provider: each workspace spends its own token; what hangs off
 * a record is read from its own reference attributes; an update records what
 * each attribute held and clears with an empty list; a note is created on the
 * record and deleted by Undo. Every workspace, record and token is invented.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));

const TOKENS: Record<string, Record<string, unknown>> = {
  org_northwind: { token: 'attio_token_northwind_01' },
  org_contoso: { token: 'attio_token_contoso_0002' },
};
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string }) => TOKENS[input.orgId],
}));

const { attioCrmProvider } = await import('./attio');

const SOURCE: FamilySource = { id: 6, slug: 'attio', kind: 'attio', config: {}, apiTokenId: null };
const COMPANY_ID = '0b1e8c52-3f7a-4c1d-9e2b-1a2b3c4d5e6f';
const PERSON_ID = '1c2f9d63-4a8b-4d2e-8f3c-2b3c4d5e6f70';
const NOTE_ID = '3e4b1f85-6cad-4f40-8b5e-4d5e6f708192';

const COMPANY = { id: { record_id: COMPANY_ID }, web_url: `https://app.attio.example/c/${COMPANY_ID}`, values: {
  name: [{ attribute_type: 'text', value: 'Acme Robotics', active_from: '2026-01-01T00:00:00Z' }],
  description: [{ attribute_type: 'text', value: 'Warehouse robots.', active_from: '2026-01-01T00:00:00Z' }],
  team: [{ attribute_type: 'record-reference', target_object: 'people', target_record_id: PERSON_ID, active_from: '2026-01-01T00:00:00Z' }],
} };
const PERSON = { id: { record_id: PERSON_ID }, values: { name: [{ attribute_type: 'personal-name', full_name: 'Sam Okoro', active_from: '2026-01-01T00:00:00Z' }] } };

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

type Call = { url: string; method: string; auth: string | null; body: string };

function recorder(answer: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url: decodeURIComponent(url), method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization'), body: String(init?.body ?? '') };
    calls.push(call);
    return answer(call) ?? json({ data: [] });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('attioCrmProvider', () => {
  it('spends each workspace\'s own token, in turn', async () => {
    const calls = recorder(() => undefined);
    await (await attioCrmProvider('org_northwind', SOURCE)).listDeals({ status: 'open', limit: 5 });
    await (await attioCrmProvider('org_contoso', SOURCE)).listDeals({ status: 'open', limit: 5 });
    const queries = calls.filter(c => c.url.endsWith('/objects/deals/records/query'));

    expect(queries.map(c => c.auth)).toEqual(['Bearer attio_token_northwind_01', 'Bearer attio_token_contoso_0002']);
  });

  it('reads a company whole, with the people its team attribute points at', async () => {
    recorder((call) => {
      if (call.url.endsWith(`/objects/companies/records/${COMPANY_ID}`)) {
        return json({ data: COMPANY });
      }
      if (call.url.endsWith(`/objects/people/records/${PERSON_ID}`)) {
        return json({ data: PERSON });
      }
      return undefined;
    });
    const record = await (await attioCrmProvider('org_northwind', SOURCE)).getRecord('account', COMPANY_ID);

    expect(record).toMatchObject({ id: COMPANY_ID, name: 'Acme Robotics', description: 'Warehouse robots.', url: COMPANY.web_url });
    expect(record.related.contacts.map(c => c.name)).toEqual(['Sam Okoro']);
  });

  it('records what an update overwrote and clears an empty value with an empty list', async () => {
    const calls = recorder((call) => {
      if (call.method === 'GET' && call.url.endsWith(`/objects/companies/records/${COMPANY_ID}`)) {
        return json({ data: COMPANY });
      }
      if (call.method === 'PATCH') {
        return json({ data: COMPANY });
      }
      return undefined;
    });
    const provider = await attioCrmProvider('org_northwind', SOURCE);
    const out = await provider.updateRecord('account', COMPANY_ID, { description: 'Warehouse and port robots.', categories: null });

    expect(out.previous).toEqual({ description: 'Warehouse robots.', categories: null });
    expect(JSON.parse(calls.find(c => c.method === 'PATCH')!.body)).toEqual({ data: { values: { description: 'Warehouse and port robots.', categories: [] } } });
  });

  it('adds a plaintext note on the record and deletes it', async () => {
    const calls = recorder((call) => {
      if (call.method === 'POST' && call.url.endsWith('/v2/notes')) {
        return json({ data: { id: { note_id: NOTE_ID } } });
      }
      if (call.method === 'DELETE') {
        return json(undefined, 204);
      }
      if (call.url.endsWith(`/objects/companies/records/${COMPANY_ID}`)) {
        return json({ data: COMPANY });
      }
      return undefined;
    });
    const provider = await attioCrmProvider('org_northwind', SOURCE);
    const note = await provider.addNote('account', COMPANY_ID, { text: 'Pilot agreed for Q1.\nSSO required.' });
    await provider.deleteNote(note.id);

    expect(JSON.parse(calls.find(c => c.method === 'POST')!.body)).toEqual({ data: { parent_object: 'companies', parent_record_id: COMPANY_ID, title: 'Pilot agreed for Q1.', format: 'plaintext', content: 'Pilot agreed for Q1.\nSSO required.' } });
    expect(calls.find(c => c.method === 'DELETE')!.url).toContain(`/v2/notes/${NOTE_ID}`);
    expect(note.url).toBe(COMPANY.web_url);
  });

  it('refuses an id that is not a record uuid, and an attribute that is not a slug', async () => {
    recorder(() => undefined);
    const provider = await attioCrmProvider('org_northwind', SOURCE);

    await expect(provider.getRecord('account', 'Acme Robotics')).rejects.toThrow(/not an Attio record id/);
    await expect(provider.updateRecord('account', COMPANY_ID, { 'name; drop': 'x' })).rejects.toThrow(/not an Attio attribute slug/);
  });
});
