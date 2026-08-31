/**
 * Direct contact tools — the acceptance rows that make them trustworthy:
 *
 *   - get by email and by id return the SAME normalized record + ordered
 *     {key,label,value} field list (custom properties ride along).
 *   - An unknown identifier is a no_match result, never an exception.
 *   - A multi-word search miss broadens once to the most distinctive token
 *     and says so; a returned id round-trips into hubspot_get_contact.
 *   - No vaulted credential → no_hubspot_credentials; 403 → missing_scope.
 *   - Source-gated: absent without a hubspot source, absent when a per-user
 *     ACL excludes it.
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
const { hubspotLeadsTools } = await import('./hubspotLeads');
const { buildDomainTools } = await import('./registry');

const ORG = 'org_hs_leads';

function ctxFor(sources: string[] = ['hubspot'], allowed?: string[]): RuntimeContext {
  return {
    orgId: ORG,
    userId: 'test-user',
    agentSlug: 'revenue-lead',
    connectorSources: sources,
    ...(allowed ? { allowedSourceSlugs: allowed } : {}),
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: () => {},
    citationSeq: { current: 0 },
  };
}

type Invokable = { name: string; invoke: (input: Record<string, unknown>) => Promise<string> };

function toolsByName(): Map<string, Invokable> {
  const list = hubspotLeadsTools(ctxFor()) as unknown as Invokable[];
  return new Map(list.map(t => [t.name, t]));
}

async function call(tool: Invokable | undefined, args: Record<string, unknown>) {
  return JSON.parse(await tool!.invoke(args));
}

function res(status: number, body: unknown): Response {
  return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const PROPERTY_SCHEMA = {
  results: [
    { name: 'firstname', label: 'First Name' },
    { name: 'email', label: 'Email' },
    { name: 'jobtitle', label: 'Job Title' },
    { name: 'favorite_snack', label: 'Favorite Snack' },
    { name: 'old_field', label: 'Old', archived: true },
  ],
};

const MARA = {
  id: '9412',
  properties: {
    firstname: 'Mara',
    lastname: 'Okafor',
    email: 'mara@acme.com',
    jobtitle: 'VP Engineering',
    company: 'Acme',
    lifecyclestage: 'marketingqualifiedlead',
    favorite_snack: 'stroopwafel',
  },
};

/**
 * fetch mock that answers the schema fetch + whatever the record call is.
 * @param recordBody
 * @param recordStatus
 */
function stubHubspot(recordBody: unknown, recordStatus = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/crm/v3/properties/contacts')) {
      return res(200, PROPERTY_SCHEMA);
    }
    return res(recordStatus, recordBody);
  }));
  return calls;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(getCredentialsForSource).mockReset();
  vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'pat-1' });
  const { eq } = await import('drizzle-orm');
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'hubspot', kind: 'plugin', configJson: { _connector: 'hubspot' } });
});

describe('hubspot_get_contact', () => {
  it('returns the same normalized record + ordered field list by id and by email', async () => {
    stubHubspot({ results: [MARA] });
    const tool = toolsByName().get('hubspot_get_contact');
    const byId = await call(tool, { identifier: '9412' });
    const byEmail = await call(tool, { identifier: 'mara@acme.com' });

    expect(byId.ok).toBe(true);
    expect(byId.contact).toEqual(byEmail.contact);
    expect(byId.contact).toMatchObject({ id: '9412', first_name: 'Mara', email: 'mara@acme.com', title: 'VP Engineering', lifecycle_stage: 'marketingqualifiedlead' });
    // Ordered {key,label,value} list, custom property included with HubSpot's label.
    expect(byId.field_count).toBe(byId.fields.length);

    const snack = byId.fields.find((f: { key: string }) => f.key === 'favorite_snack');

    expect(snack).toMatchObject({ label: 'Favorite Snack', value: 'stroopwafel' });
    expect(byId.fields[0].key).toBe('id');
  });

  it('routes an id to batch/read and an email to search', async () => {
    const calls = stubHubspot({ results: [MARA] });
    const tool = toolsByName().get('hubspot_get_contact');
    await call(tool, { identifier: '9412' });
    await call(tool, { identifier: 'mara@acme.com' });
    const urls = calls.map(c => c.url).filter(u => !u.includes('/properties/'));

    expect(urls[0]).toContain('/crm/v3/objects/contacts/batch/read');
    expect(urls[1]).toContain('/crm/v3/objects/contacts/search');
  });

  it('reports an unknown identifier as no_match, not an exception', async () => {
    stubHubspot({ results: [] });
    const out = await call(toolsByName().get('hubspot_get_contact'), { identifier: 'ghost@nowhere.com' });

    expect(out).toMatchObject({ ok: true, contact: null, reason: 'no_match' });
    expect(out.retry_hint).toContain('hubspot_search_contacts');
  });

  it('treats a 404 on an id lookup as no_match', async () => {
    stubHubspot({ status: 'error', message: 'not found' }, 404);
    const out = await call(toolsByName().get('hubspot_get_contact'), { identifier: '999999' });

    expect(out).toMatchObject({ ok: true, reason: 'no_match' });
  });

  it('returns no_hubspot_credentials when the vault is empty', async () => {
    vi.mocked(getCredentialsForSource).mockResolvedValue(undefined);
    const out = await call(toolsByName().get('hubspot_get_contact'), { identifier: 'mara@acme.com' });

    expect(out).toMatchObject({ ok: false, error: 'no_hubspot_credentials' });
  });

  it('maps a 403 to missing_scope naming the scope', async () => {
    stubHubspot({ errors: [{ context: { requiredGranularScopes: ['crm.objects.contacts.read'] } }] }, 403);
    const out = await call(toolsByName().get('hubspot_get_contact'), { identifier: 'mara@acme.com' });

    expect(out).toMatchObject({ ok: false, error: 'missing_scope', scope: 'crm.objects.contacts.read' });
  });
});

