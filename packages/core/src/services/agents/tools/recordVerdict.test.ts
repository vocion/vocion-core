import { describe, expect, it } from 'vitest';
import { judgeVerdict, mergeSummary } from './recordVerdict';

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
