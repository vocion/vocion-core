/**
 * Dynamic routing (ADR 0006): a key turns it on, the static route is what it
 * falls back to, and nothing Jev says can step outside the candidates or the
 * installation's fence. Jev is a fake here; CI never calls it.
 */
import type { JevAnswer, JevFailure, JevQuestion } from './jev';
import type { RouteTaskInput } from './route';
import type { TaskFeatures } from '@/services/factory/engineRouter';
import { describe, expect, it, vi } from 'vitest';
import { routeEngine } from '@/services/factory/engineRouter';
import { applyRoute, readSeatRouting, routeCandidates, routeTask } from './route';

const KEY = { key: 'ts-FAKE-not-a-real-typesafe-key-000000', scope: 'instance' as const };
const SETTINGS = { model: 'jev-1.13.0', minConfidence: 0.6, timeoutMs: 3000, baseUrl: 'https://api.typesafe.ai' };

const features = (over: Partial<TaskFeatures> = {}): TaskFeatures => ({
  seat: 'task-engineer',
  taskEngine: null,
  seatEngine: null,
  riskClass: 'logic',
  repo: 'kestrel/app',
  plannedPaths: 2,
  complexity: 'small',
  estimatedCents: 400,
  ...over,
});

const BOTH = [
  { engine: 'claude-cli' as const, model: 'claude-opus-5-5', about: 'Strong, dear.', cost: 'high' as const },
  { engine: 'openhands' as const, model: 'bedrock/us.anthropic.claude-sonnet-5-5', about: 'Open, cheaper.', cost: 'low' as const },
];

const input = (over: Partial<RouteTaskInput> = {}): RouteTaskInput => ({
  orgId: 'ws-kestrel',
  features: features(),
  task: { title: 'Rename usr to user in session.ts', objective: 'Rename and fix references.', acceptance: 2 },
  seat: { model: null, effort: null, routeModels: BOTH },
  ...over,
});

const answer = (over: Partial<JevAnswer> = {}): JevAnswer => ({ choice: 'c2', confidence: 0.84, probabilities: {}, effort: 'low', effortConfidence: 0.9, model: 'jev-1.13.0', inputTokens: 400, costUsd: null, latencyMs: 140, ...over });

describe('the key turns it on', () => {
  it('with no key never calls Jev, and routes exactly as the static chain does', async () => {
    const decide = vi.fn();
    const r = await routeTask(input(), { resolveKey: async () => null, decide, settings: SETTINGS, allowed: null });

    expect(decide).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ...routeEngine(features(), { allowed: null }), selector: 'static', model: null, effort: null, detail: null });
  });

  it('does not put a task that names its own engine, or pins its model, to Jev', async () => {
    const decide = vi.fn();
    const resolveKey = vi.fn(async () => KEY);

    await routeTask(input({ features: features({ taskEngine: { id: 'openhands' } }) }), { resolveKey, decide, settings: SETTINGS, allowed: null });
    await routeTask(input({ pinned: true }), { resolveKey, decide, settings: SETTINGS, allowed: null });

    expect(decide).not.toHaveBeenCalled();
  });

  it('routes static and says why when the saved key will not decrypt', async () => {
    const decide = vi.fn();
    const r = await routeTask(input(), { resolveKey: async () => {
      throw new Error('vault');
    }, decide, settings: SETTINGS, allowed: null });

    expect(decide).not.toHaveBeenCalled();
    expect(r.selector).toBe('static');
    expect(r.detail?.fallback).toMatch(/could not be decrypted/);
  });
});

