/**
 * The critic's real call: built through the per-org key resolution, on the
 * vendor the gate picked, charged to the workspace that asked — two orgs in
 * sequence, each on its own key and its own budget.
 */
import type { Action } from '@/libs/actions/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const calls = vi.hoisted(() => ({ built: [] as Array<{ role: string; orgId: string; provider?: string; model?: string }>, charged: [] as Array<{ orgId?: string | null; feature: string; agentSlug?: string }> }));

vi.mock('@/libs/DB');
vi.mock('@/libs/llm/langchain', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/llm/langchain')>();
  return {
    ...real,
    buildChatModelForOrg: async (role: string, orgId: string, opts: { provider?: string; model?: string } = {}) => {
      calls.built.push({ role, orgId, provider: opts.provider, model: opts.model });
      if (opts.provider === 'openai' && orgId === 'proj_no_openai') {
        throw new Error('OPENAI_API_KEY is not set; cannot construct chat model for role main');
      }
      return {
        invoke: async () => ({ content: `{"findings":[]}`, usage_metadata: { input_tokens: 120, output_tokens: 8, total_tokens: 128 }, response_metadata: { model: opts.model } }),
      };
    },
  };
});
vi.mock('@/services/budget/chargeModelCall', () => ({
  chargeModelCall: async (opts: { orgId?: string | null; feature: string; agentSlug?: string }) => {
    calls.charged.push({ orgId: opts.orgId, feature: opts.feature, agentSlug: opts.agentSlug });
  },
}));

const { realActionGateDeps } = await import('./actionGateRun');

const ACTION: Action = { id: 'test.publish', name: 'Publish', description: 't', inputSchema: z.object({}), grant: 'g', external: true, execute: async () => ({}) };
const deps = (orgId: string) => realActionGateDeps({ orgId, action: ACTION, parsed: {}, authorAgentSlug: 'account-director', subjectKey: 'gate:test.publish:x' });

beforeEach(() => {
  calls.built = [];
  calls.charged = [];
});

describe('the critic\'s call', () => {
  it('is built for each org through its own key resolution, on the picked vendor, and charged to that org', async () => {
    const choice = { provider: 'openai' as const, vendor: 'openai' as const, model: 'gpt-4o' };
    await deps('proj_northwind').critique(choice, 'system', 'human');
    await deps('proj_kestrel').critique(choice, 'system', 'human');

    expect(calls.built).toEqual([
      { role: 'main', orgId: 'proj_northwind', provider: 'openai', model: 'gpt-4o' },
      { role: 'main', orgId: 'proj_kestrel', provider: 'openai', model: 'gpt-4o' },
    ]);
    expect(calls.charged).toEqual([
      { orgId: 'proj_northwind', feature: 'gate.action', agentSlug: 'account-director' },
      { orgId: 'proj_kestrel', feature: 'gate.action', agentSlug: 'account-director' },
    ]);
  });

  it('offers as critics only the vendors this org can reach', async () => {
    const reachable = await deps('proj_no_openai').candidates();

    expect(reachable.map(c => c.provider)).toEqual(['anthropic', 'bedrock']);
    expect(calls.built.every(b => b.orgId === 'proj_no_openai')).toBe(true);

    const all = await deps('proj_northwind').candidates();

    expect(all.map(c => `${c.provider}:${c.vendor}`)).toEqual(['anthropic:anthropic', 'openai:openai', 'bedrock:anthropic']);
  });
});
