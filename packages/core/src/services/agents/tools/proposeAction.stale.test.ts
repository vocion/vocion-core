import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the agent is told when a run did not go ahead because what it was
 * proposed on changed, and when an action ran on the person's word and has
 * one line of advice about what it found.
 */
vi.mock('@/libs/DB');
const outcome = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const propose = vi.hoisted(() => vi.fn(async () => ({ runId: 8710, outcome: 'created', ...outcome.value })));
vi.mock('@/services/ActionService', async importOriginal => ({ ...await importOriginal<typeof import('@/services/ActionService')>(), proposeAction: propose }));
vi.mock('../wikiDecision', () => ({ wikiPassagesUnread: async () => null }));
vi.mock('../owedDecision', () => ({ personSaidToDecide: async () => ({ said: true }) }));
const { runProposal } = await import('./proposeAction');
const ctx = { orgId: 'org', agentSlug: 'revenue-lead', userId: 'usr-avery', connectorSources: [], sourceKinds: {}, emit: vi.fn() } as unknown as RuntimeContext;
const req = { actionId: 'hubspot.update', input: { objectType: 'deals', objectId: '4812', properties: { dealstage: 'contractsent' } }, confidence: 0.9, rationale: 'Asked for', suggestedDecision: 'approve' as const, suggestedDecisionReason: 'Asked for' };

beforeEach(() => {
  propose.mockClear();
});

describe('a run held as stale is reported with its reason', () => {
  it('says it did not run, the line, and what changed, never a bare STALE', async () => {
    outcome.value = {
      status: 'stale',
      result: null,
      stale: { line: 'dealstage changed from presentationscheduled to closedwon since this was proposed', changed: [{ label: 'dealstage', from: 'presentationscheduled', to: 'closedwon' }], checkedAt: '2026-10-29T12:00:00.000Z', canRedraft: false, fingerprint: 'f' },
    };
    const text = await runProposal(ctx, req, { tool: 'propose_action' });

    expect(text).toContain('did NOT run');
    expect(text).toContain('dealstage changed from presentationscheduled to closedwon since this was proposed');
    expect(text).toContain('What changed: dealstage presentationscheduled to closedwon');
    expect(text).not.toMatch(/is STALE/);
  });
});

describe('advice from an action run on the person\'s word', () => {
  it('passes the action\'s one line to the agent to tell the person', async () => {
    outcome.value = { status: 'done', result: { enrolled: true, advice: 'Dana Whitfield was already in \'Q4 Nurture\'; it was replaced with \'AI-Readiness Nurture\'.' } };
    const text = await runProposal(ctx, req, { tool: 'propose_action' });

    expect(text).toContain('Tell the person, in one line: Dana Whitfield was already in \'Q4 Nurture\'; it was replaced with \'AI-Readiness Nurture\'.');
  });
});
