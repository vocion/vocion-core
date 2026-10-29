import type { WorkforceInventory } from '@/services/adoption/WorkforceService';

type Agent = WorkforceInventory['agents'][number];

export function hasRecordedWork(agent: Agent) {
  return agent.modelCalls > 0 || agent.toolCalls > 0 || agent.reviewDecisions > 0;
}

/**
 * Triage rules identify what to investigate; they do not infer a root cause.
 * @param report - Recorded evidence for one workspace and reporting window.
 */
export function workforceInsights(report: WorkforceInventory) {
  return report.agents.filter(a => a.enabled === true).flatMap((agent) => {
    const kind = agent.reviewDecisions >= 5 && agent.acceptedAsIsRate != null && agent.acceptedAsIsRate < 0.8
      ? 'corrections'
      : hasRecordedWork(agent) && agent.reviewDecisions === 0
        ? 'feedback'
        : !hasRecordedWork(agent) && report.window.days >= 7
            ? 'activation'
            : agent.reviewDecisions > 0 && agent.reviewDecisions < 5
              ? 'sample'
              : null;
    return kind ? [{ agent, kind: kind as 'corrections' | 'feedback' | 'activation' | 'sample', priority: kind === 'corrections' ? 1 : kind === 'feedback' ? 2 : 3 }] : [];
  }).sort((a, b) => a.priority - b.priority || b.agent.reviewDecisions - a.agent.reviewDecisions || a.agent.name.localeCompare(b.agent.name));
}
