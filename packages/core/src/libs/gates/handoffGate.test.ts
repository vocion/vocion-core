import { describe, expect, it } from 'vitest';
import { evaluateGates, gateRefusal, gatesOf, seatLabel } from './handoffGate';

const NOW = new Date('2026-09-24T12:00:00Z');
const decisionReady = {
  name: 'decision-ready',
  when: { field: 'state', becomes: ['in_scope'] },
  producedBy: 'product-manager',
  require: [
    { field: 'why', present: true },
    { field: 'product', present: true, message: 'name the product this is for' },
    { field: 'acceptance', minItems: 3 },
    { field: 'severity', oneOf: ['p1', 'p2', 'p3'] },
    { field: 'gapCheck.checkedAt', maxAgeDays: 14 },
  ],
};

describe('a declared gate', () => {
  it('refuses the transition and names every missing thing, in the seat\'s terms', () => {
    const f = evaluateGates([decisionReady], { state: 'triaged', why: ['user_request'] }, { state: 'in_scope', acceptance: [{ statement: 'a' }] }, NOW);

    expect(f?.gate.name).toBe('decision-ready');
    expect(f?.failed.map(x => x.field)).toEqual(['product', 'acceptance', 'severity', 'gapCheck.checkedAt']);
    expect(f?.failed[0]!.why).toBe('name the product this is for');
    expect(f?.failed[1]!.why).toBe('acceptance has 1 item; at least 3 needed');
    expect(gateRefusal(f!, 'Request')).toContain('Returned to PM');
  });

  it('lets a complete record through, ignores writes that are not the transition, and ages a check', () => {
    const complete = { why: ['user_request'], product: 'send', acceptance: [{}, {}, {}], severity: 'p2', gapCheck: { checkedAt: '2026-09-20T00:00:00Z' } };

    expect(evaluateGates([decisionReady], { state: 'triaged' }, { state: 'in_scope', ...complete }, NOW)).toBeNull();
    expect(evaluateGates([decisionReady], { state: 'in_scope' }, { state: 'in_scope', priority: 50 }, NOW)).toBeNull();
    expect(evaluateGates([decisionReady], { state: 'triaged' }, { priority: 50 }, NOW)).toBeNull();
    expect(evaluateGates([decisionReady], { state: 'triaged' }, { state: 'in_scope', ...complete, gapCheck: { checkedAt: '2026-08-01T00:00:00Z' } }, NOW)?.failed[0]!.why)
      .toBe('gapCheck.checkedAt is 54 days old; it has to be within 14');
  });

  it('reads gates off a stored schema and names seats short', () => {
    expect(gatesOf({ 'x-gates': [decisionReady] })).toHaveLength(1);
    expect(gatesOf({ properties: {} })).toEqual([]);
    expect(['product-manager', 'designer', 'send-engineer', 'change-reviewer'].map(seatLabel)).toEqual(['PM', 'Design', 'Eng', 'QA']);
  });
});
