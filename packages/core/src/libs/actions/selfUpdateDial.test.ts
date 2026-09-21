import type { ExecutionFacts } from './autoAccept';
import { describe, expect, it } from 'vitest';
import { decideExecution } from './autoAccept';
import { selfImprovementBar } from './eagerness';
import { getAction } from './registry';
import { SELF_UPDATE_KINDS, selfUpdateKind } from './selfUpdate';
import '@/libs/actions/registry';

/**
 * Where the self-improvement class meets the workspace's learning dial.
 *
 * The dial (`defaults.learningEagerness`) is the ONE place a bar for this
 * class comes from; the class table says which kinds are on it. These tests
 * hold the three properties the two changes agreed on, against the real
 * registry rather than against a description of it:
 *
 *  1. An explicit `autoApproveAbove` still wins over the dial.
 *  2. The dial moves the bar, never the confidence.
 *  3. **The safety property**: a workspace at eagerness 10 still cannot
 *     release `agent.revise_prompt` without a rule of its own. It is the
 *     class's only `medium` kind, the default branch is low-risk only, and
 *     that is the whole mechanism — there is no flag to forget.
 */

/**
 * The facts as `ActionService` builds them for a kind nobody has authored a rule for.
 * @param actionId
 * @param confidence
 * @param over
 */
function factsFor(actionId: string, confidence: number, over: Partial<ExecutionFacts> = {}): ExecutionFacts {
  const kind = selfUpdateKind(actionId)!;
  const action = getAction(actionId)!;
  return {
    actionId,
    confidence,
    reversible: action.undo !== undefined,
    neverAuto: false,
    suggestedDecision: 'approve',
    rung: 'execute-with-approval',
    riskTier: kind.risk,
    minConfidence: 0.85,
    explicit: false,
    selfImproving: action.selfImproving === true,
    learningEagerness: null,
    ...over,
  };
}

describe('the learning dial and the self-improvement class', () => {
  it('sets the bar for every member that is on the dial, and nothing else does', () => {
    for (const kind of SELF_UPDATE_KINDS.filter(k => k.onTheDial)) {
      // Default eagerness (7) → 0.72. A plain 0.9 clears it; a hedged 0.5 does not.
      const clears = decideExecution(factsFor(kind.actionId, 0.9));
      const under = decideExecution(factsFor(kind.actionId, 0.5));

      expect(clears.mode, kind.actionId).toBe('execute');
      expect(clears.threshold, kind.actionId).toBe(0.72);
      expect(under.mode, kind.actionId).toBe('ask');
      expect(under.reason, kind.actionId).toContain('learning eagerness 7/10');
    }
  });

  it('moves the bar with the dial, and never the confidence', () => {
    // The same 0.65 confidence, three workspaces. Nothing about the proposal
    // changes — only what this workspace is willing to accept.
    const cautious = decideExecution(factsFor('wiki.write_page', 0.65, { learningEagerness: 1 }));
    const shipped = decideExecution(factsFor('wiki.write_page', 0.65, { learningEagerness: 7 }));
    const eager = decideExecution(factsFor('wiki.write_page', 0.65, { learningEagerness: 10 }));

    expect([cautious.threshold, shipped.threshold, eager.threshold]).toEqual([0.96, 0.72, 0.6]);
    expect([cautious.mode, shipped.mode, eager.mode]).toEqual(['ask', 'ask', 'execute']);
    // Every one of them measured the SAME number the proposer gave.
    expect(selfImprovementBar(10)).toBeLessThan(0.65);
    expect(selfImprovementBar(7)).toBeGreaterThan(0.65);
  });

  it('always asks at 0, whatever the agent claims', () => {
    const d = decideExecution(factsFor('mission.update_notes', 1, { learningEagerness: 0 }));

    expect(d.mode).toBe('ask');
    expect(d.reason).toContain('always asks before it learns');
  });

  it('lets an explicit autoApproveAbove win over the dial', () => {
    // A trust rule for the kind: `explicit`, an automating rung, and its own
    // floor. The dial is not consulted at all, in either direction.
    const stricter = decideExecution(factsFor('wiki.write_page', 0.8, {
      explicit: true,
      rung: 'execute-within-bounds',
      minConfidence: 0.95,
      learningEagerness: 10,
    }));
    const looser = decideExecution(factsFor('wiki.write_page', 0.65, {
      explicit: true,
      rung: 'execute-within-bounds',
      minConfidence: 0.6,
      learningEagerness: 1,
    }));

    expect(stricter.mode).toBe('ask');
    expect(stricter.source).toBe('trust-rule');
    expect(stricter.threshold).toBe(0.95);
    expect(looser.mode).toBe('execute');
    expect(looser.source).toBe('trust-rule');
    expect(looser.threshold).toBe(0.6);
  });

  it('SAFETY: eagerness 10 cannot release an agent revising its own prompt', () => {
    // The most eager workspace there is, an agent as sure as it can be, and
    // no rule authored for the kind. It still asks, because the default
    // branch is low-risk only and this kind is medium.
    const d = decideExecution(factsFor('agent.revise_prompt', 1, { learningEagerness: 10 }));

    expect(d.mode).toBe('ask');
    expect(d.source).toBe('held');
    expect(d.reason).toContain('medium-risk');
    expect(d.threshold).toBeNull();
  });

  it('SAFETY: a prompt revision runs only where a workspace authored the rule itself', () => {
    const withRule = decideExecution(factsFor('agent.revise_prompt', 0.97, {
      explicit: true,
      rung: 'execute-within-bounds',
      minConfidence: 0.95,
    }));
    const underThatRule = decideExecution(factsFor('agent.revise_prompt', 0.9, {
      explicit: true,
      rung: 'execute-within-bounds',
      minConfidence: 0.95,
    }));

    expect(withRule.mode).toBe('execute');
    expect(withRule.source).toBe('trust-rule');
    expect(underThatRule.mode).toBe('ask');
  });

  it('keeps turning a plugin on off the dial, on the platform\'s flat bar', () => {
    // Not `selfImproving`: enabling a plugin adds agents, pages and
    // automations, which is wider than what the dial is calibrated for.
    const at10 = decideExecution(factsFor('plugin.enable', 0.75, { learningEagerness: 10 }));

    expect(at10.mode).toBe('ask');
    expect(at10.threshold).toBe(0.8);
    expect(at10.reason).toContain('reversible, low-risk');
  });
});
