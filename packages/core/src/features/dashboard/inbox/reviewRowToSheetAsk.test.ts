import type { ReviewRow } from '@/services/inbox/reviewRows';
import { describe, expect, it } from 'vitest';
import { reviewRowToSheetAsk } from './reviewRowToSheetAsk';

const row: ReviewRow = {
  id: 565,
  actionId: 'gmail.send',
  status: 'pending',
  createdAt: new Date('2026-09-10T12:00:00Z'),
  decidedAt: null,
  decidedBy: null,
  snoozedUntil: null,
  note: null,
  assignedTo: null,
  input: { to: 'amy@northwind.example', subject: 'Intros', body: 'Amy,\n\nTwo intros as promised.', draft: true },
  proposal: { rationale: 'Transcript confirms Amy offered two intros as the next step.', confidence: 0.85, suggestedDecision: 'approve' },
  described: {
    title: 'Draft email to amy@northwind.example — Intros',
    subline: 'Email draft › recommended by revenue-lead',
    actionKind: 'Email',
    record: { kind: 'email', key: 'email:amy@northwind.example', name: 'amy@northwind.example' },
    changes: [{ field: 'subject', to: 'Intros' }],
    amount: null,
    currency: null,
    confidence: 0.85,
    agentSlug: 'revenue-lead',
    rationale: 'Transcript confirms Amy offered two intros as the next step.',
    evidence: [],
  },
};

describe('reviewRowToSheetAsk', () => {
  it('keeps the reason out of the body — the sheet renders it first and in full, never as an italic afterthought', () => {
    const ask = reviewRowToSheetAsk(row);

    expect(ask.body).not.toContain('_Transcript');
    expect(ask.body).not.toContain('Transcript confirms');
    expect(ask.body).toContain('Confidence');
    // The raw payload stays a detail for engineers, not the lede.
    expect(ask.contextMd).toContain('Payload');
    expect(ask.options.find(o => o.id === 'approve')?.recommended).toBe(true);
  });
});
