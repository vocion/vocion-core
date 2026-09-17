/**
 * The connect timeout, which decides whether a handler answers or hangs.
 *
 * Temporal's own default is 10 seconds. A request handler that waits that long
 * for an unreachable server is indistinguishable from a broken one: the caller
 * times out first and never sees the error the handler was about to send. The
 * rules below are what keep the wait inside a request.
 */
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { temporalConnectTimeoutMs } from './client';

afterEach(() => {
  delete process.env.VOCION_TEMPORAL_CONNECT_TIMEOUT_MS;
});

describe('temporalConnectTimeoutMs', () => {
  it('gives up well inside the time a caller will wait', () => {
    // Browsers, test runners and load balancers commonly cut a request off at
    // ten seconds, which is exactly the library default. Anything at or above
    // that means the handler never gets to answer at all.
    expect(temporalConnectTimeoutMs()).toBeLessThan(10_000);
  });

  it('honours a deployment that needs longer', () => {
    process.env.VOCION_TEMPORAL_CONNECT_TIMEOUT_MS = '20000';

    expect(temporalConnectTimeoutMs()).toBe(20_000);
  });

  it('ignores a value that is not a usable number', () => {
    // A typo here would otherwise reach the client as NaN, which is not a
    // shorter timeout — it is no timeout, and the hang comes back silently.
    process.env.VOCION_TEMPORAL_CONNECT_TIMEOUT_MS = 'soon';

    expect(temporalConnectTimeoutMs()).toBe(5_000);
  });

  it('ignores a value that would disable the wait entirely', () => {
    process.env.VOCION_TEMPORAL_CONNECT_TIMEOUT_MS = '0';

    expect(temporalConnectTimeoutMs()).toBe(5_000);
  });
});
