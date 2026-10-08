import type { ReviewRow } from '@/services/inbox/reviewRows';
import { describe, expect, it } from 'vitest';
import { PENDING_IN_CHAT_LIMIT, pendingDecisionCard, pendingDecisionCards } from './pendingDecisions';

/**
 * The review queue's open rows become the chat's cards — same run id, so the
 * card's Approve decides the queue's row (Jamie, 2026-10-07).
 */

function row(over: Partial<ReviewRow> & { id: number }): ReviewRow {
  return {
    actionId: 'objects.propose_candidate',
    status: 'pending',
    createdAt: new Date('2026-10-07T18:00:00Z'),
    decidedAt: null,
    decidedBy: null,
    snoozedUntil: null,
    note: null,
    assignedTo: null,
    input: { objectType: 'product', title: 'Northwind Traders' },
    proposal: { confidence: 0.8, rationale: 'Read from the repository.', suggestedDecision: 'approve', suggestedDecisionReason: 'The README names it.' },
    described: {
      title: 'Create product: Northwind Traders',
      subline: 'Product › proposed by product-manager',
      actionKind: 'Record',
      record: null,
      changes: [],
      amount: null,
      currency: null,
      confidence: 0.8,
      agentSlug: 'product-manager',
      rationale: 'Read from the repository.',
      evidence: [],
    },
    ...over,
  };
}

describe('pendingDecisionCard', () => {
  it('is the queue row as a filed card with its run id, so Approve decides the same run', () => {
    const card = pendingDecisionCard(row({ id: 7763 }));

    expect(card).toMatchObject({
      id: 'run:7763',
      runId: 7763,
      state: 'filed',
      kind: 'action',
      actionId: 'objects.propose_candidate',
      label: 'Create product: Northwind Traders',
      rationale: 'Read from the repository.',
      confidence: 0.8,
      agentSlug: 'product-manager',
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The README names it.',
      href: '/dashboard/inbox/proposal-7763',
    });
    expect(card!.input).toEqual({ objectType: 'product', title: 'Northwind Traders' });
  });

  it('is only a pending run: a failed run or a released hand-off is the queue\'s to close', () => {
    expect(pendingDecisionCard(row({ id: 1, status: 'failed' }))).toBeNull();
    expect(pendingDecisionCard(row({ id: 2, status: 'awaiting_execution' }))).toBeNull();
  });

  it('carries no suggestion when the proposal made none', () => {
    const card = pendingDecisionCard(row({ id: 3, proposal: null }));

    expect(card).not.toHaveProperty('suggestedDecision');
    expect(card).not.toHaveProperty('suggestedDecisionReason');
  });
});

describe('pendingDecisionCards', () => {
  it('keeps the queue\'s order and drops what is not a decision', () => {
    const cards = pendingDecisionCards([row({ id: 9 }), row({ id: 8, status: 'failed' }), row({ id: 7 })]);

    expect(cards.map(c => c.runId)).toEqual([9, 7]);
  });

  it('has a cap, so a long queue is a strip in chat and a link for the rest', () => {
    expect(PENDING_IN_CHAT_LIMIT).toBeGreaterThan(1);
  });
});
