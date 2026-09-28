/**
 * A proposal that ran within bounds and made a record says WHICH record, with
 * the page it opens on — and puts the link up as a typed event so the turn
 * links it even when the model does not (conversation 349, 2026-09-28: the
 * agent said "approving it is what writes the record" of a kind that files
 * without approval).
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({
    runId: 7,
    status: 'done',
    outcome: 'created',
    result: { mode: 'recorded', objectId: 131, objectType: 'request', title: 'Export the viewer list as a CSV', status: 'approved' },
  })),
}));

vi.mock('@/services/objects/recordHref', () => ({
  recordHref: vi.fn(async (_org: string, ref: { objectType: string; id: number }) => `/w/northwind/dashboard/p/feature/${ref.id}`),
}));

const { createdRecordOf, proposeActionTool } = await import('./proposeAction');

describe('a DONE proposal that made a record', () => {
  it('names the record and its page, and emits the link', async () => {
    const events: Array<{ type: string; record?: unknown }> = [];
    const ctx = { orgId: 'org_done_link', agentSlug: 'product-manager', userId: 'user_1', conversationId: 1, emit: (e: { type: string }) => events.push(e) } as unknown as RuntimeContext;
    const said = await proposeActionTool(ctx).invoke({
      action_id: 'objects.propose_candidate',
      action_input: { objectType: 'request', title: 'Export the viewer list as a CSV' },
      confidence: 0.8,
      rationale: 'Asked for in chat.',
      suggested_decision: 'approve',
      suggested_decision_reason: 'Asked for directly by the product owner.',
    });

    expect(said).toContain('is DONE: filed as request #131 (run #7, confidence 0.8), open at /w/northwind/dashboard/p/feature/131.');
    expect(said).toContain('the record exists now; no approval is pending');
    expect(said).toContain('[request #131](/w/northwind/dashboard/p/feature/131)');
    expect(events).toContainEqual({
      type: 'record_created',
      record: { type: 'object', id: '131', label: 'request #131 — Export the viewer list as a CSV', href: '/w/northwind/dashboard/p/feature/131' },
    });
  });

  it('reads a created record only off a result that names one', () => {
    expect(createdRecordOf({ objectId: 5, objectType: 'request', title: 'T' })).toEqual({ id: 5, objectType: 'request', title: 'T' });
    expect(createdRecordOf({ ok: true })).toBeNull();
    expect(createdRecordOf(undefined)).toBeNull();
  });
});
