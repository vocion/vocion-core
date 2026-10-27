import type { AgentRouteInput } from './agentRoute';
/**
 * Dynamic routing for agent turns (ADR 0006, phase 2): with no key nothing is
 * asked and nothing changes; the hard limits drop what cannot run before Jev
 * sees it; Jev's answer maps to a model and an effort only when it is sure;
 * every failure runs the configured model and says why; a chat waits at most
 * the chat timeout; decisions are cached and an outage trips a breaker. Jev
 * itself is never called: `decide` is a fake.
 */
import type { JevAnswer, JevFailure, JevQuestion, JevSettings } from './jev';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentCandidates, allowedModels, chatTimeoutMs, modelAllowed, providerOfModel, readAgentRouteModels, resetAgentRouteState, routeAgentTurn, supportsThinking } from './agentRoute';

const KEY = { key: 'ts-FAKE-not-a-real-typesafe-key-000000', scope: 'instance' as const };
const SETTINGS: JevSettings = { model: 'jev-1.13.0', minConfidence: 0.6, timeoutMs: 3000, baseUrl: 'https://api.typesafe.ai' };
const CONFIGURED = { model: 'claude-sonnet-5-5', provider: 'anthropic' as const };
const MENU = [
  { model: 'claude-haiku-4-5-20251001', cost: 'low', about: 'Lookups and short answers.' },
  { model: 'claude-sonnet-5-5', cost: 'medium', about: 'Everyday work.' },
  { model: 'claude-opus-5-5', cost: 'high', about: 'Research and long documents.' },
];

const input = (over: Partial<AgentRouteInput> = {}): AgentRouteInput => ({
  orgId: 'ws_1',
  agentSlug: 'revenue-director',
  kind: 'chat',
  message: 'Rank every open deal by risk and say what to tell each',
  conversationId: 7,
  routeModels: MENU,
  configured: CONFIGURED,
  ...over,
});

const answer = (over: Partial<JevAnswer> = {}): JevAnswer => ({ choice: 'm3', confidence: 0.82, probabilities: {}, effort: 'high', effortConfidence: 0.9, model: 'jev-1.13.0', inputTokens: 300, costUsd: null, latencyMs: 120, ...over });
const deps = (over: Record<string, unknown> = {}) => ({ resolveKey: async () => KEY, settings: SETTINGS, hasCredential: async () => true, env: {}, ...over });

beforeEach(() => {
  resetAgentRouteState();
});

