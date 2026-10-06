import { describe, expect, it } from 'vitest';
import { heroPictures } from './heroPictures';

const shot = (id: number, section: 'QA after' | 'QA before' | 'Mockup' | 'Today', role = 'qa-screenshot') => ({ id, imageUrl: `/api/artifacts/${id}/shot.png`, url: `/dashboard/artifacts/${id}`, section, role });

describe('the pictures that lead a feature page (Chris, 2026-10-04: just enough to show it works)', () => {
  const pictures = [shot(1001, 'QA after'), shot(1002, 'QA after'), shot(1003, 'QA after'), shot(1004, 'QA after'), shot(1005, 'QA after'), shot(1006, 'QA before'), shot(900, 'Mockup', 'mockup')];

  it('shows the picture QA cited for each judged line, once, in the contract\'s order', () => {
    const out = heroPictures(pictures, [
      { state: 'passed', evidence: 'Screenshot 1003: three rows ticked, the bar says 3 selected', evidenceUrl: null },
      { state: 'passed', evidence: 'artifact #1001 shows the filled stars', evidenceUrl: '/dashboard/artifacts/1001' },
      { state: 'failed', evidence: null, evidenceUrl: '/api/artifacts/1005/shot.png' },
      { state: 'passed', evidence: 'the same 1003 picture', evidenceUrl: null },
      { state: 'unverified', evidence: '1002 would show it', evidenceUrl: null },
    ]);

    // The mockup stays after what QA cited (Chris, 2026-10-06: "missing the mocks").
    expect(out.map(p => p.id)).toEqual([1003, 1001, 1005, 900]);
  });

  it('a citation of a copy the page did not keep names the picture it kept (FE-472: QA cited 4135, the page kept 4136)', () => {
    const kept = [{ ...shot(4136, 'QA after'), sameAs: [4135] }, shot(4141, 'QA after')];
    const out = heroPictures(kept, [{ state: 'passed', evidence: 'Screenshot 4135 shows the chip on', evidenceUrl: null }]);

    expect(out.map(p => p.id)).toEqual([4136]);
  });

  it('never mistakes a small number in a sentence for a picture', () => {
    const out = heroPictures(pictures, [{ state: 'passed', evidence: '3 rows ticked, the bar says 3 selected (named test bulk.test.ts)', evidenceUrl: null }]);

    expect(out.map(p => p.id)).toEqual([1001, 1002, 1003, 1004, 900]);
  });

  it('before a verdict: the pictures that are not QA\'s, plus a few after-shots, in the page\'s order', () => {
    const out = heroPictures(pictures, []);

    expect(out.map(p => p.id)).toEqual([1001, 1002, 1003, 1004, 900]);
    expect(out.some(p => p.section === 'QA before')).toBe(false);
  });
});