describe('hubspot_search_contacts', () => {
  it('returns candidates whose id round-trips into hubspot_get_contact', async () => {
    stubHubspot({ results: [MARA] });
    const tools = toolsByName();
    const search = await call(tools.get('hubspot_search_contacts'), { query: 'Mara' });

    expect(search).toMatchObject({ ok: true, count: 1, broadened: false });

    const id = search.contacts[0].id;
    const got = await call(tools.get('hubspot_get_contact'), { identifier: id });

    expect(got.contact.email).toBe('mara@acme.com');
  });

  it('broadens a multi-word miss once to the most distinctive token and says so', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? '');
      bodies.push(body);
      return res(200, body.includes('"query":"Okafor"') ? { results: [MARA] } : { results: [] });
    }));
    const out = await call(toolsByName().get('hubspot_search_contacts'), { query: 'Mara Q. Okafor-Smith' });

    expect(out).toMatchObject({ ok: true, broadened: true, count: 1 });
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toContain('"query":"Okafor"');
  });

  it('an empty result carries a retry_hint instead of silence', async () => {
    stubHubspot({ results: [] });
    const out = await call(toolsByName().get('hubspot_search_contacts'), { query: 'Zzz Qqq' });

    expect(out.count).toBe(0);
    expect(out.retry_hint).toContain('before concluding');
  });
});

describe('hubspot_contact_emails', () => {
  function stubEmailChain(emails: Array<{ id: string; properties: Record<string, string> }>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/associations/emails')) {
        return res(200, { results: emails.map(e => ({ toObjectId: e.id })) });
      }
      if (u.includes('/crm/v3/objects/emails/batch/read')) {
        return res(200, { results: emails });
      }
      if (u.includes('/crm/v3/objects/contacts/search')) {
        return res(200, { results: [{ id: '9412', properties: { email: 'mara@acme.com' } }] });
      }
      return res(500, { message: `unexpected ${u} ${String(init?.method)}` });
    }));
  }

  it('returns subject, snippet, direction, timestamp, newest first', async () => {
    stubEmailChain([
      { id: 'e1', properties: { hs_email_subject: 'Proposal', hs_email_text: 'Here is the proposal we discussed.', hs_email_direction: 'EMAIL', hs_timestamp: '2026-08-01T10:00:00Z' } },
      { id: 'e2', properties: { hs_email_subject: 'Re: Proposal', hs_email_html: '<p>Looks great, thanks!</p>', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: '2026-08-03T09:00:00Z' } },
      { id: 'e3', properties: { hs_email_subject: 'Automatic reply: Proposal', hs_email_text: 'I am out of the office.', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: '2026-08-02T09:00:00Z' } },
    ]);
    const out = await call(toolsByName().get('hubspot_contact_emails'), { identifier: 'mara@acme.com' });

    expect(out).toMatchObject({ ok: true, contact_id: '9412', total: 2 });
    // Newest first, the auto-reply dropped.
    expect(out.emails.map((e: { email_id: string }) => e.email_id)).toEqual(['e2', 'e1']);
    expect(out.emails[0]).toMatchObject({ subject: 'Re: Proposal', direction: 'in', snippet: 'Looks great, thanks!', timestamp: '2026-08-03T09:00:00Z' });
    expect(out.emails[1]).toMatchObject({ direction: 'out' });
  });

  it('without sales-email-read the batch read maps to missing_scope naming it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/associations/emails')) {
        return res(200, { results: [{ toObjectId: 'e1' }] });
      }
      if (u.includes('/batch/read')) {
        return res(403, { errors: [{ context: { requiredGranularScopes: ['sales-email-read'] } }] });
      }
      return res(200, { results: [{ id: '9412', properties: {} }] });
    }));
    const out = await call(toolsByName().get('hubspot_contact_emails'), { identifier: '9412' });

    expect(out).toMatchObject({ ok: false, error: 'missing_scope', scope: 'sales-email-read' });
  });

  it('an unknown identifier is a no_match, not an exception', async () => {
    stubHubspot({ results: [] });
    const out = await call(toolsByName().get('hubspot_contact_emails'), { identifier: 'ghost@nowhere.com' });

    expect(out).toMatchObject({ ok: true, reason: 'no_match' });
  });
});

describe('gating', () => {
  it('absent for an agent without a hubspot source', () => {
    const names = buildDomainTools(ctxFor(['gmail'])).map(t => t.name);

    expect(names).not.toContain('hubspot_get_contact');
    expect(names).not.toContain('hubspot_search_contacts');
    expect(names).not.toContain('hubspot_list_properties');
    expect(names).not.toContain('hubspot_list_lists');
  });

  it('absent when the per-user ACL excludes hubspot', () => {
    const names = buildDomainTools(ctxFor(['hubspot'], ['gmail'])).map(t => t.name);

    expect(names).not.toContain('hubspot_get_contact');
  });

  it('present, alongside the count tools, when hubspot is in scope', () => {
    const names = buildDomainTools(ctxFor(['hubspot'])).map(t => t.name);

    expect(names).toEqual(expect.arrayContaining([
      'hubspot_get_contact',
      'hubspot_search_contacts',
      'hubspot_list_properties',
      'hubspot_list_lists',
      'hubspot_count_contacts',
      'hubspot_count_deals',
      'hubspot_count_companies',
    ]));
  });
});
