import { describe, expect, it } from 'vitest';
import { decidedByPerson } from './decider';

describe('decidedByPerson', () => {
  it('reads a user id or a token as a person', () => {
    expect(decidedByPerson('user_2abcDEF')).toBe(true);
    expect(decidedByPerson('token:ci-bot')).toBe(true);
  });

  it('reads a seat, a sweep, the trust ladder or no stamp as not a person', () => {
    for (const by of ['agent:product-manager', 'system:review-sweep', 'factory:send-engineer', 'trust-ladder', '', null, undefined]) {
      expect(decidedByPerson(by)).toBe(false);
    }
  });
});
