/**
 * How trace pruning behaves — the job that enforces
 * `LANGFUSE_RETENTION_DAYS`.
 *
 * This deletes data, so the cases that matter most are the ones where
 * it must do nothing: tracing off, no retention period set, no expired
 * traces. After that, the paging behaviour, because the obvious
 * implementation is wrong: deleting page 1 shifts everything down, so
 * asking for page 2 next would skip traces. The service re-requests
 * page 1 every time, and these tests pin that.
 *
 * `fetch` is mocked. Nothing here talks to a Langfuse instance.
 */
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LANGFUSE_VARIABLES = [
  'LANGFUSE_ENABLED',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_PROJECT_ID',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_RETENTION_DAYS',
  'NODE_ENV',
] as const;

/** A fixed "now", so cutoff assertions are exact. */
const NOW = new Date('2026-09-03T12:00:00.000Z');

type FetchCall = { url: string; method: string; body: unknown };

let calls: FetchCall[] = [];

/**
 * Stand in for the Langfuse public API.
 * @param pages - Successive responses to the trace-list endpoint, each an
 * array of trace ids. Runs out to an empty page, which is how the
 * service learns it is done.
 */
function mockLangfuseApi(pages: string[][]): void {
  let listCallCount = 0;

  vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : input;
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });

    if (method === 'DELETE') {
      return new Response(JSON.stringify({ message: 'ok' }), { status: 200 });
    }

    const page = pages[listCallCount] ?? [];
    listCallCount += 1;
    return new Response(
      JSON.stringify({ data: page.map(id => ({ id })), meta: { totalPages: pages.length } }),
      { status: 200 },
    );
  }));
}

/**
 * Set one environment variable for the duration of a test.
 * @param name - Variable to set.
 * @param value - Value to set it to.
 */
function setEnv(name: string, value: string): void {
  vi.stubEnv(name, value);
}

/**
 * Tracing on, pointed at a fake self-hosted instance, keeping 30 days.
 * @param days - Retention period to configure.
 */
function configureRetention(days = 30): void {
  setEnv('NODE_ENV', 'production');
  setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
  setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');
  setEnv('LANGFUSE_BASE_URL', 'https://traces.example.com');
  setEnv('LANGFUSE_RETENTION_DAYS', String(days));
}

/** Load the service with the caches cleared, so it reads this test's environment. */
async function loadService() {
  const { resetLangfuseForTests } = await import('@/libs/Langfuse');
  resetLangfuseForTests();
  return import('./LangfuseRetentionService');
}

