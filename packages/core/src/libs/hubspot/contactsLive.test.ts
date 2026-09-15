/**
 * Live intake reads against a scripted client: identities map into the
 * mirror's record shape, and the arrivals search filters on the contact
 * spelling of the date properties.
 */
import type { HubspotClient, HubspotResult } from './client';
import { describe, expect, it, vi } from 'vitest';
import { readContactsLive, searchContactArrivalsLive } from './contactsLive';

const ok = <T>(data: T): HubspotResult<T> => ({ ok: true, data });

function clientWith(post: (path: string, body: unknown) => HubspotResult<unknown>): { client: HubspotClient; posts: Array<{ path: string; body: unknown }> } {
  const posts: Array<{ path: string; body: unknown }> = [];
  return {
    posts,
    client: {
      baseUrl: 'https://api.hubapi.com',
      get: vi.fn(),
      patch: vi.fn(),
      fetchDealStages: vi.fn(),
      post: (async (path: string, body: unknown) => {
        posts.push({ path, body });
        return post(path, body) as never;
      }) as HubspotClient['post'],
    },
  };
}

describe('readContactsLive', () => {
  it('maps live properties onto the mirror record shape, ref included', async () => {
    const { client } = clientWith(() => ok({
      results: [{
        id: '213673813772',
        properties: {
          firstname: 'James',
          lastname: 'Schiesel',
          email: 'jamie@notboredindc.com',
          company: 'Not Bored in DC',
          lifecyclestage: 'marketingqualifiedlead',
          createdate: '2026-09-14T16:24:50.422Z',
          hs_email_delivered: '3',
          hs_v2_date_entered_marketingqualifiedlead: '2026-09-14T16:25:00.000Z',
        },
      }],
    }));
    const result = await readContactsLive(client, ['213673813772']);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0]).toMatchObject({
      ref: 'contacts:213673813772',
      name: 'James Schiesel',
      primaryEmail: 'jamie@notboredindc.com',
      company: 'Not Bored in DC',
      lifecycleStage: 'marketingqualifiedlead',
      createdAt: '2026-09-14T16:24:50.422Z',
      emailDelivered: 3,
      mqlEnteredAt: '2026-09-14T16:25:00.000Z',
    });
  });
});

describe('searchContactArrivalsLive', () => {
  it('searches on lifecyclestage + createdate (the contact spellings) and paginates', async () => {
    const { client, posts } = clientWith((_path, body) => {
      const after = (body as { after?: string }).after;
      return after
        ? ok({ results: [{ id: '2', properties: { email: 'b@x.com' } }] })
        : ok({ results: [{ id: '1', properties: { email: 'a@x.com' } }], paging: { next: { after: 'p2' } } });
    });
    const result = await searchContactArrivalsLive(client, {
      lifecycleStages: ['marketingqualifiedlead'],
      createdAfterMs: 1_757_000_000_000,
    });

    expect(result.ok && result.data.records.map(r => r.ref)).toEqual(['contacts:1', 'contacts:2']);

    const body = posts[0]!.body as { filterGroups: Array<{ filters: Array<{ propertyName: string; operator: string }> }> };

    expect(body.filterGroups[0]!.filters).toEqual([
      { propertyName: 'lifecyclestage', operator: 'IN', values: ['marketingqualifiedlead'] },
      { propertyName: 'createdate', operator: 'GTE', value: '1757000000000' },
    ]);
  });
});
