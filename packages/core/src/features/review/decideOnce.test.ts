import { describe, expect, it } from 'vitest';
import { alreadyDecidedStatus, alreadySettled } from './decideOnce';

// The server's refusal, verbatim from `ActionService.executeRun` (action run 5201, 2026-09-29).
const refusal = (status: string) => `action_run 5201 is ${status} — already decided, cannot execute`;

describe('a second decision on a decided run (Chris, 2026-09-29: "it turned green, but the error still showed")', () => {
  it('reads the status the refusal names', () => {
    expect(alreadyDecidedStatus(refusal('done'))).toBe('done');
    expect(alreadyDecidedStatus(refusal('awaiting_execution'))).toBe('awaiting_execution');
    expect(alreadyDecidedStatus('network down')).toBeNull();
    expect(alreadyDecidedStatus(null)).toBeNull();
  });

  it('an approve on an approved, running or done run is already met', () => {
    for (const s of ['done', 'executing', 'approved', 'awaiting_execution']) {
      expect(alreadySettled(refusal(s), 'approve')).toBe(true);
    }

    expect(alreadySettled(refusal('rejected'), 'reject')).toBe(true);
  });

  it('a refusal the other way is a real conflict, and any other error is an error', () => {
    expect(alreadySettled(refusal('rejected'), 'approve')).toBe(false);
    expect(alreadySettled(refusal('done'), 'reject')).toBe(false);
    expect(alreadySettled('This card is being regenerated', 'approve')).toBe(false);
  });
});
