import { describe, expect, it } from 'vitest';
import { deferredLine, deferUntil } from './deferral';

describe('defer', () => {
  it('parks a card a week out, at nine in the morning', () => {
    const until = deferUntil(new Date(2026, 8, 24, 16, 42));

    expect(until.getFullYear()).toBe(2026);
    expect(until.getMonth()).toBe(9);
    expect(until.getDate()).toBe(1);
    expect(until.getHours()).toBe(9);
    expect(until.getMinutes()).toBe(0);
  });

  it('says when it comes back in a person\'s words', () => {
    expect(deferredLine(new Date(2026, 9, 1, 9))).toMatch(/^Deferred — back in review \w{3}, (Oct 1|1 Oct)\.$/);
  });
});
