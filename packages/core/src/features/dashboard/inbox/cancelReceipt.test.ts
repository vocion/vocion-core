/**
 * The toast after Cancel tells the truth about what the cancel did
 * (vocion-core#123).
 *
 * A cancel on a run that already finished now returns the run unchanged. A
 * page loaded before the run finished still offers Cancel, and the toast
 * used to say "Stopped; nothing more runs." whatever the response said.
 */
import { describe, expect, it } from 'vitest';
import { cancelReceipt } from './cancelReceipt';

describe('cancelReceipt', () => {
  it('confirms the stop when the run came back cancelled', () => {
    expect(cancelReceipt('Weekly digest', 'cancelled')).toEqual({
      tone: 'success',
      title: 'Cancelled · Weekly digest',
      description: 'Stopped; nothing more runs.',
    });
  });

  it('says the run had already finished instead of claiming it was stopped', () => {
    const receipt = cancelReceipt('Weekly digest', 'completed');

    expect(receipt.tone).toBe('info');
    expect(receipt.title).toBe('Already completed · Weekly digest');
    expect(receipt.description).not.toContain('Stopped');
  });

  it('names a failed run as failed', () => {
    expect(cancelReceipt('Weekly digest', 'failed').title).toBe('Already failed · Weekly digest');
  });
});
