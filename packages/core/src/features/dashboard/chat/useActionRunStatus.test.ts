import { describe, expect, it } from 'vitest';
import { isPollableRunId, isRequestRejected, TERMINAL_STATUSES } from './useActionRunStatus';

describe('isPollableRunId', () => {
  it('accepts a real run id', () => {
    expect(isPollableRunId(12)).toBe(true);
  });

  it('rejects everything that is not a positive integer', () => {
    // Each of these reached the server before 2026-09-15 and came back 400,
    // three times per inbox page, retried with backoff forever.
    expect(isPollableRunId(undefined)).toBe(false);
    expect(isPollableRunId(0)).toBe(false);
    expect(isPollableRunId(-3)).toBe(false);
    expect(isPollableRunId(Number.NaN)).toBe(false);
    expect(isPollableRunId(1.5)).toBe(false);
  });
});

describe('isRequestRejected', () => {
  it('treats a 4xx as final', () => {
    expect(isRequestRejected(Object.assign(new Error('Bad Request'), { status: 400 }))).toBe(true);
    expect(isRequestRejected({ code: 404 })).toBe(true);
  });

  it('treats a server error or a dropped connection as worth retrying', () => {
    expect(isRequestRejected(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
    expect(isRequestRejected(new Error('network down'))).toBe(false);
    expect(isRequestRejected(undefined)).toBe(false);
  });
});

describe('TERMINAL_STATUSES', () => {
  it('stops on outcomes and keeps polling work in progress', () => {
    expect(TERMINAL_STATUSES.has('done')).toBe(true);
    expect(TERMINAL_STATUSES.has('failed')).toBe(true);
    expect(TERMINAL_STATUSES.has('rejected')).toBe(true);
    expect(TERMINAL_STATUSES.has('pending')).toBe(false);
    expect(TERMINAL_STATUSES.has('executing')).toBe(false);
  });
});