describe('with no key', () => {
  it('answers null and never asks Jev, so the caller changes nothing', async () => {
    const decide = vi.fn();

    expect(await routeAgentTurn(input(), { resolveKey: async () => null, decide })).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('treats a key that cannot be read as no key', async () => {
    const decide = vi.fn();

    expect(await routeAgentTurn(input(), { resolveKey: async () => {
      throw new Error('decrypt failed');
    }, decide })).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('the hard limits, before Jev', () => {
  it('reads only chat-model entries, never a factory engine entry', () => {
    expect(readAgentRouteModels([{ engine: 'openhands', model: 'claude-opus-5-5' }, { model: ' gpt-5.4-mini ', cost: 'low' }, { model: '' }, 'x'])).toEqual([{ model: 'gpt-5.4-mini', cost: 'low' }]);
  });

  it('drops a model whose vendor has no credential here, or is outside the fence, or cannot be told', async () => {
    const ready = async (p: string) => p === 'anthropic';
    const { candidates, dropped } = await agentCandidates(
      { orgId: 'ws_1', configured: CONFIGURED, routeModels: [...MENU, { model: 'gpt-5.4' }, { model: 'mystery-1' }] },
      ready,
      ['claude-sonnet-*', 'claude-opus-5-5', 'gpt-*'],
    );

    expect(candidates.map(c => c.model)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);
    expect(dropped.join(' ')).toMatch(/haiku.*VOCION_ALLOWED_MODELS/);
    expect(dropped.join(' ')).toMatch(/gpt-5\.4: no openai credential/);
    expect(dropped.join(' ')).toMatch(/mystery-1: its vendor is not named/);
  });

  it('always keeps the configured model, which is what runs today', async () => {
    const { candidates } = await agentCandidates({ orgId: 'ws_1', configured: CONFIGURED, routeModels: MENU }, async () => false, ['nothing']);

    expect(candidates.map(c => c.model)).toEqual(['claude-sonnet-5-5']);
  });

  it('never routes to a model with no credential, even if Jev names it', async () => {
    const r = await routeAgentTurn(input(), deps({ hasCredential: async () => false, decide: async () => answer({ choice: 'm3' }) }));

    // Only today's model is left, so Jev sets the effort and the model stays.
    expect(r).toMatchObject({ model: null, detail: { candidates: 1 } });
  });

  it('reads the fence and the vendor of an id', () => {
    expect(allowedModels({ VOCION_ALLOWED_MODELS: ' claude-*, gpt-5.4 ' })).toEqual(['claude-*', 'gpt-5.4']);
    expect(allowedModels({})).toBeNull();
    expect(modelAllowed('claude-opus-5-5', ['claude-*'])).toBe(true);
    expect(modelAllowed('gpt-5.4-mini', ['gpt-5.4'])).toBe(false);
    expect(providerOfModel('us.anthropic.claude-opus-5')).toBe('bedrock');
    expect(providerOfModel('gpt-5.4-mini')).toBe('openai');
    expect(supportsThinking('claude-sonnet-5-5', 'anthropic')).toBe(true);
    expect(supportsThinking('gpt-5.4-mini', 'openai')).toBe(false);
  });
});

describe('Jev\'s answer', () => {
  it('maps onto a model and an effort, and records the decision without the key', async () => {
    let asked: JevQuestion | null = null;
    const r = await routeAgentTurn(input(), deps({
      resolveKey: async () => ({ ...KEY, scope: 'workspace' }),
      decide: async (_k: string, q: JevQuestion) => {
        asked = q;
        return answer();
      },
    }));

    expect(asked!.purpose).toBe('turn');
    expect(asked!.candidates.map(c => c.id)).toEqual(['m1', 'm2', 'm3']);
    expect(asked!.state).toMatchObject({ request: expect.stringContaining('Rank every open deal'), assistant: 'revenue-director' });
    expect(r).toMatchObject({
      selector: 'jev',
      model: { model: 'claude-opus-5-5', provider: 'anthropic' },
      effort: 'high',
      detail: { kind: 'chat', asked: true, confidence: 0.82, jevModel: 'jev-1.13.0', keyScope: 'workspace', provider: 'typesafe', fallback: null },
    });
    expect(JSON.stringify(r)).not.toContain(KEY.key);
  });

  it('leaves the model alone when Jev picks the configured one', async () => {
    const r = await routeAgentTurn(input(), deps({ decide: async () => answer({ choice: 'm2', effort: 'low' }) }));

    expect(r).toMatchObject({ selector: 'jev', model: null, effort: 'low' });
  });

  it('runs the configured model when Jev is unsure, says none, or names something else', async () => {
    for (const [a, why] of [
      [answer({ confidence: 0.4 }), /confidence 0\.40 is below 0\.6/],
      [answer({ choice: 'none' }), /no candidate fits/],
      [answer({ choice: 'm9' }), /not a candidate/],
    ] as const) {
      resetAgentRouteState();
      const r = await routeAgentTurn(input(), deps({ decide: async () => a }));

      expect(r).toMatchObject({ selector: 'configured', model: null, effort: null, detail: { fallback: expect.stringMatching(why) } });
    }
  });

  it('runs the configured model on a timeout or an error, and never throws', async () => {
    const timeout: JevFailure = { failed: true, kind: 'timeout', reason: 'no answer within 1500 ms', latencyMs: 1500 };
    const r = await routeAgentTurn(input(), deps({ decide: async () => timeout }));
    const thrown = await routeAgentTurn(input({ message: 'other' }), deps({ decide: async () => {
      throw new Error('boom');
    } }));

    expect(r).toMatchObject({ selector: 'configured', detail: { asked: true, fallback: 'no answer within 1500 ms', questionVersion: expect.stringMatching(/^turn-[0-9a-f]{8}$/) } });
    expect(thrown).toMatchObject({ selector: 'configured', detail: { fallback: 'Jev could not be reached' } });
  });
});

describe('effort only', () => {
  it('without candidates, asks a chat for its effort on the configured model', async () => {
    const decide = vi.fn(async (_k: string, _q: JevQuestion) => answer({ choice: null, confidence: null, effort: 'low' }));
    const r = await routeAgentTurn(input({ routeModels: undefined }), deps({ decide }));

    expect(decide.mock.calls[0]![1]).toMatchObject({ candidates: [{ model: 'claude-sonnet-5-5' }] });
    expect(r).toMatchObject({ selector: 'jev', model: null, effort: 'low' });
  });

  it('never asks for a scheduled run on a model that takes no thinking', async () => {
    const decide = vi.fn();
    const r = await routeAgentTurn(input({ kind: 'automation', routeModels: undefined, configured: { model: 'gpt-5.4-mini', provider: 'openai' } }), deps({ decide }));

    expect(decide).not.toHaveBeenCalled();
    expect(r).toMatchObject({ selector: 'configured', detail: { fallback: expect.stringMatching(/takes no thinking/) } });
  });

  it('drops the effort when a mission is routed to a model that does not think', async () => {
    const r = await routeAgentTurn(input({ kind: 'mission', routeModels: [{ model: 'gpt-5.4-mini', cost: 'low' }, { model: 'claude-opus-5-5', cost: 'high' }], configured: { model: 'gpt-5.4-mini', provider: 'openai' } }), deps({ decide: async () => answer({ choice: 'm1', effort: 'high' }) }));

    expect(r).toMatchObject({ selector: 'jev', model: null, effort: null });
  });
});

describe('latency', () => {
  it('gives a chat the chat timeout and a mission the full one', async () => {
    const timeouts: number[] = [];
    const decide = async (_k: string, _q: JevQuestion, s: { timeoutMs: number }) => {
      timeouts.push(s.timeoutMs);
      return answer();
    };
    await routeAgentTurn(input(), deps({ decide }));
    await routeAgentTurn(input({ kind: 'mission', message: 'Weekly pipeline review' }), deps({ decide }));

    expect(timeouts).toEqual([1500, 3000]);
    expect(chatTimeoutMs({ VOCION_JEV_CHAT_TIMEOUT_MS: '800' })).toBe(800);
    expect(chatTimeoutMs({ VOCION_JEV_CHAT_TIMEOUT_MS: '60000' })).toBe(1500);
  });

  it('reuses a decision for the same request in the same conversation', async () => {
    const decide = vi.fn(async () => answer());
    await routeAgentTurn(input(), deps({ decide }));
    const again = await routeAgentTurn(input({ message: '  rank every open deal by risk and say what to tell EACH ' }), deps({ decide }));
    await routeAgentTurn(input({ conversationId: 8 }), deps({ decide }));

    expect(decide).toHaveBeenCalledTimes(2);
    expect(again).toMatchObject({ selector: 'jev', detail: { cached: true, asked: false } });
  });

  it('skips Jev for a minute after three failures in a row', async () => {
    let at = 1_000_000;
    const decide = vi.fn(async (): Promise<JevFailure> => ({ failed: true, kind: 'http', status: 529, reason: 'Jev (typesafe) answered HTTP 529', latencyMs: 20 }));
    for (let i = 0; i < 3; i++) {
      await routeAgentTurn(input({ message: `m${i}` }), deps({ decide, now: () => at }));
    }
    const skipped = await routeAgentTurn(input({ message: 'm4' }), deps({ decide, now: () => at }));
    at += 61_000;
    await routeAgentTurn(input({ message: 'm5' }), deps({ decide, now: () => at }));

    expect(skipped).toMatchObject({ selector: 'configured', detail: { fallback: expect.stringMatching(/skipped for a minute/) } });
    expect(decide).toHaveBeenCalledTimes(4);
  });
});
