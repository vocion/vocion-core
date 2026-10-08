import { describe, expect, it } from 'vitest';
import { firstSentence } from './frontDoor';

describe('firstSentence', () => {
  it('keeps the first of several sentences', () => {
    expect(firstSentence('Drafts the Contoso proposal. Flags what to fix first.')).toBe('Drafts the Contoso proposal.');
  });

  it('leaves one sentence, and text with no full stop, alone', () => {
    expect(firstSentence('Answers which Northwind contracts renew this year.')).toBe('Answers which Northwind contracts renew this year.');
    expect(firstSentence('Reads Kestrel Capital filings')).toBe('Reads Kestrel Capital filings');
  });

  it('does not split on a version or an abbreviation', () => {
    expect(firstSentence('Ships v2.1 releases, e.g. hotfixes. Then tells the asker.')).toBe('Ships v2.1 releases, e.g. hotfixes.');
  });

  it('collapses whitespace and survives nothing', () => {
    expect(firstSentence('  Two\n lines. ')).toBe('Two lines.');
    expect(firstSentence(undefined)).toBe('');
  });
});
