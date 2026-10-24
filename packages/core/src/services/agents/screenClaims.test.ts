import { describe, expect, it } from 'vitest';
import { NO_SCREEN_CLAIMS } from './screenClaims';

describe('the rule against claims about the screen (2026-10-23)', () => {
  it('forbids saying something is open and says how to name it instead', () => {
    expect(NO_SCREEN_CLAIMS).toContain('You cannot see the person\'s screen');
    expect(NO_SCREEN_CLAIMS).toContain('"is open"');
    expect(NO_SCREEN_CLAIMS).toContain('artifact #<id>');
    expect(NO_SCREEN_CLAIMS).toContain('/dashboard/artifacts/<id>');
  });
});
