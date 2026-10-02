import { describe, expect, it } from 'vitest';
import { decidedByMachine } from './decider';

describe('decidedByMachine', () => {
  it('reads a seat, a sweep or the trust ladder as a machine', () => {
    for (const by of ['agent:product-manager', 'system:review-sweep', 'factory:send-engineer', 'trust-ladder']) {
      expect(decidedByMachine(by)).toBe(true);
    }
  });

  it('reads a user id, a token or no stamp as not known to be a machine', () => {
    for (const by of ['user_2abcDEF', 'token:ci-bot', '', null, undefined]) {
      expect(decidedByMachine(by)).toBe(false);
    }
  });
});
