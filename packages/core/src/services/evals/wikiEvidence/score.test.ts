/**
 * The wiki-evidence eval's grader: no model, regexes on the answer.
 */
import { describe, expect, it } from 'vitest';
import { EVIDENCE_QUESTIONS } from './dataset';
import { citedDocs, grade, jaccardConsistency } from './score';

const perDiem = EVIDENCE_QUESTIONS.find(q => q.id === 'c-per-diem')!;

describe('grade', () => {
  it('scores the current answer correct and a stale one stated as current a contradiction', () => {
    expect(grade(perDiem, 'The domestic per diem is $75 a day [src:102.1].').correct).toBe(true);

    const stale = grade(perDiem, 'The domestic per diem is $60 a day [src:101.0].');

    expect(stale.contradiction).toBe(true);
    expect(stale.accuracy).toBe(0);
  });

  it('does not penalise naming the old value as old', () => {
    const g = grade(perDiem, 'It is $75 a day [src:102.1]. The wiki still says $60, from the replaced 2025 policy.');

    expect(g.contradiction).toBe(false);
    expect(g.correct).toBe(true);
  });
});

describe('citations', () => {
  it('reads cited documents and their consistency across repeats', () => {
    expect(citedDocs('a [src:1.0] b [src:2] c [src:1.3]')).toEqual([1, 2]);
    expect(jaccardConsistency([[1, 2], [1, 2], [1]])).toBeCloseTo((1 + 0.5 + 0.5) / 3);
    expect(jaccardConsistency([[], []])).toBe(0);
  });
});
