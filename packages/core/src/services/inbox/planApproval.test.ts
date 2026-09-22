import type { PlanApprovalInput } from './planApproval';
import { describe, expect, it } from 'vitest';
import { planRequirement } from '@/services/factory/planRule';
import { assertDecisionContract, isCompleteContract, MAX_WHY } from './decisionContract';
import { planApprovalContract, planApprovalDecision, planApprovalLines } from './planApproval';

/**
 * A plan approval is direction and tradeoffs, which is exactly what a person
 * should decide. These tests hold it to the four parts every decision in Review
 * owes a reader: the decision needed, the recommendation, the reason, and what
 * happens on yes, on no and on nothing.
 */

const required = planRequirement({ riskClass: 'billing', allowedPaths: ['apps/api/src/routes/**'] });

function input(over: Partial<PlanApprovalInput> = {}): PlanApprovalInput {
  return {
    planId: 31,
    planTitle: 'Charge on the invoice, not on the seat',
    approach: 'Bill against the invoice the org already has, so a seat change never moves money on its own.',
    alternatives: ['Per-seat proration on every change: rejected, it makes a refund out of an org chart edit'],
    verification: 'Change a seat count on the fixture org and show the invoice total unchanged until the cycle closes.',
    dataImpact: 'No migration. The invoice rows already carry the org.',
    requestTitle: 'Stop charging us when we move somebody between teams',
    rule: required,
    tasksWaiting: 0,
    workAlreadyRan: false,
    ...over,
  };
}

describe('the plan approval, as a decision', () => {
  it('states the decision, the recommendation, the reason, and yes, no and nothing', () => {
    const d = planApprovalDecision(input());

    expect(d.decision).toContain('Approve the approach for "Stop charging us when we move somebody between teams"');
    expect(d.decision).toContain('Charge on the invoice, not on the seat');
    expect(d.recommendation).toContain('Approve it');
    expect(d.reason).toContain('the risk class is billing');
    expect(d.onYes).toContain('the task contracts are written from it');
    expect(d.onNo).toContain('is not edited into a different one');
    expect(d.onNothing).toContain('nothing starts');
  });

  it('says on nothing that the work does not start, rather than letting a default happen quietly', () => {
    const d = planApprovalDecision(input());

    expect(d.onNothing).toContain('the work waits on you');
    expect(d.blocking).toBe(true);
  });

  it('counts the tasks already held behind it, because that is what waiting costs', () => {
    expect(planApprovalDecision(input({ tasksWaiting: 3 })).onNothing).toContain('3 tasks already written are held behind it');
    expect(planApprovalDecision(input({ tasksWaiting: 1 })).onNothing).toContain('1 task already written is held behind it');
    expect(planApprovalDecision(input()).onNothing).toContain('nothing is queued yet');
  });

  it('grounds the reason in the rule\'s own triggers rather than in a preference', () => {
    const many = planRequirement({ riskClass: 'schema', allowedPaths: ['apps/web/src/**', 'packages/core/migrations/**'] }, { taskCount: 3 });
    const d = planApprovalDecision(input({ rule: many }));

    expect(d.reason).toContain('the risk class is schema');
    expect(d.reason).toContain('an architectural boundary is being crossed');
    expect(d.reason).toContain('a database migration');
    expect(d.reason).toContain('3 engineering tasks sit under this request');
    expect(d.reason).toContain('Those triggers');
  });

  it('recommends sending back a plan that answers nothing, and names what is missing', () => {
    const d = planApprovalDecision(input({ alternatives: [], verification: null, dataImpact: null }));

    expect(d.recommendation).toContain('Send it back');
    expect(d.recommendation).toContain('3 things are missing');
    expect(d.gaps).toEqual([
      'Nothing is recorded as considered and rejected, so this reads as a first idea rather than a choice.',
      'The plan does not say how this will be verified, so the acceptance criteria will be guessed at.',
      'The plan does not say what happens to data that already exists. "None" is an answer; silence is not.',
    ]);
  });

  it('says plainly when a plan is being approved after the work already ran', () => {
    const d = planApprovalDecision(input({ workAlreadyRan: true }));

    expect(d.reason).toContain('Approving now records the approach; it does not gate it.');
    expect(d.blocking).toBe(false);
  });

  it('does not block, and says so, when the rule only offered a plan', () => {
    const offered = planRequirement({ riskClass: 'ui', allowedPaths: ['apps/web/src/**'] });
    const d = planApprovalDecision(input({ rule: offered }));

    expect(d.blocking).toBe(false);
    expect(d.reason).toContain('A plan was not required here');
    expect(d.reason).toContain('the risk class is ui and the work touches more than one file');
    expect(d.onNothing).toContain('the work is free to proceed without it');
  });

  it('is honest that a plan nobody asked for is a read rather than a gate', () => {
    const none = planRequirement({ riskClass: 'docs', allowedPaths: ['docs/A.md'] });

    expect(planApprovalDecision(input({ rule: none })).reason).toContain('this is a read rather than a gate');
  });

  it('estimates the minutes so a queue of decisions can be costed before it is opened', () => {
    expect(planApprovalDecision(input()).minutes).toBe(8);
    expect(planApprovalDecision(input({ alternatives: [] })).minutes).toBe(10);

    const heavy = planRequirement({ riskClass: 'infra', allowedPaths: ['apps/a/src/routes/**', 'packages/b/migrations/**'] }, { taskCount: 9, repos: ['a', 'b'] });

    expect(planApprovalDecision(input({ rule: heavy })).minutes).toBe(14);
  });
});

