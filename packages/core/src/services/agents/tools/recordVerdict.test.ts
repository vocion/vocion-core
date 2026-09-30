import { describe, expect, it } from 'vitest';
import { alignToContract, buildAgain, clipNote, contractOf, judgeVerdict, mergeSummary, noteWithoutCount, parseJsonArray, reachable, sendBackRoute } from './recordVerdict';

const proven = (criterion: string) => ({ criterion, status: 'proven' as const, evidence: 'https://example.com/shot.png' });

describe('judgeVerdict', () => {
  it('counts proven criteria itself', () => {
    const r = judgeVerdict('changes', [proven('a'), { criterion: 'b', status: 'unproven' }, { criterion: 'c', status: 'unchecked' }], []);

    expect(r).toEqual({ proven: 1, total: 3, refusal: null });
  });

  it('records an approve that carries an unproven criterion as changes, never a refusal (#130 review 9025)', () => {
    const r = judgeVerdict('approve', [proven('a'), { criterion: 'b', status: 'unproven' }], []);

    expect(r.refusal).toBeNull();
    expect(r.value).toBe('changes');
    expect(r.recordedAs).toMatch(/^Recorded as changes, not approve: 1 of 2 criteria are not proven \(first: "b"\)/);
  });

  it('records an approve with a blocking finding as changes', () => {
    const r = judgeVerdict('approve', [proven('a')], [{ against: 'check', ref: 'test', severity: 'block', what: 'the suite fails' }]);

    expect(r.refusal).toBeNull();
    expect(r.value).toBe('changes');
    expect(r.recordedAs).toMatch(/blocking finding/);
  });

  it('refuses proven without evidence, and an empty criteria list', () => {
    expect(judgeVerdict('changes', [{ criterion: 'a', status: 'proven' }], []).refusal).toMatch(/marked proven with no evidence/);
    expect(judgeVerdict('approve', [], []).refusal).toMatch(/every acceptance criterion/);
  });

  it('accepts an approve where everything is proven', () => {
    expect(judgeVerdict('approve', [proven('a'), proven('b')], [{ against: 'criterion', ref: 'a', severity: 'note', what: 'copy nit' }])).toEqual({ proven: 2, total: 2, refusal: null });
  });
});

describe('mergeSummary', () => {
  it('leads with the note and the count, then every criterion', () => {
    const s = mergeSummary('Adds search to the library.', [proven('A search box narrows the list'), { criterion: 'URL keeps state', status: 'unchecked' }], 1);

    expect(s.split('\n')).toEqual([
      'Adds search to the library.',
      '',
      'QA: 1 of 2 criteria proven.',
      '- Proven: A search box narrows the list (https://example.com/shot.png)',
      '- Unchecked: URL keeps state',
    ]);
  });
});

describe('parseJsonArray', () => {
  it('reads a list sent as JSON text, and refuses what is not a list', () => {
    expect(parseJsonArray('[{"criterion":"a","status":"unproven"}]')).toEqual([{ criterion: 'a', status: 'unproven' }]);
    expect(parseJsonArray([1])).toEqual([1]);
    expect(parseJsonArray('{"a":1}')).toEqual([]);
    expect(parseJsonArray('not json')).toEqual([]);
    expect(parseJsonArray(undefined)).toEqual([]);
  });
});

describe('alignToContract', () => {
  const contract = [
    'A search box above the library narrows the list as you type, matching title and file name.',
    'Matches are highlighted and the count reads \'N of M\'.',
    'The query and filter live in the URL, so Back and a shared link keep them.',
  ];

  it('grades the contract, not the criteria the reviewer wrote: invented lines cannot approve, even as many as the contract has', () => {
    const invented = [proven('Type-to-filter works'), proven('Non-matches are hidden'), proven('Clearing restores the list')];

    expect(alignToContract(contract, invented).map(c => c.status)).toEqual(['unchecked', 'unchecked', 'unchecked']);

    const graded = judgeVerdict('approve', alignToContract(contract, invented), []);

    expect(graded.value).toBe('changes');
    expect(graded.recordedAs).toMatch(/3 of 3 criteria are not proven/);
  });

  it('pairs by text in any order, and a line nobody judged is unchecked', () => {
    const judged = [
      { criterion: 'The query and filter live in the URL, so Back and a shared link keep them.', status: 'unproven' as const },
      proven('A search box above the library narrows the list as you type'),
    ];

    expect(alignToContract(contract, judged)).toEqual([
      { criterion: contract[0], status: 'proven', evidence: 'https://example.com/shot.png' },
      { criterion: contract[1], status: 'unchecked' },
      { criterion: contract[2], status: 'unproven' },
    ]);
  });

  it('reads the contract as strings or statements', () => {
    expect(contractOf({ acceptanceContract: ['a line', { statement: 'b line' }, '', 3] })).toEqual(['a line', 'b line']);
    expect(contractOf({})).toEqual([]);
  });
});