beforeEach(() => {
  calls = [];
  for (const name of LANGFUSE_VARIABLES) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(async () => {
  const { resetLangfuseForTests } = await import('@/libs/Langfuse');
  resetLangfuseForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('when it must do nothing', () => {
  it('skips entirely when tracing is off', async () => {
    setEnv('LANGFUSE_ENABLED', 'false');
    mockLangfuseApi([['trace-1']]);
    const { pruneExpiredTraces } = await loadService();

    await expect(pruneExpiredTraces(NOW)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('skips when retention is explicitly turned off with 0', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
    setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');
    setEnv('LANGFUSE_BASE_URL', 'https://traces.example.com');
    setEnv('LANGFUSE_RETENTION_DAYS', '0');
    mockLangfuseApi([['trace-1']]);
    const { pruneExpiredTraces } = await loadService();

    await expect(pruneExpiredTraces(NOW)).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('prunes at one year when nothing configured it, since that is the default', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
    setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');
    setEnv('LANGFUSE_BASE_URL', 'https://traces.example.com');
    mockLangfuseApi([[]]);
    const { pruneExpiredTraces } = await loadService();

    const result = await pruneExpiredTraces(NOW);

    // 365 days before 2026-09-03.
    expect(result).toMatchObject({ cutoff: '2025-09-03T12:00:00.000Z' });
  });

  it('deletes nothing when no trace is old enough', async () => {
    configureRetention();
    mockLangfuseApi([[]]);
    const { pruneExpiredTraces } = await loadService();

    const result = await pruneExpiredTraces(NOW);

    expect(result).toMatchObject({ deleted: 0, moreRemaining: false });
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(0);
  });
});

describe('the age boundary', () => {
  it('counts back the configured number of days from now', async () => {
    const { retentionCutoff } = await loadService();

    expect(retentionCutoff(30, NOW)).toBe('2026-08-04T12:00:00.000Z');
  });

  it('asks Langfuse only for traces before that boundary', async () => {
    configureRetention(7);
    mockLangfuseApi([[]]);
    const { pruneExpiredTraces } = await loadService();

    await pruneExpiredTraces(NOW);

    const listUrl = new URL(calls[0]!.url);

    expect(listUrl.pathname).toBe('/api/public/traces');
    expect(listUrl.searchParams.get('toTimestamp')).toBe('2026-08-27T12:00:00.000Z');
  });
});

describe('deleting', () => {
  it('deletes the expired traces it was given', async () => {
    configureRetention();
    mockLangfuseApi([['trace-1', 'trace-2'], []]);
    const { pruneExpiredTraces } = await loadService();

    const result = await pruneExpiredTraces(NOW);

    expect(result).toMatchObject({ deleted: 2, moreRemaining: false });

    const deletes = calls.filter(call => call.method === 'DELETE');

    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.body).toEqual({ traceIds: ['trace-1', 'trace-2'] });
  });

  it('keeps re-reading the first page, because deleting shifts the rest down', async () => {
    configureRetention();
    mockLangfuseApi([['trace-1'], ['trace-2'], []]);
    const { pruneExpiredTraces } = await loadService();

    const result = await pruneExpiredTraces(NOW);

    expect(result).toMatchObject({ deleted: 2 });

    const listedPages = calls
      .filter(call => call.method === 'GET')
      .map(call => new URL(call.url).searchParams.get('page'));

    expect(listedPages).toEqual(['1', '1', '1']);
  });

  it('splits a large page into batches, so one failure costs at most a batch', async () => {
    configureRetention();
    const oneHundred = Array.from({ length: 100 }, (_, index) => `trace-${index}`);
    mockLangfuseApi([oneHundred, []]);
    const { pruneExpiredTraces } = await loadService();

    const result = await pruneExpiredTraces(NOW);

    expect(result).toMatchObject({ deleted: 100 });

    const deletes = calls.filter(call => call.method === 'DELETE');

    expect(deletes).toHaveLength(2);
    expect((deletes[0]!.body as { traceIds: string[] }).traceIds).toHaveLength(50);
  });

  it('authenticates with the project keys', async () => {
    configureRetention();
    mockLangfuseApi([[]]);
    const { pruneExpiredTraces } = await loadService();

    await pruneExpiredTraces(NOW);

    const header = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    const expected = `Basic ${Buffer.from('pk-lf-real:sk-lf-real').toString('base64')}`;

    expect(header.Authorization).toBe(expected);
  });

  it('stops at the per-run page limit and says the backlog is not clear', async () => {
    configureRetention();
    // Never returns an empty page: the cap is the only thing that stops it.
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') {
        return new Response('{}', { status: 200 });
      }
      void input;
      return new Response(JSON.stringify({ data: [{ id: 'trace-endless' }] }), { status: 200 });
    }));
    const { pruneExpiredTraces } = await loadService();

    const result = await pruneExpiredTraces(NOW);

    expect(result).toMatchObject({ moreRemaining: true, deleted: 200 });
  });
});

describe('when Langfuse is unhappy', () => {
  it('surfaces a failed list rather than reporting success', async () => {
    configureRetention();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('project not found', { status: 404 })));
    const { pruneExpiredTraces } = await loadService();

    await expect(pruneExpiredTraces(NOW)).rejects.toThrow(/trace list failed: 404/);
  });

  it('surfaces a failed delete, so Temporal retries it', async () => {
    configureRetention();
    vi.stubGlobal('fetch', vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      if ((init?.method ?? 'GET') === 'DELETE') {
        return new Response('clickhouse unavailable', { status: 503 });
      }
      return new Response(JSON.stringify({ data: [{ id: 'trace-1' }] }), { status: 200 });
    }));
    const { pruneExpiredTraces } = await loadService();

    await expect(pruneExpiredTraces(NOW)).rejects.toThrow(/trace delete failed: 503/);
  });
});