describe('the queue row', () => {
  it('leads with the decision, and says blocking, minutes and gaps before a person opens it', () => {
    const lines = planApprovalLines(input());

    expect(lines.title).toContain('Approve the approach');
    expect(lines.subline).toBe('Blocking · about 8 min · the plan answers everything it should');
  });

  it('carries all four parts in the body, in order, so nothing has to be opened to be understood', () => {
    const body = planApprovalLines(input({ alternatives: [] })).body;

    expect(body.indexOf('**The decision.**')).toBeLessThan(body.indexOf('**The recommendation.**'));
    expect(body.indexOf('**The recommendation.**')).toBeLessThan(body.indexOf('**Why.**'));
    expect(body.indexOf('**Why.**')).toBeLessThan(body.indexOf('**On yes.**'));
    expect(body.indexOf('**On yes.**')).toBeLessThan(body.indexOf('**On no.**'));
    expect(body.indexOf('**On no.**')).toBeLessThan(body.indexOf('**On nothing.**'));
    expect(body).toContain('**What the plan does not answer.**');
  });

  it('says a gap count on the row when the plan is incomplete', () => {
    expect(planApprovalLines(input({ verification: null })).subline).toContain('1 gap in the plan');
    expect(planApprovalLines(input({ verification: null, dataImpact: null })).subline).toContain('2 gaps in the plan');
  });
});

describe('the plan approval, as a Review row', () => {
  it('satisfies the decision contract Review holds every item to', () => {
    const contract = planApprovalContract(input());

    expect(() => assertDecisionContract(contract, { subject: 'plan 31' })).not.toThrow();
    expect(isCompleteContract(contract)).toBe(true);
  });

  it('makes what happens on nothing the cost of delay, because for a gate they are the same sentence', () => {
    const contract = planApprovalContract(input({ tasksWaiting: 2 }));

    expect(contract.impactOfDelay).toBe(planApprovalDecision(input({ tasksWaiting: 2 })).onNothing);
    expect(contract.impactOfDelay).toContain('nothing starts');
    expect(contract.impactOfDelay).toContain('2 tasks');
  });

  it('offers yes, no and send it back as choices a person picks, and recommends approving a complete plan', () => {
    const contract = planApprovalContract(input());

    expect(contract.actions.map(a => a.id)).toEqual(['approve', 'send-back', 'reject']);
    expect(contract.actions.find(a => a.recommended)?.id).toBe('approve');
    expect(contract.actions.find(a => a.id === 'approve')?.description).toContain('the task contracts are written from it');
  });

  it('recommends sending an incomplete plan back, and says on the action what is missing', () => {
    const contract = planApprovalContract(input({ verification: null }));

    expect(contract.actions.find(a => a.recommended)?.id).toBe('send-back');
    expect(contract.actions.find(a => a.id === 'send-back')?.description).toContain('how this will be verified');
  });

  it('keeps why to the strongest reasons rather than the whole case', () => {
    const contract = planApprovalContract(input({ approach: null, alternatives: [], verification: null, dataImpact: null }));

    expect(contract.why.length).toBeLessThanOrEqual(MAX_WHY);
    expect(contract.why[0]).toContain('the risk class is billing');
  });
});
