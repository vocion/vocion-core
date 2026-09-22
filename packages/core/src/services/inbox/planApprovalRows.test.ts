import { describe, expect, it } from 'vitest';
import { assertDecisionContract } from './decisionContract';
import { planApprovalContract, planApprovalDecision } from './planApproval';
import { planApprovalInputFrom } from './planApprovalRows';

/**
 * The half that reads the record. `planApprovalRows` itself needs a database,
 * so what is tested here is the part that decides what the row SAYS from the
 * plan's own metadata: the verdict is read back rather than recomputed, a
 * field the writer left out reads as absent rather than as satisfied, and the
 * result still satisfies the contract Review holds every item to.
 */

function planRow(meta: Record<string, unknown> = {}) {
  return {
    id: 31,
    title: 'Charge on the invoice, not on the seat',
    status: 'in_review',
    createdAt: new Date('2026-09-20T10:00:00Z'),
    metadata: {
      requestId: 12,
      ruleLevel: 'required',
      ruleTriggers: ['the risk class is billing, which is irreversible, trust bearing or an externally visible promise'],
      approach: 'Bill against the invoice the org already has.',
      alternatives: ['Per-seat proration on every change: rejected, it makes a refund out of an org chart edit'],
      verification: 'Change a seat count and show the invoice total unchanged until the cycle closes.',
      dataImpact: 'No migration.',
      taskIds: [77, 78],
      ...meta,
    },
  };
}

describe('a plan record, as the decision a person sees', () => {
  it('reads the rule verdict back off the record instead of recomputing it', () => {
    const input = planApprovalInputFrom(planRow(), 'Stop charging us when we move somebody between teams', false);

    expect(input.rule.level).toBe('required');
    expect(input.rule.triggers).toHaveLength(1);
    expect(input.rule.triggers[0]?.code).toBe('recorded');
    expect(planApprovalDecision(input).reason).toContain('the risk class is billing');
  });

  it('counts the tasks already written from the plan as the work held behind it', () => {
    const input = planApprovalInputFrom(planRow(), 'A request', false);

    expect(input.tasksWaiting).toBe(2);
    expect(planApprovalDecision(input).onNothing).toContain('2 tasks');
  });

  it('treats a field the writer left out as absent, not as answered', () => {
    const input = planApprovalInputFrom(planRow({ verification: '  ', alternatives: [] }), 'A request', false);

    expect(input.verification).toBeNull();
    expect(input.alternatives).toEqual([]);
    expect(planApprovalDecision(input).gaps).toHaveLength(2);
  });

  it('reads an unrecognised rule level as no plan required rather than guessing at required', () => {
    const input = planApprovalInputFrom(planRow({ ruleLevel: 'mandatory-ish' }), 'A request', false);

    expect(input.rule.level).toBe('not_required');
  });

  it('still produces a row Review will accept when the plan record is nearly empty', () => {
    const bare = { id: 9, title: 'An approach', status: 'in_review', createdAt: null, metadata: {} };
    const contract = planApprovalContract(planApprovalInputFrom(bare, 'A request nobody titled well', false));

    expect(() => assertDecisionContract(contract, { subject: 'plan 9' })).not.toThrow();
    expect(contract.actions.find(a => a.recommended)?.id).toBe('send-back');
  });

  it('says a plan decided after the work ran is a record rather than a gate', () => {
    const input = planApprovalInputFrom(planRow(), 'A request', true);
    const decision = planApprovalDecision(input);

    expect(decision.reason).toContain('has already run');
    expect(decision.blocking).toBe(false);
  });
});