describe('what Jev decides', () => {
  it('maps its answer onto engine, model and effort, and records it without the key', async () => {
    let asked: JevQuestion | null = null;
    const r = await routeTask(input(), {
      resolveKey: async () => ({ ...KEY, scope: 'workspace' }),
      decide: async (_key, q) => {
        asked = q;
        return answer();
      },
      settings: SETTINGS,
      allowed: null,
    });

    expect(asked!.candidates.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(asked!.state).toMatchObject({ task: 'Rename usr to user in session.ts', size: 'small', budget_usd: '4.00' });
    expect(r).toMatchObject({
      engine: { id: 'openhands', model: 'bedrock/us.anthropic.claude-sonnet-5-5' },
      policy: 'jev',
      selector: 'jev',
      model: 'bedrock/us.anthropic.claude-sonnet-5-5',
      effort: 'low',
      detail: { asked: true, confidence: 0.84, effort: 'low', jevModel: 'jev-1.13.0', latencyMs: 140, costUsd: null, inputTokens: 400, keyScope: 'workspace', provider: 'typesafe', fallback: null, questionVersion: expect.stringMatching(/^engineering-/) },
    });
    expect(JSON.stringify(r)).not.toContain(KEY.key);
  });

  it('records OpenRouter as the provider when the key is an OpenRouter key', async () => {
    const r = await routeTask(input(), {
      resolveKey: async () => ({ key: 'sk-or-v1-FAKE-not-a-real-key-000000', scope: 'instance' }),
      decide: async () => answer({ model: 'typesafe/jev-1.13-20260917', costUsd: 0.00002 }),
      settings: SETTINGS,
      allowed: null,
    });

    expect(r.detail).toMatchObject({ provider: 'openrouter', jevModel: 'typesafe/jev-1.13-20260917', costUsd: 0.00002 });
  });

  it('puts the choice on the contract: a claude-cli model on model_policy, an engine model on engine, effort on model_policy', async () => {
    const claude = await routeTask(input(), { resolveKey: async () => KEY, decide: async () => answer({ choice: 'c1', effort: 'high' }), settings: SETTINGS, allowed: null });
    const contract: Record<string, unknown> = { model_policy: { model: 'claude-sonnet-5-5', escalate_to: 'claude-opus-5' } };
    applyRoute(contract, claude);

    expect(contract).toEqual({ engine: { id: 'claude-cli', model: 'claude-opus-5-5' }, model_policy: { model: 'claude-opus-5-5', effort: 'high', escalate_to: 'claude-opus-5' } });

    const open = await routeTask(input(), { resolveKey: async () => KEY, decide: async () => answer(), settings: SETTINGS, allowed: null });
    const c2: Record<string, unknown> = { model_policy: { model: 'claude-sonnet-5-5' } };
    applyRoute(c2, open);

    expect(c2).toEqual({ engine: { id: 'openhands', model: 'bedrock/us.anthropic.claude-sonnet-5-5' }, model_policy: { model: 'claude-sonnet-5-5', effort: 'low' } });
  });

  it('with no candidates declared offers the seat\'s own engine and asks the effort only', async () => {
    let asked: JevQuestion | null = null;
    const r = await routeTask(input({ seat: { model: 'claude-sonnet-5-5', effort: 'medium', routeModels: [] } }), {
      resolveKey: async () => KEY,
      decide: async (_k, q) => {
        asked = q;
        return answer({ choice: null, confidence: null, effort: 'high' });
      },
      settings: SETTINGS,
      allowed: null,
    });

    expect(asked!.candidates).toHaveLength(1);
    expect(r).toMatchObject({ selector: 'jev', engine: { id: 'claude-cli', model: 'claude-sonnet-5-5' }, effort: 'high' });
  });
});

describe('the hard limits hold', () => {
  it('drops engines outside the fence before Jev sees them, and clamps a pick outside the candidates', async () => {
    let asked: JevQuestion | null = null;
    const r = await routeTask(input({ seat: { model: null, effort: null, routeModels: [...BOTH, { engine: 'openhands', model: 'bedrock/other' }] } }), {
      resolveKey: async () => KEY,
      decide: async (_k, q) => {
        asked = q;
        // The id claude-cli would have had, had it been offered.
        return answer({ choice: 'c3' });
      },
      settings: SETTINGS,
      allowed: ['openhands'],
    });

    expect(asked!.candidates.every(c => c.text.includes('Engine: openhands'))).toBe(true);
    expect(r.selector).toBe('static');
    expect(r.engine).toEqual({ id: 'openhands' });
    expect(r.detail?.fallback).toMatch(/not a candidate/);
  });

  it('routes static when nothing in the seat\'s list is allowed here, without calling Jev', async () => {
    const decide = vi.fn();
    const r = await routeTask(input({ seat: { model: null, effort: null, routeModels: [BOTH[0]!] } }), { resolveKey: async () => KEY, decide, settings: SETTINGS, allowed: ['openhands'] });

    expect(decide).not.toHaveBeenCalled();
    expect(r.detail?.fallback).toMatch(/no candidate is allowed/);
    expect(r.engine).toEqual({ id: 'openhands' });
  });

  it('falls back on low confidence, on none, and on an unsure effort when effort was the whole question', async () => {
    const run = (a: JevAnswer, over: Partial<RouteTaskInput> = {}) => routeTask(input(over), { resolveKey: async () => KEY, decide: async () => a, settings: SETTINGS, allowed: null });

    expect((await run(answer({ confidence: 0.41 }))).detail?.fallback).toMatch(/0\.41 is below 0\.6/);
    expect((await run(answer({ choice: 'none' }))).detail?.fallback).toMatch(/no candidate fits/);
    expect((await run(answer({ choice: null, confidence: null, effortConfidence: 0.3 }), { seat: { model: null, effort: null, routeModels: [] } })).detail?.fallback).toMatch(/effort confidence 0\.30/);
  });

  it('falls back on a timeout or an error, so no run fails because of Jev', async () => {
    for (const failure of [
      { failed: true, kind: 'timeout', reason: 'no answer within 3000 ms', latencyMs: 3001 },
      { failed: true, kind: 'http', status: 503, reason: 'Jev answered HTTP 503', latencyMs: 80 },
    ] as JevFailure[]) {
      const r = await routeTask(input(), { resolveKey: async () => KEY, decide: async () => failure, settings: SETTINGS, allowed: null });

      expect(r).toMatchObject({ selector: 'static', policy: 'static', detail: { asked: true, fallback: failure.reason, keyScope: 'instance' } });
    }

    const thrown = await routeTask(input(), { resolveKey: async () => KEY, decide: async () => {
      throw new Error('boom');
    }, settings: SETTINGS, allowed: null });

    expect(thrown.selector).toBe('static');
  });
});

describe('the seat\'s candidates', () => {
  it('reads harness.routeModels and ignores anything malformed', () => {
    expect(readSeatRouting({ model: 'claude-sonnet-5-5', effort: 'high', routeModels: [{ engine: 'openhands', model: 'bedrock/x', cost: 'low' }, { engine: 'codex' }, 'nope', { engine: 'claude-cli', cost: 'pricey' }] })).toEqual({
      model: 'claude-sonnet-5-5',
      effort: 'high',
      routeModels: [{ engine: 'openhands', model: 'bedrock/x', cost: 'low' }, { engine: 'claude-cli' }],
    });
    expect(readSeatRouting(null)).toEqual({ model: null, effort: null, routeModels: [] });
  });

  it('describes each candidate by what it is good at and its relative cost, and drops duplicates', () => {
    const c = routeCandidates({ model: null, effort: null, routeModels: [...BOTH, BOTH[0]!] }, { engine: null, policy: 'static', reason: '' }, null);

    expect(c).toHaveLength(2);
    expect(c[0]!.text).toContain('Relative cost: high');
    expect(c[1]!.text).toContain('Model: bedrock/us.anthropic.claude-sonnet-5-5');
  });
});
