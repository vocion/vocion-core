import type { SourceContext } from '@/libs/sources/types';
/**
 * Gong connector against a mocked `fetch`: one document per call with its
 * parties, brief and transcript folded by speaker; private calls never read;
 * the incremental window looks back three days; a rate limit is waited out;
 * Test connection says which workspaces the key sees. Every call is invented.
 */
import type { IngestDoc } from '@/services/IngestionService';
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The meetings family module reads sources from the database; nothing here reaches it.
vi.mock('@/libs/DB', () => ({ db: {} }));
vi.mock('@/libs/connectors/vendorFetch', async importOriginal => ({ ...(await importOriginal<object>()), pace: async () => {} }));

const { gongConnector, inspectGong } = await import('./gong');

const CREDS = { accessKey: 'GK_FIXTURE_0001', accessKeySecret: 'gs_fixture_secret_0001' };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return { sourceId: 1, orgId: 'org_1', config: {}, credentials: CREDS, ...over };
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

const CALLS = {
  calls: [
    { id: '7782342274025937895', title: 'Northwind discovery', started: '2026-10-01T15:00:00Z', duration: 1800, url: 'https://app.gong.io/call?id=7782342274025937895' },
    { id: '7782342274025937000', title: 'Board prep', started: '2026-10-02T15:00:00Z', duration: 600, isPrivate: true },
  ],
  records: {},
};
const EXTENSIVE = {
  calls: [{
    metaData: { id: '7782342274025937895', title: 'Northwind discovery' },
    parties: [
      { speakerId: 's1', name: 'Dana Reyes', emailAddress: 'dana@kestrel.example' },
      { speakerId: 's2', name: 'Lee Park', emailAddress: 'lee@northwind.example' },
    ],
    content: { brief: 'Northwind wants a pilot in Q4.', keyPoints: [{ text: 'Budget approved' }] },
  }],
};
const TRANSCRIPTS = {
  callTranscripts: [{
    callId: '7782342274025937895',
    transcript: [
      { speakerId: 's1', sentences: [{ text: 'Thanks for joining.' }, { text: 'Shall we start?' }] },
      { speakerId: 's2', sentences: [{ text: 'Yes, let us.' }] },
    ],
  }],
};

function gongApi(fetchCalls: string[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/v2/calls/extensive')) {
      return json(EXTENSIVE);
    }
    if (url.includes('/v2/calls/transcript')) {
      return json(TRANSCRIPTS);
    }
    if (url.includes('/v2/calls')) {
      return json(CALLS);
    }
    return json({}, 404);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('gongConnector', () => {
  it('yields one document per call, transcript folded by speaker, private calls never read', async () => {
    const calls: string[] = [];
    const api = gongApi(calls);
    vi.stubGlobal('fetch', api);
    const docs = await collect(gongConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('gong:7782342274025937895');
    expect(docs[0]!.content).toContain('Dana Reyes: Thanks for joining. Shall we start?\nLee Park: Yes, let us.');
    expect(docs[0]!.content).toContain('Northwind wants a pilot in Q4.');
    expect(docs[0]!.metadata).toMatchObject({ kind: 'gong-call', hasTranscript: true, durationMinutes: 30, participants: ['dana@kestrel.example', 'lee@northwind.example'] });

    const transcriptBody = JSON.parse(String((api.mock.calls.find(c => String(c[0]).includes('/transcript')) as unknown as [string, RequestInit])[1].body));

    expect(transcriptBody.filter.callIds).toEqual(['7782342274025937895']);

    const auth = new Headers((api.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('authorization');

    expect(auth).toBe(`Basic ${Buffer.from('GK_FIXTURE_0001:gs_fixture_secret_0001').toString('base64')}`);
  });

  it('reads from three days before the watermark when incremental', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', gongApi(calls));
    await collect(gongConnector.sync(ctx({ since: new Date('2026-10-05T00:00:00.000Z') })));
    const list = new URL(calls[0]!.split(' ')[1]!);

    expect(list.searchParams.get('fromDateTime')).toBe('2026-10-02T00:00:00.000Z');
  });

  it('waits out a rate limit and carries on', async () => {
    const calls: string[] = [];
    const real = gongApi(calls);
    let limited = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (!limited) {
        limited = true;
        return json({ errors: ['Too many requests'] }, 429, { 'retry-after': '0' });
      }
      return real(url, init);
    }));
    const docs = await collect(gongConnector.sync(ctx()));

    expect(docs).toHaveLength(1);
  });

  it('refuses to run without a key, and throws the vendor\'s refusal on a failed list', async () => {
    await expect(collect(gongConnector.sync(ctx({ credentials: {} })))).rejects.toThrow(/access key and secret/);

    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: ['bad key'] }, 401)));

    await expect(collect(gongConnector.sync(ctx()))).rejects.toThrow(/Gong refused the credential/);
  });

  it('reports a batch whose transcripts fail and yields nothing bare for it', async () => {
    const errors: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/transcript') ? json({}, 500) : url.includes('/extensive') ? json(EXTENSIVE) : json(CALLS))));
    const docs = await collect(gongConnector.sync(ctx({ onProgress: e => e.kind === 'error' && errors.push(e.message ?? '') })));

    expect(docs).toHaveLength(0);
    expect(errors[0]).toMatch(/HTTP 500/);
  });
});

describe('inspectGong', () => {
  it('names the workspaces the key sees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ workspaces: [{ id: '1', name: 'Kestrel Capital' }] })));
    const out = await inspectGong(CREDS);

    expect(out).toMatchObject({ authorized: true, error: null });
    expect(out.checks[0]!.detail).toContain('Kestrel Capital');
  });

  it('says the key was refused, and refuses a missing key as input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ errors: ['unauthorized'] }, 401)));
    const out = await inspectGong(CREDS);

    expect(out.authorized).toBe(false);
    expect(out.error).toMatch(/Ecosystem → API/);
    await expect(inspectGong({})).rejects.toThrow(/access key and secret/);
    await expect(inspectGong({ ...CREDS, baseUrl: 'http://api.gong.io' })).rejects.toThrow(/https/);
  });
});
