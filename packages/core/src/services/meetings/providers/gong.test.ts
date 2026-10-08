/**
 * The Gong meetings provider: each workspace's calls are read with that
 * workspace's own key, never another's; a list is newest first; a call read
 * whole carries its parties and transcript; an id Gong does not know is null.
 * Sources, keys and calls are invented.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));
vi.mock('@/libs/connectors/vendorFetch', async importOriginal => ({ ...(await importOriginal<object>()), pace: async () => {} }));

const KEYS: Record<string, Record<string, string>> = {
  org_northwind: { accessKey: 'GK_NORTHWIND', accessKeySecret: 'secret_northwind' },
  org_contoso: { accessKey: 'GK_CONTOSO', accessKeySecret: 'secret_contoso' },
};
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string }) => KEYS[input.orgId],
}));

const { gongMeetingProvider } = await import('./gong');

const SOURCE: FamilySource = { id: 3, slug: 'gong', kind: 'gong', config: {}, apiTokenId: null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function basic(key: string, secret: string): string {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

afterEach(() => vi.unstubAllGlobals());

describe('gongMeetingProvider', () => {
  it('reads each workspace with its own key, in turn', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return json({ calls: [], records: {} });
    }));
    const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z'), limit: 10 };
    await (await gongMeetingProvider('org_northwind', SOURCE)).findMeetings(window);
    await (await gongMeetingProvider('org_contoso', SOURCE)).findMeetings(window);

    expect(seen).toEqual([basic('GK_NORTHWIND', 'secret_northwind'), basic('GK_CONTOSO', 'secret_contoso')]);
  });

  it('lists calls newest first, capped at the limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ calls: [
      { id: '1001', title: 'Older', started: '2026-10-01T10:00:00Z' },
      { id: '1002', title: 'Newer', started: '2026-10-02T10:00:00Z', duration: 900 },
      { id: '1003', title: 'Oldest', started: '2026-09-30T10:00:00Z' },
    ] })));
    const provider = await gongMeetingProvider('org_northwind', SOURCE);
    const rows = await provider.findMeetings({ from: new Date('2026-09-01'), to: new Date('2026-10-08'), limit: 2 });

    expect(rows.map(r => r.id)).toEqual(['1002', '1001']);
    expect(rows[0]).toMatchObject({ durationMinutes: 15, title: 'Newer' });
    expect(provider.externalId('1002')).toBe('gong:1002');
  });

  it('reads one call whole, and answers null for an id Gong does not know', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/extensive')) {
        return json({ calls: [{ metaData: { id: '1002', title: 'Acme pilot review', started: '2026-10-02T10:00:00Z' }, parties: [{ speakerId: 'a', name: 'Lee Park' }] }] });
      }
      return json({ callTranscripts: [{ callId: '1002', transcript: [{ speakerId: 'a', sentences: [{ text: 'Pilot went well.' }] }] }] });
    }));
    const provider = await gongMeetingProvider('org_northwind', SOURCE);
    const read = await provider.readTranscript('1002');

    expect(read).toMatchObject({ id: '1002', title: 'Acme pilot review', transcript: 'Lee Park: Pilot went well.', hasTranscript: true });

    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: ['No calls found'] }, 404)));

    await expect(provider.readTranscript('1999')).resolves.toBeNull();
    await expect(provider.readTranscript('not-an-id')).rejects.toThrow(/not a Gong call id/);
  });

  it('says so when the source has no key', async () => {
    await expect(gongMeetingProvider('org_unknown', SOURCE)).rejects.toThrow(/gong: No Gong access key/);
  });
});
