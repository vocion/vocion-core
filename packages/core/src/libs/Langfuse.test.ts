/**
 * What the tracing helpers do when Langfuse is not configured.
 *
 * The point of the disabled path is that callers should not have to
 * know about it. `AgentService` builds spans off whatever `traceFor`
 * returns and stores `trace.id` on a row; `RetrievalService` and the
 * embedder flush after their work. All of that has to keep working on a
 * deployment with no Langfuse at all, without null checks scattered
 * through the services and without an exception reaching the caller.
 *
 * These tests also pin the other half: importing this module must not
 * construct a client. That is what used to open a tracer pointed at
 * `localhost:3200` inside every production container.
 *
 * The Langfuse SDK is mocked, so nothing here sends a trace anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const traceSpy = vi.fn(() => ({ id: 'trace-from-sdk' }));
const scoreSpy = vi.fn();
const flushAsyncSpy = vi.fn(async () => {});
const constructorSpy = vi.fn();

vi.mock('langfuse', () => ({
  Langfuse: class {
    trace = traceSpy;
    score = scoreSpy;
    flushAsync = flushAsyncSpy;

    constructor(options: unknown) {
      constructorSpy(options);
    }
  },
}));

/**
 * Every variable the config resolver reads.
 *
 * Set through `vi.stubEnv` rather than by assigning `process.env`:
 * `NODE_ENV` is typed read-only, and stubbing restores every value
 * afterwards.
 */
const LANGFUSE_VARIABLES = [
  'LANGFUSE_ENABLED',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_PROJECT_ID',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'NODE_ENV',
] as const;

/**
 * Set one environment variable for the duration of a test.
 * @param name - Variable to set.
 * @param value - Value to set it to.
 */
function setEnv(name: string, value: string): void {
  vi.stubEnv(name, value);
}

/**
 * Load the module fresh. The resolved config and the client are cached
 * on `globalThis` for the life of the process, so each case has to
 * clear that cache before setting its own environment.
 */
async function loadLangfuseModule() {
  const loaded = await import('./Langfuse');
  loaded.resetLangfuseForTests();
  return loaded;
}

beforeEach(() => {
  for (const name of LANGFUSE_VARIABLES) {
    vi.stubEnv(name, undefined);
  }
  constructorSpy.mockClear();
  traceSpy.mockClear();
  scoreSpy.mockClear();
  flushAsyncSpy.mockClear();
});

afterEach(async () => {
  const { resetLangfuseForTests } = await import('./Langfuse');
  resetLangfuseForTests();
  vi.unstubAllEnvs();
});

