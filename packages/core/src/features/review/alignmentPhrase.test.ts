import { describe, expect, it } from 'vitest';
import { alignmentPhrase } from './alignmentPhrase';

describe('alignmentPhrase', () => {
  it('stays quiet on a thin history', () => {
    expect(alignmentPhrase({ agreementRate: 0.25, n: 3, window: '30d' })).toBeNull();
    expect(alignmentPhrase(null)).toBeNull();
    expect(alignmentPhrase({ agreementRate: null, n: 9, window: '30d' })).toBeNull();
  });

  it('says what it counts once there is a history', () => {
    expect(alignmentPhrase({ agreementRate: 0.8, n: 10, window: '30d' })).toEqual({
      short: 'You agreed 8 of 10',
      long: 'You agreed with 8 of this agent\'s last 10 recommendations of this kind in the last 30d.',
    });
  });
});
