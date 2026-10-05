import { describe, expect, it } from 'vitest';
import { samplePdf } from './samplePdf';

describe('the sample PDF the live browser uploads', () => {
  it('is a real one-page PDF with a working cross-reference table', () => {
    const pdf = samplePdf(0).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);

    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);

    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const firstOffset = Number(/\n(\d{10}) 00000 n \n/.exec(pdf)![1]);

    expect(pdf.slice(firstOffset, firstOffset + 7)).toBe('1 0 obj');
  });

  it('weighs about what was asked, and says what is on the page', () => {
    const pdf = samplePdf(50_000, 'Northwind board deck (sample)');

    expect(Math.abs(pdf.length - 50_000)).toBeLessThan(64);
    expect(pdf.toString('latin1')).toContain('(Northwind board deck  sample ) Tj');
  });
});
