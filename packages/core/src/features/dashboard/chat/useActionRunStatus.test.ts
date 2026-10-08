import { describe, expect, it } from 'vitest';
import { FOREIGN_IDLE_MS, isPollableRunId, isRequestRejected, keepPolling, TERMINAL_STATUSES } from './useActionRunStatus';

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

// 5.0.1 review: a card from another workspace has no live topic here, so it
// polls. It polled every 2–30s for as long as it waited, hidden tab or not.
describe('keepPolling', () => {
  const here = { status: 'pending', live: false, foreign: false, hidden: false, idleMs: 0 };
  const there = { ...here, foreign: true };

  it('stops once the run settles or the stream pushes it, here or there', () => {
    expect(keepPolling({ ...here, status: 'done' })).toBe(false);
    expect(keepPolling({ ...here, live: true })).toBe(false);
    expect(keepPolling({ ...there, status: 'failed' })).toBe(false);
  });

  it('keeps a card of this workspace polling while its stream is down, whatever the tab does', () => {
    expect(keepPolling({ ...here, hidden: true, idleMs: FOREIGN_IDLE_MS * 3 })).toBe(true);
  });

  it('pauses a card from another workspace while the tab is hidden, or once it has sat unchanged past the cap', () => {
    expect(keepPolling(there)).toBe(true);
    expect(keepPolling({ ...there, status: 'snoozed', idleMs: FOREIGN_IDLE_MS - 1 })).toBe(true);
    expect(keepPolling({ ...there, hidden: true })).toBe(false);
    expect(keepPolling({ ...there, idleMs: FOREIGN_IDLE_MS })).toBe(false);
  });

  it('retries a failed read only on the same terms', () => {
    expect(keepPolling({ ...here, status: null })).toBe(true);
    expect(keepPolling({ ...there, status: null, hidden: true })).toBe(false);
  });
});
