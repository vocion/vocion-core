/**
 * What the person told the agent to do runs as theirs — no card (Chris,
 * 2026-09-29, #246: "Chris said open so open … Stop making this so
 * complicated"). Whether they told it to is a model's reading of their words
 * (`turnJudge.saidToDecide`), stated here per case.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const consent = vi.hoisted(() => ({ said: false }));
vi.mock('../turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('../turnJudge')>();
  return { ...real, saidToDecide: vi.fn(async () => ({ said: consent.said, quote: null })) };
});
vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 51, status: 'done', outcome: 'created', result: { requestId: 246 } })),
}));

const { proposeAction } = await import('@/services/ActionService');
const { runProposal } = await import('./proposeAction');

const ctx = { orgId: 'org_person_word', userId: 'usr-chris', agentSlug: 'product-manager', conversationId: 9, connectorSources: [], objectTypeSlugs: [], turnMessage: 'restart request 246', emit: () => {} } as unknown as RuntimeContext;
const restart = { actionId: 'factory.dispatch_task', input: { requestId: 246 }, confidence: 0.8, rationale: 'The person asked to restart it.', suggestedDecision: 'approve' as const, suggestedDecisionReason: 'Asked for.' };

describe('an action the person told the agent to take', () => {
  beforeEach(() => {
    vi.mocked(proposeAction).mockClear();
  });

  it('is proposed as the person — it runs, with undo, and no card', async () => {
    consent.said = true;

    const out = await runProposal(ctx, restart, { tool: 'propose_action' });

    expect(vi.mocked(proposeAction).mock.calls[0]![0]).toMatchObject({ principal: { kind: 'user', id: 'usr-chris' }, invokedBy: 'usr-chris' });
    expect(out).toContain('as the person asked');
  });

  it('is the agent proposal when the person did not say so', async () => {
    consent.said = false;

    await runProposal(ctx, restart, { tool: 'propose_action' });

    expect(vi.mocked(proposeAction).mock.calls[0]![0]).toMatchObject({ principal: { kind: 'agent' } });
  });
});
