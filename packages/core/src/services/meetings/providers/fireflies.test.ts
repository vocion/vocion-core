/**
 * The Fireflies meetings provider: each workspace's transcripts are read with
 * that workspace's own key, never another's; a list is newest first; a
 * transcript Fireflies does not have is null. Keys and meetings are invented.
 */
import type { FamilySource } from '@/libs/connectors/families';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/Logger', () => ({ logger: { warn: () => {}, info: () => {}, error: () => {} } }));
vi.mock('@/libs/connectors/vendorFetch', async importOriginal => ({ ...(await importOriginal<object>()), pace: async () => {} }));

const KEYS: Record<string, Record<string, string>> = {
  org_northwind: { token: 'ff_key_northwind' },
  org_contoso: { token: 'ff_key_contoso' },
};
vi.mock('@/services/SourceCredentialService', () => ({
  getCredentialsForConnector: async (input: { orgId: string }) => KEYS[input.orgId],
}));

const { firefliesMeetingProvider } = await import('./fireflies');

const SOURCE: FamilySource = { id: 4, slug: 'fireflies', kind: 'fireflies', config: {}, apiTokenId: null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('firefliesMeetingProvider', () => {
  it('reads each workspace with its own key, in turn', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization') ?? '');
      return json({ data: { transcripts: [] } });
    }));
    const window = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-08T00:00:00Z'), limit: 10 };
    await (await firefliesMeetingProvider('org_northwind', SOURCE)).findMeetings(window);
    await (await firefliesMeetingProvider('org_contoso', SOURCE)).findMeetings(window);

    expect(seen).toEqual(['Bearer ff_key_northwind', 'Bearer ff_key_contoso']);
  });

  it('lists newest first without the transcript text, and reads one whole', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { transcripts: [
      { id: 'a1', title: 'Older', date: Date.parse('2026-10-01T10:00:00Z'), sentences: [{ speaker_name: 'Dana', text: 'Hi' }] },
      { id: 'a2', title: 'Newer', date: Date.parse('2026-10-02T10:00:00Z') },
    ] } })));
    const provider = await firefliesMeetingProvider('org_northwind', SOURCE);
    const rows = await provider.findMeetings({ from: new Date('2026-09-01'), to: new Date('2026-10-08'), limit: 5 });

    expect(rows.map(r => r.id)).toEqual(['a2', 'a1']);
    expect(rows[1]).toMatchObject({ hasTranscript: true });
    expect(rows[1]).not.toHaveProperty('transcript');

    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { transcript: { id: 'a1', title: 'Northwind sync', sentences: [{ speaker_name: 'Dana', text: 'Hi' }] } } })));

    await expect(provider.readTranscript('a1')).resolves.toMatchObject({ id: 'a1', transcript: 'Dana: Hi' });

    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { transcript: null } })));

    await expect(provider.readTranscript('zz')).resolves.toBeNull();
    expect(provider.externalId('a1')).toBe('fireflies:a1');
  });

  it('says so when the source has no key', async () => {
    await expect(firefliesMeetingProvider('org_unknown', SOURCE)).rejects.toThrow(/fireflies: No Fireflies API key/);
  });
});
