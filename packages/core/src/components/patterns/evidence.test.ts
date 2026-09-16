import { describe, expect, it } from 'vitest';
import { citationLabel, evidenceSource, isCitationUrl } from './evidence';

describe('evidenceSource', () => {
  it('files the researcher\'s fact vocabulary under Fact', () => {
    for (const kind of ['Fact', 'fact', 'company', 'engagement', 'signal']) {
      expect(evidenceSource(kind)).toEqual({ label: 'Fact', tone: 'fact' });
    }
  });

  it('files inferences under Inference', () => {
    for (const kind of ['Inference', 'inference', 'hypothesis', 'guess']) {
      expect(evidenceSource(kind)).toEqual({ label: 'Inference', tone: 'inference' });
    }
  });

  it('shows an unknown kind as written rather than hiding it', () => {
    expect(evidenceSource('rumour')).toEqual({ label: 'Rumour', tone: 'other' });
  });

  it('treats a missing kind as a fact', () => {
    expect(evidenceSource(undefined).label).toBe('Fact');
    expect(evidenceSource('').label).toBe('Fact');
  });
});

describe('citationLabel', () => {
  it('shortens a URL to host and path', () => {
    expect(citationLabel('https://www.incline.bet/about')).toBe('incline.bet/about');
    expect(citationLabel('https://incline.bet/')).toBe('incline.bet');
    expect(isCitationUrl('https://incline.bet/')).toBe(true);
  });

  it('names a system ref', () => {
    expect(citationLabel('hubspot:contacts/88201')).toBe('Hubspot · contacts/88201');
    expect(isCitationUrl('hubspot:contacts/88201')).toBe(false);
  });

  it('leaves prose alone', () => {
    expect(citationLabel('Call notes, 2026-08-30')).toBe('Call notes, 2026-08-30');
  });
});
