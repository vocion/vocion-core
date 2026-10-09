/**
 * DONE, WITH UNDO ONLY WHERE IT IS REAL. A proposal that ran inside the trust
 * bar puts one receipt line under the turn, and promises Undo only when the
 * action's kind defines one. "A person can undo it from the Review queue's
 * Decided tab" used to follow every done run — including a filed candidate,
 * which `undoAction` refuses as NOT_REVERSIBLE. Fixtures are fictional
 * (Northwind).
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const proposeAction = vi.fn();
vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: (...a: unknown[]) => proposeAction(...a),
}));
vi.mock('@/services/objects/recordHref', () => ({
  recordHref: vi.fn(async (_org: string, ref: { objectType: string; id: number }) => `/w/northwind/dashboard/p/feature/${ref.id}`),
}));
vi.mock('@/services/objects/followers', () => ({ followFromAction: vi.fn(async () => {}) }));

const { proposeActionTool } = await import('./proposeAction');
const { actionIsUndoable } = await import('@/libs/actions/undoable');

function ctxWith(events: Array<{ type: string; receipt?: unknown }>): RuntimeContext {
  return { orgId: 'org_done_receipt', agentSlug: 'revenue-lead', userId: 'usr-dana', conversationId: 1, emit: (e: { type: string }) => events.push(e) } as unknown as RuntimeContext;
}

const call = (action_id: string, action_input: Record<string, unknown>) => ({
  action_id,
  action_input,
  confidence: 0.9,
  rationale: 'Asked for in chat.',
  suggested_decision: 'approve' as const,
  suggested_decision_reason: 'The person asked for it.',
});

beforeEach(() => {
  proposeAction.mockReset();
});

describe('the Done receipt', () => {
  it('knows which kinds can be put back, from the action\'s own definition', () => {
    expect(actionIsUndoable('objects.update_meta')).toBe(true);
    expect(actionIsUndoable('hubspot.update')).toBe(true);
    expect(actionIsUndoable('gmail.send')).toBe(false);
    expect(actionIsUndoable('objects.propose_candidate')).toBe(false);
    expect(actionIsUndoable('no.such_action')).toBe(false);
  });

  it('a filed record (no undo) is Done with no Undo, and the agent is told not to offer one', async () => {
    proposeAction.mockResolvedValue({ runId: 7, status: 'done', outcome: 'created', result: { created: true, objectId: 131, objectType: 'request', title: 'Export the viewer list' } });
    const events: Array<{ type: string; receipt?: unknown }> = [];
    const said = await proposeActionTool(ctxWith(events)).invoke(call('objects.propose_candidate', { objectType: 'request', title: 'Export the viewer list' }));

    expect(said).not.toContain('can undo');
    expect(said).toContain('It cannot be undone');
    expect(events.find(e => e.type === 'receipt')?.receipt).toEqual({ runId: 7, actionId: 'objects.propose_candidate', label: 'Filed request #131 — Export the viewer list', undoable: false, href: '/w/northwind/dashboard/p/feature/131' });
  });

  it('a change that can be put back is Done with Undo, said once', async () => {
    proposeAction.mockResolvedValue({ runId: 8, status: 'done', outcome: 'executed', result: { ok: true } });
    const events: Array<{ type: string; receipt?: unknown }> = [];
    const said = await proposeActionTool(ctxWith(events)).invoke(call('hubspot.update', { objectType: 'deal', id: '4410', properties: { dealstage: 'negotiation' } }));

    expect(said).toContain('A person can undo it from the Done line under this turn');
    expect(events.filter(e => e.type === 'receipt')).toEqual([{ type: 'receipt', receipt: expect.objectContaining({ runId: 8, actionId: 'hubspot.update', undoable: true }) }]);
  });

  it('a proposal that waits on a person is no receipt — it is a card', async () => {
    proposeAction.mockResolvedValue({ runId: 9, status: 'pending', outcome: 'created' });
    const events: Array<{ type: string }> = [];
    await proposeActionTool(ctxWith(events)).invoke(call('gmail.send', { to: 'pat@northwind.example', subject: 'Renewal', body: 'Hi Pat' }));

    expect(events.some(e => e.type === 'receipt')).toBe(false);
    expect(events.some(e => e.type === 'card')).toBe(true);
  });
});
