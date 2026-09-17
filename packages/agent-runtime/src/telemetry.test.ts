/**
 * What these tests defend.
 *
 * Every rule here was learned from AWS refusing a session or silently scoring
 * nothing. The failures are quiet ones — spans are accepted, look right in the
 * console, and match no evaluation — so they need a test rather than a careful
 * reader.
 */

import type { InvocationRequest } from './contract.js';
import process from 'node:process';
import { getSession } from '@arizeai/openinference-core';
import { context as otelContext } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionIdFor, startTelemetry, telemetryEnabled, withSession } from './telemetry.js';

const ENABLED_VAR = 'AGENT_OBSERVABILITY_ENABLED';

/**
 * A request with only the fields the session id is read from.
 * @param overrides - The session fields this case is about.
 */
function requestWith(overrides: Partial<InvocationRequest>): InvocationRequest {
  return {
    version: 1,
    agent: { slug: 'sales-brief', name: 'Sales brief', systemPrompt: 'be useful' },
    message: 'hello',
    tools: { endpoint: 'https://example.invalid/tools', catalog: [], claim: 'claim' },
    ...overrides,
  };
}

beforeAll(() => {
  // In production the ADOT distro registers this when it starts the tracer
  // provider. Without it the OpenTelemetry API uses a no-op context manager
  // that drops anything set on the context, which is the exact failure
  // `startTelemetry` now warns about — so the tests below register the real
  // one and test the warning separately.
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  otelContext.setGlobalContextManager(contextManager);
});

afterEach(() => {
  delete process.env[ENABLED_VAR];
  vi.restoreAllMocks();
});

describe('telemetryEnabled', () => {
  it('reads the flag the way AWS\'s own distro reads it', () => {
    // The distro exports spans when this variable is exactly "true", case
    // insensitive. If our reader were more generous, a runtime deployed with
    // AGENT_OBSERVABILITY_ENABLED=1 would set session context for an exporter
    // that is not running, and every span would go nowhere while the code
    // claimed tracing was on.
    process.env[ENABLED_VAR] = 'true';

    expect(telemetryEnabled()).toBe(true);

    process.env[ENABLED_VAR] = 'TRUE';

    expect(telemetryEnabled()).toBe(true);

    process.env[ENABLED_VAR] = '1';

    expect(telemetryEnabled()).toBe(false);

    process.env[ENABLED_VAR] = 'false';

    expect(telemetryEnabled()).toBe(false);
  });

  it('is off when the variable is absent', () => {
    // A laptop, a test, a container someone deployed before this change: none
    // of them should start paying for span ingestion by accident.
    delete process.env[ENABLED_VAR];

    expect(telemetryEnabled()).toBe(false);
  });
});

describe('sessionIdFor', () => {
  it('uses the caller\'s session id', () => {
    // AgentCore matches an evaluation's expected answers to a run by session
    // id. Invent one here and the spans arrive unmatched: the eval reports
    // nothing scored rather than reporting a failure.
    const id = sessionIdFor(requestWith({ sessionId: 'sess-42', trace: { orgId: 'o', userId: 'u', sessionId: 'trace-99' } }));

    expect(id).toBe('sess-42');
  });

  it('falls back to the trace session before the agent slug', () => {
    const id = sessionIdFor(requestWith({ trace: { orgId: 'o', userId: 'u', sessionId: 'trace-99' } }));

    expect(id).toBe('trace-99');
  });

  it('always returns something, even with no session anywhere', () => {
    // A span with no session.id is dropped from grading with no error. The
    // slug is a poor session, but it is a session.
    const id = sessionIdFor(requestWith({}));

    expect(id).toBe('sales-brief');
  });
});

describe('withSession', () => {
  it('puts the session on the context the instrumentation reads', async () => {
    process.env[ENABLED_VAR] = 'true';
    let seen: string | undefined;
    await withSession('sess-42', async () => {
      seen = getSession(otelContext.active())?.sessionId;
    });

    expect(seen).toBe('sess-42');
  });

  it('leaves the context as it found it', async () => {
    // Two turns run concurrently in one process. A session that outlived its
    // turn would stamp the next turn's spans with the previous session's id,
    // and the eval would grade one run's tool calls against another's expected
    // answer.
    process.env[ENABLED_VAR] = 'true';
    await withSession('sess-42', async () => {});

    expect(getSession(otelContext.active())).toBeUndefined();
  });

  it('runs the turn and returns its value with telemetry off', async () => {
    delete process.env[ENABLED_VAR];
    const result = await withSession('sess-42', async () => 'the answer');

    expect(result).toBe('the answer');
  });

  it('lets the turn\'s own failure through', async () => {
    // Tracing must not swallow an error the caller needs to see.
    process.env[ENABLED_VAR] = 'true';

    await expect(withSession('sess-42', async () => {
      throw new Error('tool endpoint refused');
    })).rejects.toThrow('tool endpoint refused');
  });
});

describe('startTelemetry', () => {
  it('does nothing and throws nothing when telemetry is off', () => {
    delete process.env[ENABLED_VAR];

    expect(() => startTelemetry()).not.toThrow();
  });
});

describe('the context-propagation probe', () => {
  it('says so in the log when nothing is carrying context', async () => {
    // The container is deployed without the `--require` flag: spans are
    // exported, AWS accepts them, and every evaluation scores nothing because
    // no span has a session.id. Nothing else in the system notices, so this
    // line in the log is the only warning anyone gets.
    process.env[ENABLED_VAR] = 'true';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(otelContext, 'with').mockImplementation((_ctx, fn) => (fn as () => unknown)());

    // A fresh module, because `startTelemetry` only ever runs once per process.
    vi.resetModules();
    const fresh = await import('./telemetry.js');
    fresh.startTelemetry();

    const warned = errors.mock.calls.some(call => String(call[0]).includes('no OpenTelemetry context manager'));

    expect(warned).toBe(true);
  });
});
