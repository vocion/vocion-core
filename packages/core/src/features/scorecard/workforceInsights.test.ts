import type { WorkforceInventory } from '@/services/adoption/WorkforceService';
import { describe, expect, it } from 'vitest';
import { workforceInsights } from './workforceInsights';

const agent: WorkforceInventory['agents'][number] = {
  slug: 'writer',
  name: 'Writer',
  enabled: true,
  purpose: null,
  teamSlug: null,
  ownerUserId: null,
  skills: [],
  playbooks: [],
  humanEvents: 0,
  toolCalls: 0,
  modelCalls: 0,
  modelCostUsd: null,
  reviewDecisions: 0,
  acceptedAsIsRate: null,
  lastModelCallAt: null,
  lastHumanActivityAt: null,
  lastToolCallAt: null,
};
const report: WorkforceInventory = {
  schemaVersion: 1,
  workspaceId: 'example',
  generatedAt: '2026-10-29T12:00:00Z',
  window: { days: 7, from: '2026-10-22T12:00:00Z', to: '2026-10-29T12:00:00Z' },
  agents: [],
  teams: [],
  coverage: { localEvents: 0, lastLocalEventAt: null, unlinkedAgentEvents: 0, completeness: 'unverified', amplitudeConfiguration: null, amplitudeDelivery: 'unverified' },
};

describe('workforce investigation prompts', () => {
  it('does not mistake disabled agents or a quiet day for adoption problems', () => {
    expect(workforceInsights({ ...report, agents: [{ ...agent, enabled: false }, { ...agent, enabled: null }] })).toEqual([]);
    expect(workforceInsights({ ...report, window: { ...report.window, days: 1 }, agents: [agent] })).toEqual([]);
    expect(workforceInsights({ ...report, agents: [agent] })[0]?.kind).toBe('activation');
  });

  it('prioritizes supported corrections over coverage gaps without inventing root causes', () => {
    const findings = workforceInsights({ ...report, agents: [
      agent,
      { ...agent, slug: 'autonomous', modelCalls: 8 },
      { ...agent, slug: 'corrected', reviewDecisions: 10, acceptedAsIsRate: 0.6 },
      { ...agent, slug: 'small-sample', reviewDecisions: 1, acceptedAsIsRate: 0 },
      { ...agent, slug: 'healthy-sample', reviewDecisions: 10, acceptedAsIsRate: 0.9 },
    ] });

    expect(findings.map(f => f.kind)).toEqual(['corrections', 'feedback', 'sample', 'activation']);
    expect(findings[0]?.agent.slug).toBe('corrected');
    expect(findings.some(f => f.agent.slug === 'healthy-sample')).toBe(false);
  });
});
