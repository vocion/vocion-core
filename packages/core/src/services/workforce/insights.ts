import type { readWorkforceOutcomes } from './ledger';

type Report = Awaited<ReturnType<typeof readWorkforceOutcomes>>;
const remedies: Record<string, string> = {
  'context': 'Inspect the cited missing facts and source version; add only the context needed, then replay the failed case.',
  'data-access': 'Verify source permissions and freshness using the failed case before changing the agent instructions.',
  'playbook': 'Compare the failed step with the playbook; revise that step and test both a failed and a successful example.',
  'approval': 'Identify the accountable reviewer and unblock the approval queue; measure waiting separately from active review effort.',
  'execution': 'Inspect the linked run or tool failure and retry only after resolving its cause.',
  'routing': 'Check whether eligible work reaches the intended agent; inspect assignment and cadence before expanding usage.',
  'other': 'Review the recorded explanation with the owner and identify one testable change.',
};

/**
 * Evidence-linked hypotheses; never instructions extracted from untrusted notes.
 * @param report
 */
export function outcomeInsights(report: Report) {
  const suggestions = report.items.flatMap((item) => {
    if (item.evidenceChanged) {
      return [{ itemId: item.id, priority: 0, text: 'Reopen any decided outcome, refresh the linked evidence and review the changed output against the rubric.', evidence: `Work ${item.key}: linked evidence changed after attachment.`, measure: 'Do not count stale acceptance as current accepted work.' }];
    }
    const last = item.events.filter(e => e.kind === 'review').at(-1);
    if (last && ['blocked', 'rejected', 'corrected'].includes(item.status)) {
      const reason = String(last.data.reason);
      return [{ itemId: item.id, priority: item.status === 'blocked' ? 1 : 2, text: remedies[reason] ?? remedies.other!, evidence: `Work ${item.key}: ${item.status}; reviewer category ${reason}.`, measure: 'Compare acceptance, recurrence of this reason and active human effort on the same workflow and rubric.' }];
    }
    const failedMissions = item.missionRuns.filter(run => run.status === 'failed');
    if (failedMissions.length) {
      return [{ itemId: item.id, priority: 1, text: 'Inspect the failed mission and its task trace; resolve the execution or source-access failure before retrying.', evidence: `Work ${item.key}: failed mission runs ${failedMissions.map(run => run.id).join(', ')}.`, measure: 'Track completed runs separately from reviewed, accepted business outcomes.' }];
    }
    if (item.status === 'open' || item.status === 'reopened') {
      return [{ itemId: item.id, priority: 3, text: 'Review the output against its acceptance criteria; execution completion alone cannot establish useful work.', evidence: `Work ${item.key}: no current accepted outcome.`, measure: 'Record accepted, corrected, rejected or blocked with evidence.' }];
    }
    if (item.effortCoverage !== 'reported' || item.baselineMinutes === null || item.baselineKind !== 'measured') {
      return [{ itemId: item.id, priority: 4, text: 'Use assumed baselines for planning only. Measure comparable manual work and active human effort before claiming realized savings.', evidence: `Work ${item.key}: effort or baseline evidence is incomplete.`, measure: 'Record sample, minutes and evidence; keep capacity released separate from cash savings.' }];
    }
    return [];
  });
  return suggestions.sort((a, b) => a.priority - b.priority || a.itemId.localeCompare(b.itemId)).slice(0, 5);
}
