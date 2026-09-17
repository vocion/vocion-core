import type { ReviewRow } from '@/services/inbox/reviewRows';
import { describe, expect, it } from 'vitest';
import { describeActionRun } from '@/services/inbox/describeActionRun';
import { recordSheetView } from './recordSheetView';

function row(id: number, to: string): ReviewRow {
  const input = { to, subject: 'Fixture subject' };
  return {
    id,
    actionId: 'gmail.send',
    status: 'pending',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    decidedAt: null,
    decidedBy: null,
    snoozedUntil: null,
    note: null,
    assignedTo: null,
    input,
    proposal: null,
    described: describeActionRun({ id, actionId: 'gmail.send', input, proposal: null, invokedBy: 'agent:fixture-agent' }),
  };
}

describe('recordSheetView', () => {
  it('is an empty state, not a 404, when the record has no rows left', () => {
    const view = recordSheetView('email:someone@example.com', { open: [], decided: [] });

    expect(view).toEqual({ state: 'empty', label: 'someone@example.com' });
  });

  it('names a record it has never seen a row for', () => {
    expect(recordSheetView('hubspot:deals:7781', { open: [], decided: [] })).toEqual({ state: 'empty', label: 'Deal 7781' });
  });

  it('is a sheet while any row survives, open or decided', () => {
    const view = recordSheetView('email:someone@example.com', { open: [], decided: [row(1, 'someone@example.com')] });

    expect(view.state).toBe('sheet');
    expect(view).toMatchObject({ name: 'someone@example.com', title: 'someone@example.com — 0 proposals' });
  });

  it('counts the open rows in the title', () => {
    const view = recordSheetView('email:someone@example.com', { open: [row(1, 'someone@example.com'), row(2, 'someone@example.com')], decided: [] });

    expect(view).toMatchObject({ state: 'sheet', title: 'someone@example.com — 2 proposals' });
  });
});
