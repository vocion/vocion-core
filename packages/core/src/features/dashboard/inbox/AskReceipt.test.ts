import { describe, expect, it } from 'vitest';
import { answeredBy } from './AskReceipt';

describe('who answered, as a person reads it (SEO walk 2, 2026-10-27)', () => {
  it('names the person, never their user id', () => {
    expect(answeredBy('usr-0f3a9c', 'Dana Reyes')).toBe('Dana Reyes');
    expect(answeredBy('usr-0f3a9c', null)).toBe('a person');
    expect(answeredBy('user-0f3a9c', null)).toBe('a person');
  });

  it('says the trust bar, a default and an agent in words', () => {
    expect(answeredBy('trust-ladder', null)).toBe('answered on the trust bar');
    expect(answeredBy('by-default', null)).toBe('applied by default');
    expect(answeredBy('agent:seo-editor', null)).toBe('seo-editor');
    expect(answeredBy(null, null)).toBeNull();
  });
});
