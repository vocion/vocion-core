import type { SourceContext } from '@/libs/sources/types';
/**
 * Fireflies connector against a mocked GraphQL endpoint: one document per
 * meeting with its summary and the transcript folded by speaker, sentences
 * asked for in the list query itself (the free plan allows 50 requests a
 * day), the incremental window looking back three days, a GraphQL auth error
 * read as a refused key, and a rate limit waited out. Every meeting is invented.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The meetings family module reads sources from the database; nothing here reaches it.
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/connectors/vendorFetch', async importOriginal => ({ ...(await importOriginal<object>()), pace: async () => {} }));

const { firefliesConnector, inspectFireflies } = await import('./fireflies');

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return { sourceId: 1, orgId: 'org_1', config: {}, credentials: { token: 'ff_fixture_key_0001' }, ...over };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

const TRANSCRIPT = {
  id: '01JFIXTUREMEETING0001',
  title: 'Contoso renewal',
  date: Date.parse('2026-10-03T16:00:00Z'),
  duration: 25,
  organizer_email: 'dana@kestrel.example',
  participants: ['dana@kestrel.example', 'sam@contoso.example'],
  transcript_url: 'https://app.fireflies.ai/view/01JFIXTUREMEETING0001',
  sentences: [
    { speaker_name: 'Dana', text: 'How is the rollout going?' },
    { speaker_name: 'Sam', text: 'Well.' },
    { speaker_name: 'Sam', text: 'We want two more seats.' },
  ],
  summary: { overview: 'Contoso will renew with two more seats.', action_items: 'Send the order form' },
};

afterEach(() => vi.unstubAllGlobals());

describe('firefliesConnector', () => {
  it('yields one document per meeting, sentences fetched in the list query', async () => {
    const api = vi.fn(async () => json({ data: { transcripts: [TRANSCRIPT] } }));
    vi.stubGlobal('fetch', api);
    const docs = await collect(firefliesConnector.sync(ctx()));

    expect(api).toHaveBeenCalledTimes(1);

    const [url, init] = api.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe('https://api.fireflies.ai/graphql');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ff_fixture_key_0001');
    expect(body.query).toContain('sentences');
    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('fireflies:01JFIXTUREMEETING0001');
    expect(docs[0]!.content).toContain('Dana: How is the rollout going?\nSam: Well. We want two more seats.');
    expect(docs[0]!.content).toContain('Contoso will renew with two more seats.');
    expect(docs[0]!.metadata).toMatchObject({ kind: 'fireflies-transcript', started: '2026-10-03T16:00:00.000Z', hasTranscript: true, participants: ['dana@kestrel.example', 'sam@contoso.example'] });
  });

  it('pages with skip until a short page, and reads from three days before the watermark when incremental', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ ...TRANSCRIPT, id: `01JFIXTURE${String(i).padStart(4, '0')}` }));
    const api = vi.fn()
      .mockResolvedValueOnce(json({ data: { transcripts: full } }))
      .mockResolvedValueOnce(json({ data: { transcripts: [TRANSCRIPT] } }));
    vi.stubGlobal('fetch', api);
    const docs = await collect(firefliesConnector.sync(ctx({ since: new Date('2026-10-05T00:00:00.000Z') })));

    const vars = api.mock.calls.map(c => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)).variables);

    expect(docs).toHaveLength(51);
    expect(vars.map(v => v.skip)).toEqual([0, 50]);
    expect(vars[0].fromDate).toBe('2026-10-02T00:00:00.000Z');
  });

  it('reads a GraphQL auth error as a refused key, and refuses to run without one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Invalid API key', extensions: { code: 'auth_failed' } }] })));

    await expect(collect(firefliesConnector.sync(ctx()))).rejects.toThrow(/Fireflies refused the API key/);
    await expect(collect(firefliesConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/No Fireflies API key/);
  });

  it('waits out an HTTP rate limit and carries on', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ message: 'slow down' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(json({ data: { transcripts: [TRANSCRIPT] } })));

    await expect(collect(firefliesConnector.sync(ctx()))).resolves.toHaveLength(1);
  });

  it('says a GraphQL rate limit is one, naming the daily plan limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: [{ message: 'Too many requests', extensions: { code: 'too_many_requests' } }] })));

    await expect(collect(firefliesConnector.sync(ctx()))).rejects.toThrow(/50 requests a day/);
  });
});

describe('inspectFireflies', () => {
  it('names whose key it is', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: { user: { user_id: 'u1', name: 'Dana Reyes', email: 'dana@kestrel.example' } } })));
    const out = await inspectFireflies({ token: 'ff_fixture_key_0001' });

    expect(out).toMatchObject({ authorized: true, error: null });
    expect(out.checks[0]!.detail).toBe('The key belongs to Dana Reyes (dana@kestrel.example).');
  });

  it('says the key was refused, and refuses a missing key as input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'unauthorized' }, 401)));
    const out = await inspectFireflies({ token: 'ff_fixture_key_0001' });

    expect(out.authorized).toBe(false);
    expect(out.error).toMatch(/Developer settings/);
    await expect(inspectFireflies({})).rejects.toThrow(/No Fireflies API key/);
  });
});
