import { describe, expect, it } from 'vitest';
import {
  computeConfidenceDimensions,
  CONFIDENCE_DIMENSIONS,
  headlineConfidence,
  recommendedPosture,
  unavailableDimensions,
} from './confidence';

/** The lead the CEO reviewed: identity known, company unknowable, engagement unavailable. */
const THIN = {
  contactName: 'Dana Reyes',
  contactTitle: 'Director of Operations',
  companyName: 'Kestrel Capital',
  entranceSource: 'PAID_SOCIAL',
  utmCampaign: 'ops-ebook',
  mqlAt: '2026-09-01T00:00:00.000Z',
  engagementSent: null,
  engagementOpened: null,
  claims: [{ kind: 'company', source: 'hubspot:contacts/88301' }],
  missing: ['The company website could not be retrieved.'],
};

describe('computeConfidenceDimensions', () => {
  it('grades the five dimensions separately instead of one collapsed number', () => {
    const d = computeConfidenceDimensions(THIN);

    expect(Object.keys(d).sort()).toEqual([...CONFIDENCE_DIMENSIONS].sort());
    // Identity and acquisition are genuinely high; the old single score was
    // dragging them down to meet the absent ones.
    expect(d.identity.value).toBeGreaterThan(0.5);
    expect(d.acquisition.value).toBe(1);
    expect(d.company.value).toBeLessThan(0.3);
  });

  it('marks engagement UNAVAILABLE rather than low when the CRM returned no fields', () => {
    const d = computeConfidenceDimensions(THIN);

    expect(d.engagement.value).toBeNull();
    expect(d.engagement.basis).toContain('no engagement fields');
    expect(unavailableDimensions(d)).toEqual(['engagement']);
  });

  it('a zero is a fact, not an absence — zero sent grades, it does not read as unavailable', () => {
    const d = computeConfidenceDimensions({ ...THIN, engagementSent: 0, engagementOpened: 0 });

    expect(d.engagement.value).not.toBeNull();
  });

  it('verified external company claims lift company understanding and personalization fit', () => {
    const d = computeConfidenceDimensions({
      ...THIN,
      claims: [
        { kind: 'company', source: 'https://kestrel.example/about' },
        { kind: 'signal', source: 'https://kestrel.example/blog/ops' },
      ],
    });

    expect(d.company.value!).toBeGreaterThan(0.5);
    expect(d.personalizationFit.value!).toBeGreaterThan(0.4);
  });
});

describe('headlineConfidence', () => {
  it('leaves an unavailable dimension OUT of the mean instead of scoring it zero', () => {
    const d = computeConfidenceDimensions(THIN);
    const withAbsence = headlineConfidence(d);
    const graded = CONFIDENCE_DIMENSIONS.map(k => d[k].value).filter((v): v is number => v !== null);

    expect(withAbsence).toBeCloseTo(Math.round(graded.reduce((a, b) => a + b, 0) / graded.length * 100) / 100, 2);
    // And it is materially higher than counting the absence as a zero would give.
    expect(withAbsence).toBeGreaterThan(graded.reduce((a, b) => a + b, 0) / 5);
  });
});

describe('recommendedPosture', () => {
  it('identity known + company insufficient + engagement unavailable → curiosity, not fabricated personalization', () => {
    const call = recommendedPosture(computeConfidenceDimensions(THIN));

    expect(call.posture).toBe('curiosity');
    expect(call.reason).toContain('engagement is unavailable');
    expect(call.reason).toContain('fabricate');
  });

  it('identity and company both established → the opening line may name something true about them', () => {
    const call = recommendedPosture(computeConfidenceDimensions({
      ...THIN,
      claims: [
        { kind: 'company', source: 'https://kestrel.example/about' },
        { kind: 'company', source: 'https://kestrel.example/product' },
        { kind: 'signal', source: 'https://kestrel.example/blog' },
      ],
      engagementSent: 2,
      engagementOpened: 2,
    }));

    expect(call.posture).toBe('personalized');
  });
});
