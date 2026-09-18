import type { SourceContext } from '@/libs/sources/types';
/**
 * HubSpot connector against a mocked `fetch` — verifies it yields IngestDocs,
 * paginates the `after` cursor, switches to the Search API for incremental
 * (`since`), and refuses to run without a token.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubspotConnector } from '@/libs/sources/hubspot';

function res(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => '' } as unknown as Response;
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    sourceId: 1,
    orgId: 'org_1',
    config: { objectType: 'contacts' },
    credentials: { token: 'pat-123' },
    ...over,
  };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('hubspotConnector', () => {
  it('yields one IngestDoc per record with identity-only content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({
      results: [
        { id: '1', properties: { firstname: 'Mara', lastname: 'Okafor', email: 'mara@acme.com', jobtitle: 'VP of Engineering', company: 'Acme' }, updatedAt: '2026-06-01T00:00:00Z' },
      ],
    })));
    const docs = await collect(hubspotConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('contacts:1');
    expect(docs[0]!.title).toBe('Mara Okafor');
    expect(docs[0]!.content).toBe('Mara Okafor\nVP of Engineering at Acme\nmara@acme.com');
  });

  it('always fetches the handoff signal properties for contacts and mirrors them as metadata, from whatever properties the config names', async () => {
    const fetchMock = vi.fn(async () => res({
      results: [{ id: '7', properties: { email: 'lead@acme.com', hs_sales_email_last_replied: '2026-09-09T15:30:00.000Z', meeting_booked__calendly_: 'true' } }],
    }));
    vi.stubGlobal('fetch', fetchMock);

    // A workspace that pins its property list, and names a Calendly flag as the meeting signal.
    const docs = await collect(hubspotConnector.sync(ctx({
      config: { objectType: 'contacts', properties: ['email'], handoffSignals: { meetingProperty: 'meeting_booked__calendly_' } },
    })));

    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);

    expect(decodeURIComponent(url)).toContain('properties=email,hs_sales_email_last_replied,meeting_booked__calendly_');
    expect(docs[0]!.metadata).toMatchObject({ handoffReplyAt: '2026-09-09T15:30:00.000Z', handoffMeeting: 'true' });
  });

  it('defaults the meeting signal to HubSpot\'s own meeting timestamp, and leaves deals alone', async () => {
    const fetchMock = vi.fn(async () => res({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await collect(hubspotConnector.sync(ctx()));
    await collect(hubspotConnector.sync(ctx({ config: { objectType: 'deals' } })));

    const [contactsUrl, dealsUrl] = fetchMock.mock.calls.map(c => decodeURIComponent(String((c as unknown[])[0])));

    expect(contactsUrl).toContain('hs_sales_email_last_replied,hs_latest_meeting_activity');
    expect(dealsUrl).not.toContain('hs_sales_email_last_replied');
  });

  it('keeps content stable when volatile properties change (they are metadata-only)', async () => {
    const props = { firstname: 'Mara', lastname: 'Okafor', email: 'mara@acme.com', lifecyclestage: 'lead', hs_email_open: '2', hs_lastmodifieddate: '2026-06-01T00:00:00Z', hubspot_owner_id: '77' };
    vi.stubGlobal('fetch', vi.fn(async () => res({ results: [{ id: '1', properties: props }] })));
    const [before] = await collect(hubspotConnector.sync(ctx()));

    // An email open + a record touch: counters and dates move, identity doesn't.
    const touched = { ...props, hs_email_open: '3', hs_lastmodifieddate: '2026-06-02T09:00:00Z', lifecyclestage: 'marketingqualifiedlead' };
    vi.stubGlobal('fetch', vi.fn(async () => res({ results: [{ id: '1', properties: touched }] })));
    const [after] = await collect(hubspotConnector.sync(ctx()));

    expect(after!.content).toBe(before!.content);
    expect(after!.metadata!.emailOpened).toBe(3);
    expect(after!.metadata!.lifecycleStage).toBe('marketingqualifiedlead');
  });

  it('embeds company identity (name, domain, industry, description) and keeps size in metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({
      results: [{ id: '9', properties: { name: 'SunFleet', domain: 'sunfleet.example', industry: 'COMPUTER_SOFTWARE', description: 'Fleet-maintenance software.', numberofemployees: '120' } }],
    })));
    const docs = await collect(hubspotConnector.sync(ctx({ config: { objectType: 'companies' } })));

    expect(docs[0]!.content).toBe('SunFleet\nsunfleet.example\nCOMPUTER_SOFTWARE\nFleet-maintenance software.');
    expect(docs[0]!.content).not.toContain('120');
    expect(docs[0]!.metadata!.employees).toBe(120);
  });

  it('follows the after cursor across pages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ results: [{ id: '1', properties: { email: 'a@x.com' } }], paging: { next: { after: 'p2' } } }))
      .mockResolvedValueOnce(res({ results: [{ id: '2', properties: { email: 'b@x.com' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const docs = await collect(hubspotConnector.sync(ctx()));

    expect(docs.map(d => d.externalId)).toEqual(['contacts:1', 'contacts:2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the Search API filtered on the object type\'s OWN last-modified property when incremental', async () => {
    const fetchMock = vi.fn(async () => res({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const since = new Date('2026-06-01T00:00:00.000Z');
    await collect(hubspotConnector.sync(ctx({ since })));
    await collect(hubspotConnector.sync(ctx({ since, config: { objectType: 'deals' } })));
    const [contactsUrl, contactsInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // Deals fetch their pipeline definitions first — find the search call by URL.
    const [, dealsInit] = fetchMock.mock.calls.find(c => String((c as unknown[])[0]).includes('/deals/search')) as unknown as [string, RequestInit];

    expect(String(contactsUrl)).toContain('/crm/v3/objects/contacts/search');
    expect(contactsInit.method).toBe('POST');
    expect(String(contactsInit.body)).toContain(String(since.getTime()));
    // Contacts do NOT carry hs_lastmodifieddate — filtering on it matches zero
    // rows forever, which froze the prod mirror for four days (2026-09-14).
    expect(String(contactsInit.body)).toContain('"propertyName":"lastmodifieddate"');
    expect(String(contactsInit.body)).not.toContain('hs_lastmodifieddate');
    expect(String(dealsInit.body)).toContain('"propertyName":"hs_lastmodifieddate"');
  });

  it('reads the modified date from whichever spelling the object type carries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({
      results: [{ id: '1', properties: { email: 'a@x.com', lastmodifieddate: '2026-09-01T00:00:00Z' } }],
    })));
    const [doc] = await collect(hubspotConnector.sync(ctx()));

    expect(doc!.lastModifiedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('refuses to run without a token', async () => {
    await expect(collect(hubspotConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/token/i);
  });
});
