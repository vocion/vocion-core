/**
 * `urlsFrom`: the web connector reading its URL list from somewhere else.
 *
 * The rules under test are the ones with teeth. A 200 carrying a valid EMPTY
 * array is a registry saying "nothing today" — a no-op, one `skipped` event,
 * no failure. Everything else that goes wrong is ONE connector-scope error,
 * because the runner reads a connector error as "a slice we could not fetch"
 * and therefore holds the watermark and suppresses tombstoning: a registry
 * that is down for an hour must never be able to delete a source. And every
 * entry is checked against `^https?:` on top of zod, because zod 4's `.url()`
 * waves `file://` and `javascript:` straight through.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webConnector } from './web';

type Progress = { kind: string; uri?: string; message?: string };

const REGISTRY = 'https://registry.test/sources';
const PAGE_HTML = '<!doctype html><html><head><title>A page</title></head><body><main><p>Body text.</p></main></body></html>';

/**
 * Answer every fetch from one handler, and remember the calls.
 * @param handler - returns the response for a URL, or undefined to fail the call.
 */
function stubFetch(handler: (url: string) => Response | undefined): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = handler(url);
    if (!res) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return res;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** A plain HTML page, whatever the URL. */
function htmlPage(): Response {
  return new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/**
 * Run one sync to completion.
 * @param config - the connector config under test.
 */
async function run(config: Record<string, unknown>): Promise<{ docs: IngestDoc[]; events: Progress[] }> {
  const events: Progress[] = [];
  const ctx: SourceContext = {
    sourceId: 1,
    orgId: 'org_test',
    config,
    onProgress: (e) => {
      events.push(e);
    },
  };
  const docs: IngestDoc[] = [];
  for await (const doc of webConnector.sync(ctx)) {
    docs.push(doc);
  }
  return { docs, events };
}

/**
 * The connector-scope errors a run reported.
 * @param events - every progress event from the run.
 */
function errors(events: Progress[]): Progress[] {
  return events.filter(e => e.kind === 'error');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('urlsFrom, the shapes a registry can answer with', () => {
  it('reads a bare array of URL strings', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json(['https://a.test/one', 'https://a.test/two'])
      : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one', 'https://a.test/two']);
    expect(errors(events)).toEqual([]);
  });

  it('reads a top-level `urls` array', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json({ urls: ['https://a.test/one'] })
      : htmlPage());

    const { docs } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one']);
  });

  it('reads objects at a dotted `arrayPath`, keyed by `urlKey`', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json({ data: { items: [{ href: 'https://a.test/one' }, { href: 'https://a.test/two' }] } })
      : htmlPage());

    const { docs } = await run({ urlsFrom: { url: REGISTRY, arrayPath: 'data.items', urlKey: 'href' } });

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one', 'https://a.test/two']);
  });
});

describe('urlsFrom, the protocol gate', () => {
  it('keeps http and https, rewrites webcal, and drops every other scheme', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json([
          'https://a.test/keep',
          'http://a.test/keep-too',
          'webcal://a.test/cal.ics',
          'file:///etc/passwd',
          'javascript:alert(1)',
          'data:text/html,<p>x',
          'not a url at all',
          42,
        ])
      : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs.map(d => d.externalId)).toEqual([
      'https://a.test/keep',
      'http://a.test/keep-too',
      'https://a.test/cal.ics',
    ]);
    expect(errors(events)).toEqual([]);
    expect(events.some(e => e.kind === 'skipped' && e.message?.includes('5 unusable'))).toBe(true);
  });
});

describe('urlsFrom, dedupe and cap', () => {
  it('drops repeats, caps at `maxUrls`, and says so once', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json([
          'https://a.test/one',
          'https://a.test/one',
          'https://a.test/two',
          'https://a.test/three',
        ])
      : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY, maxUrls: 2 } });
    const notes = events.filter(e => e.kind === 'skipped' && e.uri === REGISTRY);

    expect(docs.map(d => d.externalId)).toEqual(['https://a.test/one', 'https://a.test/two']);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe('URL list: 2 of 4 (1 duplicate, capped at 2)');
  });
});

describe('urlsFrom, a 200 with an empty array', () => {
  it('is a no-op: one skipped event, no error, nothing ingested', async () => {
    const fetchFn = stubFetch(url => url === REGISTRY ? Response.json([]) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([]);
    expect(events).toEqual([{ kind: 'skipped', uri: REGISTRY, message: 'the URL list is empty' }]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('is still a no-op when the empty array sits at `arrayPath`', async () => {
    stubFetch(url => url === REGISTRY ? Response.json({ data: [] }) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY, arrayPath: 'data' } });

    expect(docs).toEqual([]);
    expect(errors(events)).toEqual([]);
  });
});

describe('urlsFrom, failure is one connector-scope error', () => {
  it('reports a fetch that throws', async () => {
    stubFetch(() => undefined);

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toContain('could not be read');
  });

  it('reports a non-2xx', async () => {
    stubFetch(url => url === REGISTRY ? new Response('nope', { status: 503 }) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list answered HTTP 503');
  });

  it('reports a body that is not JSON', async () => {
    stubFetch(url => url === REGISTRY ? htmlPage() : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list is not JSON');
  });

  it('reports a body with no array in it', async () => {
    stubFetch(url => url === REGISTRY ? Response.json({ total: 0 }) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY, arrayPath: 'data.items' } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list holds no array at `data.items`');
  });

  it('reports a non-empty body whose entries are all unusable', async () => {
    stubFetch(url => url === REGISTRY ? Response.json(['file:///etc/passwd', { nope: 1 }]) : htmlPage());

    const { docs, events } = await run({ urlsFrom: { url: REGISTRY } });

    expect(docs).toEqual([]);
    expect(errors(events)).toHaveLength(1);
    expect(errors(events)[0]?.message).toBe('the URL list holds 2 entries and no usable URL');
  });
});

describe('urlsFrom alongside `urls`', () => {
  it('fetches both lists, deduplicated', async () => {
    stubFetch(url => url === REGISTRY
      ? Response.json(['https://a.test/one', 'https://a.test/three'])
      : htmlPage());

    const { docs } = await run({
      urls: ['https://a.test/one', 'https://a.test/two'],
      urlsFrom: { url: REGISTRY },
    });

    expect(docs.map(d => d.externalId)).toEqual([
      'https://a.test/one',
      'https://a.test/two',
      'https://a.test/three',
    ]);
  });
});
