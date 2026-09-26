import { describe, expect, it } from 'vitest';
import { alignToContract, contractOf, judgeVerdict, mergeSummary, parseJsonArray } from './recordVerdict';

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
