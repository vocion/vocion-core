import { describe, expect, it } from 'vitest';
import { decidedByMachine } from './decider';

describe('decidedByMachine', () => {
  it('reads a seat, a sweep, the trust ladder or a decision clock default as a machine', () => {
    for (const by of ['agent:product-manager', 'system:review-sweep', 'factory:send-engineer', 'trust-ladder', 'by-default']) {
      expect(decidedByMachine(by)).toBe(true);
    }
  });

  it('reads a user id, a token or no stamp as not known to be a machine', () => {
    for (const by of ['user_2abcDEF', 'token:ci-bot', '', null, undefined]) {
      expect(decidedByMachine(by)).toBe(false);
    }
  });
});
