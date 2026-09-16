import { describe, expect, it } from 'vitest';
import { absenceKey, briefMarkdown, isAbsenceStatement, reduceBrief } from './brief';
import { computeConfidenceDimensions } from './confidence';

/**
 * The brief the CEO reviewed, section for section: twelve zones restating one
 * absence six or seven times. `docs/specs/personalization-v2.md`.
 */
const BEFORE = [
  { heading: 'Prospect', body: '**Name:** Dana Reyes\n**Role:** Director of Operations\n**Company:** Kestrel Capital.' },
  { heading: 'Research That Matters', body: 'We could not establish what this company does. The website could not be retrieved.' },
  { heading: 'Recommended Angle', body: 'Ask a simple honest question about how they handle operations reporting.' },
  { heading: 'Opening Question', body: 'How are you handling reporting across the portfolio today?' },
  { heading: 'Case Study', body: 'A comparable operations team cut reporting time by half.' },
  { heading: 'Missing', body: 'No company website found for Kestrel Capital.\nCompany size not published.' },
  { heading: 'CRM Context', body: 'Enrolled in a sequence within minutes of becoming an MQL.' },
  { heading: 'Brief Confidence', body: 'Low. We do not know what this company does, so the angle is generic.' },
  { heading: 'Missing Information', body: 'We could not retrieve the company website.' },
  { heading: 'Reference Articles', body: 'None retrieved.' },
];

const CLAIMS = [
  { text: 'Director of Operations at Kestrel Capital.', kind: 'company', source: 'hubspot:contacts/88301', date: '2026-09-01' },
  { text: 'Converted on the operations ebook.', kind: 'engagement', source: 'hubspot:contacts/88301', date: '2026-09-01' },
];

const MISSING = ['No company website found for Kestrel Capital.', 'Company size not published.'];

describe('isAbsenceStatement', () => {
  it.each([
    'We could not establish what this company does.',
    'No company website found.',
    'Company size not published.',
    'The website could not be retrieved.',
    'Nothing is known about their stack.',
  ])('recognises %s', (line) => {
    expect(isAbsenceStatement(line)).toBe(true);
  });

  it('leaves a positive statement alone', () => {
    expect(isAbsenceStatement('Director of Operations at Kestrel Capital.')).toBe(false);
  });
});

describe('absenceKey', () => {
  it('collapses the same absence written three ways onto one key', () => {
    const a = absenceKey('No company website found for Kestrel Capital.');
    const b = absenceKey('We could not retrieve the company website.');
    const c = absenceKey('The company website could not be retrieved');

    expect(b).toBe(c);
    expect(a).toContain('website');
  });

  it('keeps genuinely different absences apart', () => {
    expect(absenceKey('Company size not published.')).not.toBe(absenceKey('No company website found.'));
  });
});

describe('reduceBrief — the reduction pass', () => {
  const reduced = reduceBrief({
    sections: BEFORE,
    missing: MISSING,
    claims: CLAIMS,
    dimensions: computeConfidenceDimensions({
      contactName: 'Dana Reyes',
      contactTitle: 'Director of Operations',
      companyName: 'Kestrel Capital',
      entranceSource: 'PAID_SOCIAL',
      utmCampaign: 'ops-ebook',
      mqlAt: '2026-09-01T00:00:00.000Z',
      claims: CLAIMS,
    }),
  });

  it('twelve zones become at most five sections', () => {
    expect(BEFORE.length).toBe(10);
    expect(reduced.brief.length).toBeLessThanOrEqual(5);
    expect(reduced.brief.map(s => s.heading)).toEqual([
      'What we know',
      'What we couldn\'t verify',
      'Recommended angle',
      'Sources',
      'Research confidence',
    ]);
  });

  it('states the missing website ONCE, however many sections said it', () => {
    // What a reader sees: the five sections. The absence is stated in the one
    // section that owns it, and nowhere else.
    const read = reduced.brief.map(s => `${s.heading}\n${s.body}`).join('\n');

    expect((read.match(/website/gi) ?? []).length).toBe(1);
    expect(reduced.gaps.filter(g => /website/i.test(g))).toHaveLength(1);
  });

  it('drops a section that was nothing but a restated absence, and records why', () => {
    const headings = reduced.evidence.map(s => s.heading);

    expect(headings).not.toContain('Missing Information');
    expect(headings).not.toContain('Reference Articles');
    expect(reduced.dropped.some(d => d.reason === 'duplicate-absence')).toBe(true);
  });

  it('a section with nothing to say is omitted, not rendered empty', () => {
    const thin = reduceBrief({ sections: [{ heading: 'Prospect', body: '   ' }], missing: [], claims: [], confidence: null });

    expect(thin.brief).toEqual([]);
    expect(thin.dropped).toEqual([{ heading: 'Prospect', reason: 'empty' }]);
  });

  it('moves the real-but-not-urgent sections to Evidence rather than deleting them', () => {
    const headings = reduced.evidence.map(s => s.heading);

    expect(headings).toContain('Opening Question');
    expect(headings).toContain('Case Study');
    expect(headings).toContain('CRM Context');
  });

  it('computes Research confidence instead of letting the model narrate it a seventh time', () => {
    const confidence = reduced.brief.find(s => s.heading === 'Research confidence')!;

    expect(confidence.body).toContain('Engagement: unavailable');
    expect(confidence.body).not.toMatch(/we do not know what this company does/i);
  });

  it('less evidence produces a SMALLER brief, not a longer explanation', () => {
    const richer = reduceBrief({
      sections: BEFORE,
      missing: [],
      claims: [...CLAIMS, { text: 'Kestrel runs a 40-person operations team.', kind: 'company', source: 'https://kestrel.example/about' }],
      confidence: 0.8,
    });
    const poorer = reduceBrief({ sections: [BEFORE[0]!], missing: MISSING, claims: [], confidence: 0.1 });

    expect(JSON.stringify(poorer.brief).length).toBeLessThan(JSON.stringify(richer.brief).length);
  });
});

describe('briefMarkdown', () => {
  it('serialises the same structure the page renders, so the artifact cannot drift', () => {
    const reduced = reduceBrief({ sections: BEFORE, missing: MISSING, claims: CLAIMS, confidence: 0.2 });
    const md = briefMarkdown(reduced, 'Dana Reyes — research brief');

    expect(md.startsWith('# Dana Reyes — research brief')).toBe(true);
    for (const section of reduced.brief) {
      expect(md).toContain(`## ${section.heading}`);
    }
  });
});
