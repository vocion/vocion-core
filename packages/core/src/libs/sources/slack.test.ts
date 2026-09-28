/**
 * Slack connector against a mocked `fetch`.
 *
 * The case that matters is the one added for the Executive workspace: with no
 * `channel` in the config, the connector sweeps every channel the bot belongs
 * to. Membership is the filter, because `conversations.history` refuses
 * anything the bot was never invited to — listing the rest would only
 * manufacture errors.
 */
import type { SourceContext } from '@/libs/sources/types';
import type { IngestDoc } from '@/services/IngestionService';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { slackConnector } from '@/libs/sources/slack';

function res(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function ctx(over: Partial<SourceContext> = {}): SourceContext {
  return {
    config: {},
    credentials: { token: 'xoxb-test' },
    ...over,
  } as unknown as SourceContext;
}

async function collect(it: AsyncIterable<IngestDoc>): Promise<IngestDoc[]> {
  const out: IngestDoc[] = [];
  for await (const d of it) {
    out.push(d);
  }
  return out;
}

/**
 * The URLs the connector asked for, in order.
 * @param fetchMock - The stubbed global fetch.
 */
function calls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(c => String(c[0]));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('slack connector — one named channel', () => {
  it('reads that channel and never lists the workspace', async () => {
    const fetchMock = vi.fn(async () => res({ ok: true, messages: [{ ts: '1700000000.0001', text: 'hello', user: 'U1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(slackConnector.sync(ctx({ config: { channel: 'C_REVENUE' } })));

    expect(docs).toHaveLength(1);
    expect(docs[0]!.externalId).toBe('slack:C_REVENUE:1700000000.0001');
    expect(calls(fetchMock).some(u => u.includes('conversations.list'))).toBe(false);
  });
});

describe('slack connector — every channel the bot is in', () => {
  it('lists channels, skips the ones it is not a member of, and reads the rest', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('conversations.list')) {
        return res({
          ok: true,
          channels: [
            { id: 'C_ONE', name: 'general', is_member: true },
            { id: 'C_TWO', name: 'random', is_member: false },
            { id: 'C_THREE', name: 'eng', is_member: true },
          ],
        });
      }
      const channel = new URL(String(url)).searchParams.get('channel');
      return res({ ok: true, messages: [{ ts: '1700000000.0001', text: `from ${channel}`, user: 'U1' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(slackConnector.sync(ctx({ config: {} })));

    expect(docs.map(d => d.externalId)).toEqual([
      'slack:C_ONE:1700000000.0001',
      'slack:C_THREE:1700000000.0001',
    ]);
    // The one it is not in was never asked for: history would answer
    // `not_in_channel` and fail the whole sync.
    expect(calls(fetchMock).some(u => u.includes('channel=C_TWO'))).toBe(false);
  });

  it('titles a message with its channel, so a hit says where it came from', async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('conversations.list')
      ? res({ ok: true, channels: [{ id: 'C_ONE', name: 'general', is_member: true }] })
      : res({ ok: true, messages: [{ ts: '1700000000.0001', text: 'hi' }] })));
    vi.stubGlobal('fetch', fetchMock);

    const docs = await collect(slackConnector.sync(ctx({ config: {} })));

    expect(docs[0]!.title).toBe('#general · 1700000000.0001');
    expect(docs[0]!.metadata).toMatchObject({ channel: 'C_ONE', channelName: 'general' });
  });

  it('asks only for public channels unless told otherwise', async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('conversations.list')
      ? res({ ok: true, channels: [] })
      : res({ ok: true, messages: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await collect(slackConnector.sync(ctx({ config: {} })));

    expect(calls(fetchMock)[0]).toContain('types=public_channel');
    expect(calls(fetchMock)[0]).not.toContain('private_channel');

    fetchMock.mockClear();
    await collect(slackConnector.sync(ctx({ config: { includePrivate: true } })));

    expect(calls(fetchMock)[0]).toContain('private_channel');
  });

  it('pages the channel list rather than stopping at the first 200', async () => {
    let listed = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('conversations.list')) {
        listed += 1;
        return listed === 1
          ? res({ ok: true, channels: [{ id: 'C_ONE', is_member: true }], response_metadata: { next_cursor: 'page2' } })
          : res({ ok: true, channels: [{ id: 'C_TWO', is_member: true }] });
      }
      return res({ ok: true, messages: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    await collect(slackConnector.sync(ctx({ config: {} })));

    expect(listed).toBe(2);
    expect(calls(fetchMock).some(u => u.includes('channel=C_TWO'))).toBe(true);
  });

  it('carries the incremental watermark into every channel', async () => {
    const since = new Date('2026-09-01T00:00:00Z');
    const fetchMock = vi.fn(async (url: string) => (String(url).includes('conversations.list')
      ? res({ ok: true, channels: [{ id: 'C_ONE', is_member: true }, { id: 'C_TWO', is_member: true }] })
      : res({ ok: true, messages: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await collect(slackConnector.sync(ctx({ config: {}, since })));

    const oldest = String(Math.floor(since.getTime() / 1000));
    const history = calls(fetchMock).filter(u => u.includes('conversations.history'));

    expect(history).toHaveLength(2);
    expect(history.every(u => u.includes(`oldest=${oldest}`))).toBe(true);
  });

  it('still refuses to run without a token', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(collect(slackConnector.sync(ctx({ config: {}, credentials: {} }))))
      .rejects
      .toThrow(/requires credentials.token/);
  });

  it('surfaces a Slack API error rather than yielding nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ ok: false, error: 'invalid_auth' })));

    await expect(collect(slackConnector.sync(ctx({ config: {} }))))
      .rejects
      .toThrow(/invalid_auth/);
  });
});