describe('buildAgain', () => {
  it('retries a retry too, bounded by the per-stage limit, and needs a request (2026-09-30)', async () => {
    expect(await buildAgain('org_x', { id: 165, meta: { requestId: 131, autoRetryOf: 164 } }) ?? '').not.toMatch(/already the automatic retry/);
    expect(await buildAgain('org_x', { id: 165, meta: {} })).toBeNull();
  });

  it('a retry may still send its work back to planning: that is a different step, bounded by the request\'s limit', async () => {
    const res = await buildAgain('org_x', { id: 238, meta: { requestId: 224, autoRetryOf: 237, planId: 236 } }, { to: 'plan', why: 'a criterion stayed unproven on two attempts' });

    expect(res ?? '').not.toMatch(/already the automatic retry/);
  });
});

describe('clipNote', () => {
  it('keeps a short note and clips a long one at a word, never refusing it (review 5710)', () => {
    expect(clipNote('Short.')).toBe('Short.');

    const long = clipNote(`${'word '.repeat(110)}end`);

    expect(long.length).toBeLessThanOrEqual(400);
    expect(long.endsWith('word…')).toBe(true);
  });
});

describe('noteWithoutCount', () => {
  it('drops a count the reviewer wrote, keeps the words, and leaves a note with no count alone', () => {
    expect(noteWithoutCount('4 of 6 criteria proven; C3, C4 and C5 remain unproven.')).toBe('C3, C4 and C5 remain unproven.');
    expect(noteWithoutCount('0 of 8 frozen criteria proven: no screenshot of the empty state.')).toBe('No screenshot of the empty state.');
    expect(noteWithoutCount('Adds search; the one risk is the debounce.')).toBe('Adds search; the one risk is the debounce.');
  });
});

describe('reachable evidence', () => {
  it('accepts a link or a named test, and refuses a caption', () => {
    expect(reachable('https://agents.example/dashboard/artifacts/733')).toBe(true);
    expect(reachable('documents-search.test.ts, describe(\'scope: kept-back\')')).toBe(true);
    expect(reachable('qaReport (run 374): the empty state reads No documents match')).toBe(false);
    expect(reachable('Artifacts 978/979 show the list narrowing as text is typed')).toBe(true);
    expect(reachable('artifact #949')).toBe(true);
    // The task's own screenshot, cited by its bare number (review 5737); any other number is not evidence.
    expect(reachable('1008: query \'msa\' narrows 3 results to 1', new Set([1006, 1008]))).toBe(true);
    expect(reachable('1008: query \'msa\' narrows 3 results to 1')).toBe(false);
    expect(reachable('3 results narrow to 1', new Set([1006, 1008]))).toBe(false);
    expect(judgeVerdict('changes', [{ criterion: 'Empty state offers Clear', status: 'proven', evidence: 'the caption says Clear is visible' }], []).refusal).toMatch(/a description, not evidence/);
  });
});

describe('sendBackRoute — a send-back goes to the engineer or back to planning', () => {
  const c = (criterion: string, status: 'proven' | 'unproven') => ({ criterion, status });

  it('goes to the engineer by default', () => {
    expect(sendBackRoute({ criteria: [c('Every row has the control', 'unproven')], planId: 236, previous: null }).to).toBe('engineer');
  });

  it('goes to planning when QA says the plan stands in the way', () => {
    expect(sendBackRoute({ asked: 'plan', why: 'The plan never names the library page.', criteria: [], planId: 236 })).toEqual({ to: 'plan', why: 'The plan never names the library page.' });
  });

  it('goes to planning when the same criterion stays open two attempts running under one plan, whatever QA said', () => {
    const route = sendBackRoute({ asked: 'engineer', criteria: [c('A visible confirmation appears', 'unproven'), c('Every row has the control', 'unproven')], planId: 236, previous: { planId: 236, criteria: [c('A visible confirmation appears', 'unproven'), c('Every row has the control', 'proven')] } });

    expect(route.to).toBe('plan');
    expect(route.why).toContain('"A visible confirmation appears"');
  });

  it('a repeat under a different plan is a new plan\'s first try, not a repeat', () => {
    expect(sendBackRoute({ criteria: [c('A', 'unproven')], planId: 236, previous: { planId: 136, criteria: [c('A', 'unproven')] } }).to).toBe('engineer');
  });
});
