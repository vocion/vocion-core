/**
 * Jev's effort on a person's turn (ADR 0006, phase 2): it takes Auto's place
 * as the level, but the facts' floor still holds, and the turn's model is the
 * one Jev picked with the level's thinking. Which runs Jev routes at all.
 */
import type { AgentRoute } from '@/services/routing/agentRoute';
import { describe, expect, it } from 'vitest';
import { jevTurnKind, routedModelOverride } from '@/services/AgentService';
import { answerFloor, parseEffort, withJevEffort } from './effort';

const route = (over: Partial<AgentRoute> = {}): AgentRoute => ({ selector: 'jev', model: null, effort: null, detail: {} as AgentRoute['detail'], ...over });
const CONFIGURED = { model: 'claude-sonnet-5-5', provider: 'anthropic' as const };

describe('Jev\'s effort as the turn level', () => {
  it('maps low, medium and high onto quick, standard and deep', () => {
    const read = parseEffort('{"level":"standard","reason":"x","drafts":false,"systems":1}')!;

    expect(withJevEffort(read, 'low', 'jev').level).toBe('quick');
    expect(withJevEffort(read, 'medium', 'jev').level).toBe('standard');
    expect(withJevEffort(read, 'high', 'jev')).toEqual({ level: 'deep', reason: 'jev' });
  });

  it('never goes under the floor the facts set, and the floor survives the next rule', () => {
    const read = parseEffort('{"level":"quick","reason":"revise","drafts":true,"systems":0}')!;
    const held = withJevEffort(read, 'low', 'jev');

    expect(held).toEqual({ level: 'standard', reason: 'drafting something you will send' });
    expect(answerFloor(held, undefined).level).toBe('standard');
  });
});

describe('which runs are routed', () => {
  it('never an eval; a mission, an automation, a person\'s chat, or anything else', () => {
    expect(jevTurnKind('eval_run', {}, true)).toBeNull();
    expect(jevTurnKind(undefined, { userId: 'eval-runner' }, false)).toBeNull();
    expect(jevTurnKind('mission_run', {}, false)).toBe('mission');
    expect(jevTurnKind(undefined, { missionSlug: 'weekly-review' }, false)).toBe('mission');
    expect(jevTurnKind('workflow_run', {}, false)).toBe('automation');
    expect(jevTurnKind(undefined, { userId: 'workflow:42' }, false)).toBe('automation');
    expect(jevTurnKind(undefined, { userId: 'user_1' }, true)).toBe('chat');
    expect(jevTurnKind('browser_run', {}, false)).toBe('other');
  });
});

describe('the model a routed turn runs on', () => {
  it('is untouched with routing off or a fallback', () => {
    expect(routedModelOverride(null, null, CONFIGURED)).toBeUndefined();
    expect(routedModelOverride(route({ selector: 'configured' }), { thinking: 'high' }, CONFIGURED)).toBeUndefined();
  });

  it('on a chat, is Jev\'s model with the level\'s thinking, or the level\'s own when Jev kept today\'s', () => {
    const opus = { model: 'claude-opus-5-5', provider: 'anthropic' as const };

    expect(routedModelOverride(route({ model: opus, effort: 'high' }), { thinking: 'high' }, CONFIGURED)).toEqual({ ...opus, thinking: 'high' });
    expect(routedModelOverride(route({ model: opus }), { thinking: 'agent' }, CONFIGURED)).toEqual(opus);
    expect(routedModelOverride(route({ effort: 'low' }), { thinking: 'low' }, CONFIGURED)).toBeUndefined();
  });

  it('on any other run, is Jev\'s model or today\'s, with Jev\'s thinking', () => {
    expect(routedModelOverride(route({ effort: 'low' }), null, CONFIGURED)).toEqual({ ...CONFIGURED, thinking: 'low' });
    expect(routedModelOverride(route({ model: { model: 'gpt-5.4-mini', provider: 'openai' } }), null, CONFIGURED)).toEqual({ model: 'gpt-5.4-mini', provider: 'openai' });
    expect(routedModelOverride(route(), null, CONFIGURED)).toBeUndefined();
  });
});
