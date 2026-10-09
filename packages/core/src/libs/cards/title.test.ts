import { describe, expect, it } from 'vitest';
import { shortTitle } from './title';

describe('a card title', () => {
  it('stays whole when it is short', () => {
    expect(shortTitle('  Track the Northwind upload service  ')).toBe('Track the Northwind upload service');
  });

  it('is cut at a word, at most 70 characters, never mid-word', () => {
    const long = 'The operating intent names this as one of three repositories in the factory scope and states its reliability bar';
    const t = shortTitle(long);

    expect(t.length).toBeLessThanOrEqual(70);
    expect(t.endsWith('…')).toBe(true);
    expect(long.startsWith(t.slice(0, -1))).toBe(true);
    expect(long[t.length - 1]).toBe(' ');
  });
});
