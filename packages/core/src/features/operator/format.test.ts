import { describe, expect, it } from 'vitest';
import { capLabel, centsFromDollars, lastSeen } from './format';

const cap = (spentCents: number, hardCentsLimit: number | null) => ({
  cap: { accountId: 'acct-northwind', spentCents, tokens: 0, hardCentsLimit, blocked: false, periodStartedAt: null, periodResetsAt: '2026-11-01T00:00:00.000Z' },
});

describe('the operator console readings', () => {
  it('reads a month against its cap, or says there is none', () => {
    expect(capLabel(cap(1234.5, 50_000))).toBe('$12.35 of $500.00');
    expect(capLabel(cap(0, null))).toBe('$0.00 · no cap');
  });

  it('turns typed dollars into whole cents, blank into "no cap", and refuses what is not an amount', () => {
    expect(centsFromDollars('500')).toBe(50_000);
    expect(centsFromDollars('$1,250.50')).toBe(125_050);
    expect(centsFromDollars('  ')).toBeNull();
    expect(centsFromDollars('-5')).toBeUndefined();
    expect(centsFromDollars('five')).toBeUndefined();
  });

  it('says "never" for someone never seen', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');

    expect(lastSeen(null, now)).toBe('never');
    expect(lastSeen('2026-10-07T09:00:00Z', now)).toBe('3 hours ago');
  });
});
