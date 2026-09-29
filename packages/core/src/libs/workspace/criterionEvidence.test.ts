import type { ProofCriterion } from './featureProof';
import { describe, expect, it } from 'vitest';
import { markdownSections } from '@/libs/cards/headingAnchor';
import { evidenceArtifactIdsOf, evidenceFor, shotParts, testNameOf } from './criterionEvidence';

/**
 * Which stored artifact proves which line, from QA's own words. Fictional
 * fixtures (Relay, a Northwind product; URLs at `.example`).
 */

function line(statement: string, evidence: string | null, state: ProofCriterion['state'] = 'passed'): ProofCriterion {
  return { statement, group: 'acceptance', state, evidence, evidenceUrl: null, from: 'verdict', note: null };
}

const AFTER = { id: 11, title: 'Upload resumes · phone · after', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/relay/upload-resumes-phone-after.png?sig=x', md: null };
const BEFORE = { id: 10, title: 'Upload resumes · phone · before', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/relay/upload-resumes-phone-before.png', md: null };
const OTHER_VIEWPORT = { id: 12, title: 'Upload resumes · desktop · before', kind: 'link', role: 'qa-screenshot', url: 'https://files.example/qa/relay/upload-resumes-desktop-before.png', md: null };

describe('evidenceFor', () => {
  it('pairs a shot named only by its file, and the before shot of the same flow and viewport', () => {
    expect(evidenceFor(line('The banner shows on a phone.', 'Screenshot upload-resumes-phone-after.png shows the banner.'), [OTHER_VIEWPORT, BEFORE, AFTER])).toEqual({
      criterion: 'The banner shows on a phone.',
      group: 'acceptance',
      status: 'passed',
      kind: 'screenshot',
      artifactId: 11,
      beforeArtifactId: 10,
    });
  });

  it('says a named test with no stored run is a test, with nothing to open', () => {
    expect(evidenceFor(line('Offsets never repeat.', 'Named test "offsets: never repeat" passed (exit 0).'), [AFTER])).toMatchObject({ kind: 'test', artifactId: null, testName: 'offsets: never repeat' });
  });

  it('opens the run at the section that ran the test, though every section lists the tests it skipped', () => {
    const output = (ran: string) => ['```', ...['offsets: never repeat', 'resume: acknowledged chunk'].map(t => (t === ran ? ` ✓ upload.test.ts > ${t} 41ms` : ` ↓ upload.test.ts > ${t}`)), '```'].join('\n');
    const md = `# Named tests\n\n## Passed: Offsets never repeat.\n\n${output('offsets: never repeat')}\n\n## Passed: A dropped upload resumes.\n\n${output('resume: acknowledged chunk')}\n`;
    const run = { id: 30, title: 'Named tests, run 7', kind: 'markdown', role: 'qa-test-run', url: null, md };

    expect(evidenceFor(line('A dropped upload resumes.', 'Named test \'resume: acknowledged chunk\' passed. https://app.example/dashboard/artifacts/30'), [run])).toMatchObject({ kind: 'test', artifactId: 30, anchor: 'passed-a-dropped-upload-resumes' });
  });

  it('names no kind when QA\'s words name neither a shot nor a test', () => {
    expect(evidenceFor(line('It is fast.', null, 'unverified'), [AFTER])).toEqual({ criterion: 'It is fast.', group: 'acceptance', status: 'unverified', kind: null, artifactId: null });
  });
});

describe('the small readers', () => {
  it('reads a shot title and a quoted test name', () => {
    expect(shotParts('Checkout, empty cart · desktop · after')).toEqual({ flow: 'Checkout, empty cart', viewport: 'desktop', side: 'after' });
    expect(testNameOf('Named test \'csv: one row per viewer\' passed in run 7.')).toBe('csv: one row per viewer');
    expect(testNameOf('Screenshot only.')).toBeNull();
  });

  it('numbers repeated headings and never reads a fenced line as one', () => {
    const sections = markdownSections('# Run\n\n## Passed: A\n\n```\n## not a heading\n```\n\n## Passed: A\n');

    expect(sections.map(s => s.anchor)).toEqual(['run', 'passed-a', 'passed-a-1']);
  });

  it('loads what the stored proof names, beside what the release cites', () => {
    expect(evidenceArtifactIdsOf({ verificationArtifactIds: [3, 4], evidence: [{ criteria: [{ artifactId: 9, beforeArtifactId: 3 }, { artifactId: null }] }] })).toEqual([3, 4, 9]);
  });
});
