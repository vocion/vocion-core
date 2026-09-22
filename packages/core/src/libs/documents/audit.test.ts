import { describe, expect, it } from 'vitest';
import { evaluateDocument, footerBaseline, verificationChip, verificationReceipt } from './audit';

const sheet = (n: number, footerY: number | null, overflowPx = 0, clipped: string[] = []) => ({ n, label: `Sheet ${n}`, footerY, overflowPx, clipped });

describe('evaluateDocument', () => {
  it('passes a document whose footers agree, nothing overflows and the PDF matches', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 986), sheet(2, 984), sheet(3, 984)], pdfPages: 3, unresolvedAssets: [] });

    expect(v.ok).toBe(true);
    expect(v.footerAligned).toBe(true);
    expect(v.issues).toEqual([]);
    expect(verificationChip(v, 3)).toBe('3 sheets · verified');
  });

  it('names every class used with no rule, because each is a component drawn as a bare div', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 984)], pdfPages: 1, unresolvedAssets: [], undefinedClasses: ['ovcards', 'ovc', 'oht'] });

    expect(v.ok).toBe(false);
    expect(v.undefinedClasses).toEqual(['ovcards', 'ovc', 'oht']);
    expect(v.issues[0]).toContain('3 classes used with no rule');
    expect(v.issues[0]).toContain('ovcards, ovc, oht');
    expect(verificationReceipt(v, { images: false })).toContain('ovcards');
  });

  it('carries an empty class list through without a word about it', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 984)], pdfPages: 1, unresolvedAssets: [] });

    expect(v.undefinedClasses).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('names the sheet whose footer moved, and the overflow that moved it', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 984), sheet(2, 984), sheet(3, 1052, 68)], pdfPages: 3, unresolvedAssets: [] });

    expect(v.ok).toBe(false);
    expect(v.footerAligned).toBe(false);
    expect(v.issues.some(i => i.startsWith('Sheet 3 (Sheet 3): footer rule at 1052px'))).toBe(true);
    expect(v.issues.some(i => i.includes('overflows by 68px'))).toBe(true);
    expect(verificationChip(v, 3)).toBe('3 sheets · 2 issues');
  });

  it('flags a PDF whose page count disagrees with the sheet count', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 984), sheet(2, 984)], pdfPages: 3, unresolvedAssets: [] });

    expect(v.issues).toEqual(['The PDF has 3 pages for 2 sheets — a sheet is taller than one page or the @page size is off.']);
  });

  it('lists unresolved assets and clipped elements', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 984, 0, ['div.gantt "Week 4" (+12px)'])], pdfPages: 1, unresolvedAssets: ['../../deck/logo.svg'] });

    expect(v.issues).toHaveLength(2);
    expect(v.issues[0]).toContain('div.gantt');
    expect(v.issues[0]).toMatch(/extends past the sheet edge/);
    expect(v.issues[1]).toContain('did not load');
  });

  it('a document with no sheets is not paginated', () => {
    const v = evaluateDocument({ sheets: [], pdfPages: 1, unresolvedAssets: [] });

    expect(v.issues.some(i => i.includes('not paginated'))).toBe(true);
  });
});

describe('footerBaseline', () => {
  it('is the most common footer y, so one broken sheet cannot move it', () => {
    expect(footerBaseline([sheet(1, 984), sheet(2, 984), sheet(3, 1052), sheet(4, null)])).toBe(984);
    expect(footerBaseline([sheet(1, null)])).toBeNull();
  });
});

describe('verificationReceipt', () => {
  it('says the PDF was printed when it was, even with no page count', () => {
    const v = evaluateDocument({ sheets: [sheet(1, 984)], pdfPages: null, pdf: '/api/artifacts/x/y.pdf', unresolvedAssets: [] });

    expect(verificationReceipt(v)).toContain('PDF printed · page count unavailable');
  });

  it('is one summary line, then one line per issue, then the images when asked', () => {
    const v = evaluateDocument({ sheets: [{ ...sheet(1, 984), image: '/api/artifacts/x/1.png' }, sheet(2, 1000, 16)], pdfPages: 2, unresolvedAssets: [] });
    const text = verificationReceipt(v, { images: true });
    const lines = text.split('\n');

    expect(lines[0]).toBe('2 sheets · footers NOT aligned · PDF 2 pages · 2 issues');
    expect(lines.filter(l => l.startsWith('- '))).toHaveLength(2);
    expect(lines.at(-1)).toContain('/api/artifacts/x/1.png');
  });
});
