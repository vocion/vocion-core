import { describe, expect, it } from 'vitest';
import { failedAttemptsOf, failureRecovery, withFailedAttempt } from './failureRecovery';

const SCOPE_403 = 'Gmail draft failed: 403 { "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "status": "PERMISSION_DENIED", "details": [ { "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT" } ] } }';

describe('failureRecovery', () => {
  it('lets a run whose connection was granted too little be fixed and run again', () => {
    expect(failureRecovery('gmail.send', SCOPE_403)).toEqual({ retryable: true, reason: 'permission' });
  });

  it('lets a run with no connection behind it be connected and run again', () => {
    expect(failureRecovery('hubspot.update', 'No HubSpot source is connected in this workspace.')).toEqual({ retryable: true, reason: 'connection' });
  });

  it('lets a run the vendor was briefly unavailable for be run again', () => {
    expect(failureRecovery('gmail.send', 'Gmail draft failed: 503 Service Unavailable')).toEqual({ retryable: true, reason: 'transient' });
    expect(failureRecovery('gmail.send', 'Gmail send failed: 429 Too Many Requests')).toEqual({ retryable: true, reason: 'transient' });
  });

  it('refuses any other failure, and says why', () => {
    const out = failureRecovery('test.write', 'The record was half written');

    expect(out.retryable).toBe(false);
    expect(out.retryable === false && out.why).toMatch(/safe to repeat/);
    expect(failureRecovery('gmail.send', 'Gmail draft failed: 400 Invalid To header').retryable).toBe(false);
    expect(failureRecovery('gmail.send', null).retryable).toBe(false);
  });
});

describe('withFailedAttempt', () => {
  it('keeps each failure a retry sets aside, oldest first, beside what the run recorded', () => {
    const once = withFailedAttempt({ draftId: 'd-1' }, 'first', new Date('2026-01-05T10:00:00Z'));
    const twice = withFailedAttempt(once, 'second', new Date('2026-01-05T11:00:00Z'));

    expect(twice).toMatchObject({ draftId: 'd-1' });
    expect(failedAttemptsOf(twice)).toEqual([
      { at: '2026-01-05T10:00:00.000Z', error: 'first' },
      { at: '2026-01-05T11:00:00.000Z', error: 'second' },
    ]);
  });

  it('changes nothing when there is no failure to keep', () => {
    expect(withFailedAttempt(null, null, null)).toBeNull();
    expect(withFailedAttempt({ a: 1 }, '', null)).toEqual({ a: 1 });
    expect(failedAttemptsOf({ failedAttempts: 'garbage' })).toEqual([]);
  });
});
