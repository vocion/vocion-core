import { describe, expect, it } from 'vitest';
import { PRACTICE_EXAMPLE, PRACTICE_INVOICES, PRACTICE_ORIGIN, practiceResponse } from './practiceSite';

describe('the practice site', () => {
  it('answers every path on its own origin with the one page, and nothing else', () => {
    expect(practiceResponse(`${PRACTICE_ORIGIN}/login`)?.status).toBe(200);
    expect(practiceResponse(`${PRACTICE_ORIGIN}/invoices?status=Open`)?.body).toContain('FS-10644');
    expect(practiceResponse('https://example.com/login')).toBeNull();
    expect(practiceResponse('not a url')).toBeNull();
  });

  it('owes the example a fixed answer a test can check', () => {
    const unpaid = PRACTICE_INVOICES.filter(i => i.status !== 'Paid');

    expect(unpaid.map(i => i.no)).toEqual(['FS-10563', 'FS-10598', 'FS-10644', 'FS-10659', 'FS-10673']);
    expect(Math.round(unpaid.reduce((a, i) => a + i.amount, 0) * 100) / 100).toBe(40_689.35);
    expect(PRACTICE_EXAMPLE.secretInputs).toEqual(['password']);
  });
});
