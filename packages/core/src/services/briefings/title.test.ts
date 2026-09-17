import { describe, expect, it } from 'vitest';
import { briefingTitle } from './title';

const NOW = new Date('2026-09-17T16:00:00Z');

describe('briefingTitle', () => {
  it('strips the date the model copied out of the schema example', () => {
    // The actual failure: a briefing published on the 17th, titled for the 16th
    // because that was the date in the tool schema's own example string.
    expect(briefingTitle('Revenue Briefing — Wed, Sep 16', NOW)).toBe('Revenue Briefing — Thu, Sep 17, 2026');
  });

  it('strips a date the model invented for a day that has not happened', () => {
    expect(briefingTitle('Revenue Briefing — Thu, Sep 18', NOW)).toBe('Revenue Briefing — Thu, Sep 17, 2026');
  });

  it('handles the other shapes a model writes a date in', () => {
    for (const written of [
      'Revenue Briefing - Sep 16, 2026',
      'Revenue Briefing (Wed Sep 16)',
      'Revenue Briefing — September 16',
      'Revenue Briefing, Sep 16',
    ]) {
      expect(briefingTitle(written, NOW)).toBe('Revenue Briefing — Thu, Sep 17, 2026');
    }
  });

  it('dates a title that carries none', () => {
    expect(briefingTitle('Revenue Briefing', NOW)).toBe('Revenue Briefing — Thu, Sep 17, 2026');
  });

  it('keeps a number in the name that is not a date', () => {
    expect(briefingTitle('Q3 Pipeline Briefing', NOW)).toBe('Q3 Pipeline Briefing — Thu, Sep 17, 2026');
  });

  it('never publishes a nameless briefing', () => {
    expect(briefingTitle('Sep 16', NOW)).toBe('Briefing — Thu, Sep 17, 2026');
  });
});
