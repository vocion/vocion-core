import type { ReopenSubject } from './reopen';
import { describe, expect, it } from 'vitest';
import { carryReopenRecord, reopenRefusal, withReopenRecord } from './reopen';

const NOW = new Date('2026-11-19T12:00:00Z');
const REVERSIBLE = { onRejected: () => {}, onReopened: () => {} };

function rejected(over: Partial<ReopenSubject> = {}): ReopenSubject {
  return { status: 'rejected', decidedBy: 'token:t1', result: null, expiresAt: null, ...over };
}

describe('which rejections can be reopened', () => {
  it('reopens a person\'s rejection of a run that never executed', () => {
    expect(reopenRefusal(7, rejected(), REVERSIBLE, NOW)).toBeNull();
  });

  it('refuses a run that is not rejected, so a second reopen is a conflict, not a silent repeat', () => {
    for (const status of ['pending', 'done', 'failed', 'undone', 'closed']) {
      expect(reopenRefusal(7, rejected({ status }), REVERSIBLE, NOW)?.code).toBe('INVALID_STATE');
    }
  });

  it('refuses a machine\'s rejection: a budget, a gate, a sweep or a deadline default', () => {
    for (const decidedBy of ['agent:ingestion-lead', 'system:gate:voice', 'trust-ladder', 'by-default']) {
      expect(reopenRefusal(7, rejected({ decidedBy }), REVERSIBLE, NOW)?.code).toBe('NOT_REOPENABLE');
    }
  });

  it('refuses a rejection with no decider on record, which cannot be shown to be a person\'s', () => {
    for (const decidedBy of [null, '', '  ']) {
      expect(reopenRefusal(7, rejected({ decidedBy }), REVERSIBLE, NOW)?.code).toBe('NOT_REOPENABLE');
    }
  });

  it('refuses a run that executed before it was rejected, which pending would offer to run again', () => {
    expect(reopenRefusal(7, rejected({ result: { sent: true } }), REVERSIBLE, NOW)?.code).toBe('NOT_REOPENABLE');
  });

  it('refuses an action whose reject changed a record it has no way to put back', () => {
    expect(reopenRefusal(7, rejected(), { onRejected: () => {} }, NOW)?.code).toBe('NOT_REOPENABLE');
    expect(reopenRefusal(7, rejected(), undefined, NOW)?.code).toBe('NOT_REOPENABLE');
  });

  it('reopens an action whose reject touched nothing but the run', () => {
    expect(reopenRefusal(7, rejected(), {}, NOW)).toBeNull();
  });

  it('refuses an expired run, which would be pending and still never reach the queue', () => {
    expect(reopenRefusal(7, rejected({ expiresAt: new Date('2026-11-19T11:59:59Z') }), REVERSIBLE, NOW)?.code).toBe('NOT_REOPENABLE');
    expect(reopenRefusal(7, rejected({ expiresAt: new Date('2026-11-20T00:00:00Z') }), REVERSIBLE, NOW)).toBeNull();
  });
});

describe('the reopen record', () => {
  const first = { by: 'token:t1', at: '2026-11-19T12:00:00.000Z', rejectedBy: 'token:t1', rejectedAt: '2026-11-19T11:00:00.000Z', rejectedReason: 'bulk reject' };
  const second = { ...first, at: '2026-11-19T13:00:00.000Z' };

  it('keeps every reopen, oldest first, beside the rest of the envelope', () => {
    const once = withReopenRecord({ confidence: 0.8 }, first);
    const twice = withReopenRecord(once, second);

    expect(twice).toEqual({ confidence: 0.8, reopened: [first, second] });
  });

  it('survives a re-proposal that replaces the envelope', () => {
    expect(carryReopenRecord({ reopened: [first] }, { confidence: 0.9 })).toEqual({ confidence: 0.9, reopened: [first] });
    expect(carryReopenRecord(null, { confidence: 0.9 })).toEqual({ confidence: 0.9 });
  });
});
