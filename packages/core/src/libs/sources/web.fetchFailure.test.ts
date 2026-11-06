/**
 * A page the web connector could not fetch says why, on the error it reports:
 * a bot wall reads differently from a removed page. A discovery probe's miss
 * stays a quiet skip with the bare status, and its body is never read.
 */
import type { SourceContext, SourceProgressEvent } from './types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webConnector } from './web';

const PAGE_URL = 'https://bellwater.test/whats-on';
const LISTING_URL = 'https://bellwater.test/shows/';
const ICS_URL = 'https://bellwater.test/events.ics';

/**
 * Answer every fetch from one handler.
 * @param handler - the response for a URL, or undefined to fail the call.
 */
function stubFetch(handler: (url: string) => Response | undefined): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const res = handler(String(input));
    if (!res) {
      throw new Error(`unexpected fetch: ${String(input)}`);
    }
    return res;
  }));
}

/**
 * Run one sync to completion and keep its progress events.
 * @param config - the connector config under test.
 */
async function run(config: Record<string, unknown>): Promise<SourceProgressEvent[]> {
  const events: SourceProgressEvent[] = [];
  const ctx: SourceContext = { sourceId: 1, orgId: 'org_test', config, onProgress: e => events.push(e) };
  // Documents are not what this file is about; the sync only has to finish.
  await Array.fromAsync(webConnector.sync(ctx));
  return events;
}

/** A block page as an edge network serves it, cookie included. */
function blockPage(): Response {
  return new Response('<!doctype html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>', {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'server': 'edge-proxy',
      'cf-mitigated': 'challenge',
      'set-cookie': '__cf_bm=fictional-token; path=/; HttpOnly',
    },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('a page the connector could not fetch', () => {
  it('reports the status, the allowlisted headers and the title as one line, with the detail beside it', async () => {
    stubFetch(url => url === PAGE_URL ? blockPage() : undefined);

    const events = await run({ urls: [PAGE_URL] });

    expect(events.filter(e => e.kind === 'error')).toEqual([{
      kind: 'error',
      uri: PAGE_URL,
      message: 'HTTP 403 · server: edge-proxy · cf-mitigated: challenge · title: Just a moment...',
      detail: { status: 403, headers: { 'server': 'edge-proxy', 'cf-mitigated': 'challenge' }, title: 'Just a moment...' },
    }]);
    expect(JSON.stringify(events)).not.toContain('__cf_bm');
  });

  it('reports exactly `HTTP 500` when the answer carried nothing to add', async () => {
    stubFetch(url => url === PAGE_URL ? new Response(null, { status: 500 }) : undefined);

    const events = await run({ urls: [PAGE_URL] });

    expect(events.filter(e => e.kind === 'error')).toEqual([{ kind: 'error', uri: PAGE_URL, message: 'HTTP 500', detail: { status: 500, headers: {} } }]);
  });

  it('keeps a probe that misses a quiet skip, with the bare status and no body read', async () => {
    const probeBody = vi.fn();
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return new Response(
          '<html><head><title>Shows</title><link rel="alternate" type="text/calendar" href="/events.ics"></head><body><main><p>Our shows.</p></main></body></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      }
      if (url === ICS_URL) {
        return new Response(new ReadableStream({ pull: probeBody }, { highWaterMark: 0 }), { status: 403, headers: { 'content-type': 'text/html', 'server': 'edge-proxy' } });
      }
      return undefined;
    });

    const events = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });

    expect(events.filter(e => e.kind === 'error')).toEqual([]);
    expect(events.find(e => e.uri === ICS_URL)).toEqual({ kind: 'skipped', uri: ICS_URL, message: 'HTTP 403' });
    expect(probeBody).not.toHaveBeenCalled();
  });
});
