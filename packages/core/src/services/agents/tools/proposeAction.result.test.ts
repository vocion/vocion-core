import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const result = vi.hoisted(() => ({ status: 'failed', error: 'MCP writes require an explicit Review decision.' }));
const propose = vi.hoisted(() => vi.fn(async () => ({ runId: 8603, outcome: 'created', result: null, ...result })));
vi.mock('@/services/ActionService', async importOriginal => ({ ...await importOriginal<typeof import('@/services/ActionService')>(), proposeAction: propose }));
vi.mock('../wikiDecision', () => ({ wikiPassagesUnread: async () => null }));
vi.mock('../owedDecision', () => ({ personSaidToDecide: async () => ({ said: true }) }));
const { runProposal } = await import('./proposeAction');
const ctx = { orgId: 'org', agentSlug: 'bookkeeper', userId: 'owner', connectorSources: ['ledger'], sourceKinds: { ledger: 'mcp' }, emit: vi.fn() } as unknown as RuntimeContext;
const req = { actionId: 'mcp.call', input: { sourceSlug: 'ledger' }, confidence: 1, rationale: 'User correction', suggestedDecision: 'approve' as const, suggestedDecisionReason: 'User correction' };

describe('proposal result reported to the model', () => {
  beforeEach(() => {
    propose.mockClear();
    result.status = 'failed';
  });

  it('never labels a failed action DONE', async () => {
    const text = await runProposal(ctx, req, { tool: 'propose_action' });

    expect(text).toContain('FAILED');
    expect(text).toContain('explicit Review');
    expect(text).not.toContain('is DONE');
  });

  it('keeps explicit-Review actions as agent proposals even for an owner correction', async () => {
    result.status = 'pending';
    const text = await runProposal(ctx, req, { tool: 'propose_action' });

    expect(propose).toHaveBeenCalledWith(expect.objectContaining({ principal: expect.objectContaining({ kind: 'agent' }) }));
    expect(text).toContain('PENDING');
  });
});
