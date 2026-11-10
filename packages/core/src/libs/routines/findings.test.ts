import type { RoutineSpec } from './types';
import { describe, expect, it } from 'vitest';
import { findingCounts, findingMarks, findingsOf } from './findings';

const SPEC: Pick<RoutineSpec, 'steps' | 'rules' | 'questions' | 'escalations' | 'systems' | 'judgments' | 'sites'> = {
  steps: [{ n: 1, text: 'Search Users for the email', why: 'A person may already have an account', at: 14 }, { n: 2, text: 'Click Add user', why: null, at: null }],
  rules: [{ text: 'Never create a second account', at: 52 }],
  escalations: [{ when: 'the person is already enrolled', ask: 'whether to re-enroll', at: 130 }],
  questions: [{ id: 'q1', question: 'Should contractors be enrolled too?', why: 'Only employees were shown', at: 160 }],
  systems: ['console.northwind.example'],
  judgments: [{ text: 'Reads the search result before adding', at: 30 }],
  sites: [{ name: 'Training console', url: 'https://console.northwind.example/users', at: 6 }],
};

describe('findings from a spec', () => {
  it('lists each kind in order, with the moment it was found at', () => {
    const f = findingsOf(SPEC);

    expect(f.map(x => x.id)).toEqual(['step-1', 'step-2', 'system-1', 'rule-1', 'judgment-1', 'question-q1']);
    expect(f[0]).toMatchObject({ kind: 'step', n: 1, detail: 'A person may already have an account', at: 14 });
    expect(f[2]).toMatchObject({ kind: 'system', text: 'Training console', detail: 'https://console.northwind.example/users' });
    expect(findingCounts(f)).toEqual({ step: 2, system: 1, rule: 1, judgment: 1, question: 1 });
  });

  it('reads an older spec\'s escalation points as judgment calls and its hosts as systems', () => {
    const f = findingsOf({ ...SPEC, judgments: undefined, sites: undefined });

    expect(f.find(x => x.kind === 'judgment')).toMatchObject({ text: 'the person is already enrolled', detail: 'Asks the expert: whether to re-enroll', at: 130 });
    expect(f.find(x => x.kind === 'system')).toMatchObject({ text: 'console.northwind.example', at: null });
  });

  it('has nothing for nothing, and no judgment calls when the analyst found none', () => {
    expect(findingsOf(null)).toEqual([]);
    expect(findingsOf({ ...SPEC, judgments: [] }).some(x => x.kind === 'judgment')).toBe(false);
  });
});

describe('marks on the recording\'s track', () => {
  it('are the findings with a moment, in time order, each named for what it is', () => {
    const marks = findingMarks(findingsOf(SPEC), 212);

    expect(marks.map(m => [m.id, m.at])).toEqual([['system-1', 6], ['step-1', 14], ['judgment-1', 30], ['rule-1', 52], ['question-q1', 160]]);
    expect(marks[1]!.label).toBe('Step 1: Search Users for the email');
    expect(marks[0]!.label).toBe('Moves to: Training console');
  });

  it('drop a moment past the recording\'s end', () => {
    const marks = findingMarks(findingsOf(SPEC), 100);

    expect(marks.map(m => m.id)).not.toContain('question-q1');
    expect(findingMarks(findingsOf(SPEC), null)).toHaveLength(5);
  });
});
