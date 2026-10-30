import type { readWorkforceOutcomes } from './ledger';
import { outcomeInsights } from './insights';

type Report = Awaited<ReturnType<typeof readWorkforceOutcomes>>;

/**
 * Compact evidence for the cross-workspace operating view, without notes or source payloads.
 * @param report - Tenant-scoped non-synthetic outcome snapshot.
 */
export function operatingEvidence(report: Report) {
  return {
    complete: report.complete,
    generatedAt: report.generatedAt,
    items: report.items.map(item => ({
      id: item.id,
      title: item.title,
      agentSlug: item.agentSlug,
      workflow: item.workflow,
      status: item.status,
      evidenceChanged: item.evidenceChanged,
      firstPassAccepted: item.firstPassAccepted,
      activeEffortMinutes: item.activeEffortMinutes,
      effortCoverage: item.effortCoverage,
      linked: item.links.length > 0,
      // Completion is explicitly separate from a human-accepted outcome.
      completed: item.missionRuns.some(run => run.status === 'completed'),
      rubricPresent: Boolean(item.rubric.trim()),
    })),
    priorities: report.items.flatMap(item => outcomeInsights({ ...report, items: [item] })),
  };
}
