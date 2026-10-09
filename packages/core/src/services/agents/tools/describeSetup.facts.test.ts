/**
 * `describe_setup` hands the lead each unconnected system's facts — what
 * needs it, what agents tried and failed, what it unlocks — so it can word
 * every step of the walk (`connect_system`'s `steps`), not only the first.
 */
import type { RuntimeContext } from '../types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/plugins/setupState', () => ({
  setupStateForOrg: async () => [{
    plugin: 'software-factory',
    name: 'Software Factory',
    complete: false,
    steps: [
      { kind: 'connector', slug: 'github', label: 'Connect GitHub', done: false, sources: [] },
      { kind: 'connector', slug: 'jira', label: 'Connect Jira', done: true, sources: ['jira'] },
    ],
  }],
}));
vi.mock('@/services/objectives/ObjectiveService', () => ({ startSetupObjective: async () => null }));
vi.mock('@/services/connect/recommendations', () => ({
  recommendConnections: async () => ({
    candidates: [{
      connector: 'github',
      name: 'GitHub',
      score: 90,
      recommended: true,
      evidence: [{ kind: 'app', app: 'software-factory', appName: 'Software Factory', needed: true }, { kind: 'tried', times: 2 }],
      method: { kind: 'page', href: '/x' },
      unlocks: [{ app: 'software-factory', appName: 'Software Factory', href: '/x', added: true, features: ['Pull request review'] }],
    }],
    connected: [],
    question: null,
    scope: null,
    refused: null,
  }),
}));

const { describeSetupTool } = await import('./describeSetup');

describe('describe_setup', () => {
  it('lists each unconnected system\'s facts under its step', async () => {
    const ctx = { orgId: 'proj-setup-northwind', userId: 'usr-dana', agentSlug: 'lead', emit: () => {} } as unknown as RuntimeContext;
    const out = await describeSetupTool(ctx).invoke({ plugin: 'software-factory' });

    expect(out).toContain('facts (github): Software Factory needs it; Agents tried to use it 2 times this week and couldn\'t; unlocks Software Factory: Pull request review');
    // A done step needs no facts.
    expect(out).not.toContain('facts (jira)');
  });
});
