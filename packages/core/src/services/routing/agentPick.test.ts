import type { JevAnswer, JevQuestion } from './jev';
/**
 * Jev choosing who answers a first message (ADR 0006, phase 2): no key means
 * no pick and the router behaves as before; a pick is offered only when it is
 * a seat on the roster at Jev's confidence bar. Jev is never called.
 */
import type { RoutableAgent } from '@/services/agents/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickAgent } from './agentPick';
import { resetAgentRouteState } from './agentRoute';

const KEY = { key: 'ts-FAKE-not-a-real-typesafe-key-000000', scope: 'workspace' as const };
const SETTINGS = { model: 'jev-1.13.0', minConfidence: 0.6, timeoutMs: 3000, baseUrl: 'https://api.typesafe.ai' };
const SEATS: RoutableAgent[] = [
  { slug: 'product-manager', name: 'PM', description: 'Files and plans requests.' },
  { slug: 'designer', name: 'Design', description: 'Designs surfaces.' },
];
const INPUT = { orgId: 'ws_1', message: 'Add keyboard shortcuts to the library', agents: SEATS, leadSlug: 'product-manager' };
const answer = (over: Partial<JevAnswer> = {}): JevAnswer => ({ choice: 'designer', confidence: 0.8, probabilities: {}, effort: null, effortConfidence: null, model: 'jev-1.13.0', inputTokens: 200, costUsd: null, latencyMs: 90, ...over });

beforeEach(() => {
  resetAgentRouteState();
});

describe('picking the agent', () => {
  it('is nothing at all with no key', async () => {
    const decide = vi.fn();

    expect(await pickAgent(INPUT, { resolveKey: async () => null, decide })).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('asks a choice over the roster, by slug, and offers a sure pick', async () => {
    let asked: JevQuestion | null = null;
    const pick = await pickAgent(INPUT, { resolveKey: async () => KEY, settings: SETTINGS, env: {}, decide: async (_k, q) => {
      asked = q;
      return answer();
    } });

    expect(asked!.purpose).toBe('agent');
    expect(asked!.candidates.map(c => c.id)).toEqual(['product-manager', 'designer']);
    expect(pick).toMatchObject({ chosen: 'designer', confidence: 0.8, detail: { selector: 'jev', keyScope: 'workspace', provider: 'typesafe', questionVersion: expect.stringMatching(/^agent-/) } });
    expect(JSON.stringify(pick)).not.toContain(KEY.key);
  });

  it('offers nothing when Jev is unsure, says none, names someone off the roster, or fails', async () => {
    for (const [a, why] of [
      [answer({ confidence: 0.3 }), /below 0\.6/],
      [answer({ choice: 'none' }), /no seat owns this/],
      [answer({ choice: 'wiki-curator' }), /not on the roster/],
      [{ failed: true as const, kind: 'timeout' as const, reason: 'no answer within 1500 ms', latencyMs: 1500 }, /1500 ms/],
    ] as const) {
      const pick = await pickAgent(INPUT, { resolveKey: async () => KEY, settings: SETTINGS, env: {}, decide: async () => a });

      expect(pick).toMatchObject({ chosen: null, detail: { fallback: expect.stringMatching(why) } });
    }
  });
});