describe('tracing off', () => {
  beforeEach(() => {
    setEnv('LANGFUSE_ENABLED', 'false');
  });

  it('never constructs a client', async () => {
    const { getLangfuseClient, traceFor } = await loadLangfuseModule();

    traceFor({ feature: 'agent.chat', slug: 'sales-assistant', orgId: 'org_1', userId: 'user_1' });

    expect(getLangfuseClient()).toBeNull();
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it('hands back a trace that accepts spans and generations without recording', async () => {
    const { traceFor } = await loadLangfuseModule();

    const trace = traceFor({
      feature: 'agent.chat',
      slug: 'sales-assistant',
      orgId: 'org_1',
      userId: 'user_1',
    });

    // Exactly the shape AgentService and the retrieval paths use.
    const generation = trace.generation({ name: 'chat:model', model: 'claude-opus-5' });
    generation.end({ output: 'hello' });
    const span = trace.span({ name: 'tool:search' });
    span.end({ output: 'done' });
    trace.update({ output: { ok: true } });

    expect(traceSpy).not.toHaveBeenCalled();
  });

  it('still gives each trace a unique id, so a stored traceId column stays unique', async () => {
    const { traceFor } = await loadLangfuseModule();

    const first = traceFor({ feature: 'agent.chat', slug: 'a', orgId: 'org_1', userId: 'user_1' });
    const second = traceFor({ feature: 'agent.chat', slug: 'b', orgId: 'org_1', userId: 'user_1' });

    expect(first.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it('reports a score push as not sent rather than throwing', async () => {
    const { pushScore } = await loadLangfuseModule();

    expect(pushScore({ traceId: 'trace-1', name: 'user-thumbs', value: 1 })).toBe(false);
    expect(scoreSpy).not.toHaveBeenCalled();
  });

  it('flushes as a no-op', async () => {
    const { flushTraces } = await loadLangfuseModule();

    await expect(flushTraces()).resolves.toBeUndefined();
    expect(flushAsyncSpy).not.toHaveBeenCalled();
  });

  it('reports tracing as off', async () => {
    const { isTracingEnabled } = await loadLangfuseModule();

    expect(isTracingEnabled()).toBe(false);
  });
});

describe('tracing on', () => {
  beforeEach(() => {
    setEnv('NODE_ENV', 'production');
    setEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-real');
    setEnv('LANGFUSE_SECRET_KEY', 'sk-lf-real');
    setEnv('LANGFUSE_BASE_URL', 'https://cloud.langfuse.com');
  });

  it('does not construct a client until something is traced', async () => {
    const { traceFor } = await loadLangfuseModule();

    expect(constructorSpy).not.toHaveBeenCalled();

    traceFor({ feature: 'agent.chat', slug: 'sales-assistant', orgId: 'org_1', userId: 'user_1' });

    expect(constructorSpy).toHaveBeenCalledWith({
      publicKey: 'pk-lf-real',
      secretKey: 'sk-lf-real',
      baseUrl: 'https://cloud.langfuse.com',
    });
  });

  it('builds one client and reuses it', async () => {
    const { getLangfuseClient } = await loadLangfuseModule();

    const first = getLangfuseClient();
    const second = getLangfuseClient();

    expect(first).toBe(second);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it('stamps the standard org, feature and slug dimensions on the trace', async () => {
    const { traceFor } = await loadLangfuseModule();

    traceFor({
      feature: 'agent.chat',
      slug: 'sales-assistant',
      orgId: 'org_1',
      userId: 'user_1',
    });

    expect(traceSpy).toHaveBeenCalledWith(expect.objectContaining({
      name: 'agent.chat:sales-assistant',
      userId: 'user_1',
      tags: ['feature:agent.chat', 'org:org_1', 'slug:sales-assistant'],
    }));
  });

  it('forwards a score push to the SDK', async () => {
    const { pushScore } = await loadLangfuseModule();

    expect(pushScore({ traceId: 'trace-1', name: 'user-thumbs', value: 0 })).toBe(true);
    expect(scoreSpy).toHaveBeenCalledWith(expect.objectContaining({
      traceId: 'trace-1',
      name: 'user-thumbs',
      value: 0,
      dataType: 'BOOLEAN',
    }));
  });

  it('skips a score push with no trace id', async () => {
    const { pushScore } = await loadLangfuseModule();

    expect(pushScore({ traceId: null, name: 'review-decision', value: 1 })).toBe(false);
    expect(scoreSpy).not.toHaveBeenCalled();
  });

  it('reports a failed score push as not sent instead of throwing', async () => {
    const { pushScore } = await loadLangfuseModule();
    scoreSpy.mockImplementationOnce(() => {
      throw new Error('langfuse unreachable');
    });

    expect(pushScore({ traceId: 'trace-1', name: 'user-thumbs', value: 1 })).toBe(false);
  });

  it('flushes through the SDK', async () => {
    const { flushTraces } = await loadLangfuseModule();

    await flushTraces();

    expect(flushAsyncSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed flush, because losing traces must not fail the work', async () => {
    const { flushTraces } = await loadLangfuseModule();
    flushAsyncSpy.mockRejectedValueOnce(new Error('connection reset'));

    await expect(flushTraces()).resolves.toBeUndefined();
  });

  it('reports tracing as on', async () => {
    const { isTracingEnabled } = await loadLangfuseModule();

    expect(isTracingEnabled()).toBe(true);
  });
});

describe('tracing demanded but unconfigured', () => {
  it('throws on the first traced call rather than tracing into a void', async () => {
    setEnv('NODE_ENV', 'production');
    setEnv('LANGFUSE_ENABLED', 'true');

    const { traceFor } = await loadLangfuseModule();

    expect(() => traceFor({
      feature: 'agent.chat',
      slug: 'sales-assistant',
      orgId: 'org_1',
      userId: 'user_1',
    })).toThrow(/LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are not set/);
  });
});
