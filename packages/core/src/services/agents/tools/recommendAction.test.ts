/**
 * `recommend_action` — what the card it emits says about itself.
 *
 * The rule under test: the agent, not core, answers "what should a reviewer do
 * with this". A card filed from one of these events goes into the review queue
 * with whatever recommendation stands on it, and that recommendation is scored
 * against the decision a person then takes. Core used to write an "approve" on
 * every one, which the agreement rate read as the agent's own view.
 */
import type { AgentEvent, RuntimeContext } from '../types';
import { describe, expect, it } from 'vitest';
import { recommendActionTool } from './recommendAction';

/** The langchain tool union's overloads defeat direct .invoke() typing. */
type Invokable = { invoke: (input: Record<string, unknown>) => Promise<string> };

function ctxWithSink(sink: AgentEvent[]): RuntimeContext {
  return {
    orgId: 'org_rec',
    userId: 'user-1',
    agentSlug: 'revenue-lead',
    connectorSources: [],
    objectTypeSlugs: [],
    searchConfig: {},
    harnessConfig: {},
    emit: (event: AgentEvent) => {
      sink.push(event);
    },
    citationSeq: { current: 0 },
  } as unknown as RuntimeContext;
}

const baseArgs = {
  action_id: 'gmail.send',
  action_input: { to: 'buyer@acme.com', subject: 'Following up', body: 'Short note.', draft: true },
  label: 'Draft the note to the buyer',
  rationale: 'The renewal is 11 days out.',
  confidence: 0.8,
};

describe('recommend_action', () => {
  it('carries the agent\'s own verdict and sentence onto the recommendation', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as Invokable;

    await tool.invoke({
      ...baseArgs,
      suggested_decision: 'approve',
      suggested_decision_reason: 'Nobody has replied to the last thread and the renewal is close.',
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'recommended_action',
      recommendation: {
        actionId: 'gmail.send',
        suggestedDecision: 'approve',
        suggestedDecisionReason: 'Nobody has replied to the last thread and the renewal is close.',
      },
    });
  });

  it('carries a verdict that is not an approve, so an agent can surface work it thinks should wait', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as Invokable;

    await tool.invoke({
      ...baseArgs,
      suggested_decision: 'snooze',
      suggested_decision_reason: 'Worth sending, but not before the contract is countersigned.',
    });

    expect(events[0]).toMatchObject({
      recommendation: { suggestedDecision: 'snooze', suggestedDecisionReason: 'Worth sending, but not before the contract is countersigned.' },
    });
  });

  it('refuses a recommendation that states no verdict, rather than letting core pick one', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as Invokable;

    await expect(tool.invoke({ ...baseArgs, suggested_decision_reason: 'It is time.' })).rejects.toThrow(/suggested_decision/);
    expect(events).toHaveLength(0);
  });

  it('refuses a verdict with no sentence a reviewer could check', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as Invokable;

    await expect(tool.invoke({ ...baseArgs, suggested_decision: 'approve' })).rejects.toThrow(/suggested_decision_reason/);
    expect(events).toHaveLength(0);
  });

  it('refuses a verdict outside the three the queue understands', async () => {
    const events: AgentEvent[] = [];
    const tool = recommendActionTool(ctxWithSink(events)) as unknown as Invokable;

    await expect(tool.invoke({
      ...baseArgs,
      suggested_decision: 'maybe',
      suggested_decision_reason: 'Not sure.',
    })).rejects.toThrow();
    expect(events).toHaveLength(0);
  });
});
