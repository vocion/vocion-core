import { describe, expect, it } from 'vitest';
import { alignToContract, buildAgain, clipNote, contractOf, judgeVerdict, mergeSummary, noteWithoutCount, parseJsonArray, reachable } from './recordVerdict';

const proven = (criterion: string) => ({ criterion, status: 'proven' as const, evidence: 'https://example.com/shot.png' });

describe('judgeVerdict', () => {
  it('counts proven criteria itself', () => {
    const r = judgeVerdict('changes', [proven('a'), { criterion: 'b', status: 'unproven' }, { criterion: 'c', status: 'unchecked' }], []);

    expect(r).toEqual({ proven: 1, total: 3, refusal: null });
  });

  it('refuses an approve that carries an unproven criterion', () => {
    const r = judgeVerdict('approve', [proven('a'), { criterion: 'b', status: 'unproven' }], []);

    expect(r.refusal).toMatch(/^Not recorded: an approve cannot carry 1 criteria that are not proven \(1 of 2 proven; first: "b"\)/);
  });

  it('refuses an approve with a blocking finding', () => {
    const r = judgeVerdict('approve', [proven('a')], [{ against: 'path', ref: 'apps/**', severity: 'block', what: 'outside allowed paths' }]);

    expect(r.refusal).toMatch(/blocking finding/);
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
    expect(judgeVerdict('approve', alignToContract(contract, invented), []).refusal).toMatch(/0 of 3 proven/);
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
  it('never retries an attempt that was itself the automatic retry, and needs a request', async () => {
    expect(await buildAgain('org_x', { id: 165, meta: { requestId: 131, autoRetryOf: 164 } })).toMatch(/already the automatic retry/);
    expect(await buildAgain('org_x', { id: 165, meta: {} })).toBeNull();
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
