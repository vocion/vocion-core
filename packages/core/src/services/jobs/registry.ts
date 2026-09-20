/**
 * Built-in automation jobs — deterministic server-side tasks an automation can
 * schedule via `do: { job: '<name>' }`, the counterpart to `workflow` (step
 * sequences) and `checkMission` (agent runs). Used for work that is plain code,
 * not an agent or a workflow.
 *
 * Jobs:
 *   - `daily-team-report` — the trailing-24h team activity report: stored as a
 *     workspace briefing and, when `VOCION_MAIL_ENABLED=1`, mailed to the
 *     workspace's accountable human (or `input.to`). `services/jobs/dailyTeamReport.ts`.
 *   - `notify-asks` — mails the accountable human about asks that opened since the
 *     last notification, grouped, throttled per org. `services/jobs/notifyAsks.ts`.
 *   - `refresh-evals` — starts an eval refresh for every dataset, or the ones
 *     named, so the trend line keeps growing without anyone pressing a button.
 *     `services/jobs/refreshEvals.ts`.
 *   - `index-artifact` — puts one artifact into the knowledge index so
 *     `search_knowledge` finds what was written, not only what was ingested.
 *     Subscribed to `artifact.saved` by the wiki plugin. `services/jobs/indexArtifact.ts`.
 *   - `sweep-idle-conversations` — ends conversations nobody has spoken in for
 *     the window and raises `conversation.ended` for each, so a debrief can
 *     read the thread. Scheduled by the wiki plugin. `services/jobs/sweepIdleConversations.ts`.
 *
 * (Discovery-call detection, the job that used to live here, became
 * agent-driven — an hourly `checkMission` automation.)
 */

import { DAILY_TEAM_REPORT_JOB, runDailyTeamReportJob } from './dailyTeamReport';
import { INDEX_ARTIFACT_JOB, runIndexArtifactJob } from './indexArtifact';
import { NOTIFY_ASKS_JOB, runNotifyAsksJob } from './notifyAsks';
import { REFRESH_EVALS_JOB, runRefreshEvalsJob } from './refreshEvals';
import { runSweepIdleConversationsJob, SWEEP_IDLE_CONVERSATIONS_JOB } from './sweepIdleConversations';

type BuiltInJob = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

const JOBS: Record<string, BuiltInJob> = {
  [DAILY_TEAM_REPORT_JOB]: runDailyTeamReportJob,
  [NOTIFY_ASKS_JOB]: runNotifyAsksJob,
  [REFRESH_EVALS_JOB]: runRefreshEvalsJob,
  [INDEX_ARTIFACT_JOB]: runIndexArtifactJob,
  [SWEEP_IDLE_CONVERSATIONS_JOB]: (orgId, input) => runSweepIdleConversationsJob(orgId, input),
};

export function builtInJobNames(): string[] {
  return Object.keys(JOBS);
}

export function isBuiltInJob(name: string): boolean {
  return name in JOBS;
}

export async function runBuiltInJob(name: string, orgId: string, input: Record<string, unknown>): Promise<unknown> {
  const fn = JOBS[name];
  if (!fn) {
    throw new Error(`unknown automation job: ${name}`);
  }
  return fn(orgId, input);
}
