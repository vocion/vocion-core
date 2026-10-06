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
 *   - `factory-intake`, `factory-plan-review`, `factory-plan-build`,
 *     `factory-recover`, `factory-recovery-answer`, `factory-sweep`,
 *     `factory-ci-failed`, `factory-reconcile` — the
 *     software factory carrying a request from filing to a build and through
 *     a failed run, in code. Subscribed by the software-factory plugin.
 *     `services/jobs/factoryCarry.ts`.
 *   - `mockup-default`, `mockup-ended` — a record with a UI gets its mockup
 *     drawn hands-off, and a drawing that drew nothing is tried once more or
 *     written down. Subscribed by the software-factory plugin.
 *     `services/jobs/mockupDefault.ts`.
 *   - `error-watch` — production errors from the error tracker become records
 *     of the type the automation names, opened or updated past a threshold,
 *     each with its cause read by the classifier, and the events it names
 *     raised for whatever listens. `services/jobs/errorWatch.ts`.
 *   - `live-check-ended` — QA's live check of a release ended: seen, checked
 *     once more carrying why, or "could not reach the change" written on the
 *     release and its features. `services/jobs/liveCheck.ts`.
 *   - `slack-thread-follow` — a record's status moved; the Slack thread it was
 *     asked in hears the step's sentence, once (backlog 057).
 *     `services/jobs/slackThreadFollow.ts`.
 *   - `narrate-recording` — a recording just filed is narrated in a seat's
 *     voice, off the event's path, when a voice is connected. Subscribed by
 *     the software-factory plugin when its `narrateRecordings` setting is on.
 *     `services/jobs/narrateRecording.ts`.
 *
 * (Discovery-call detection, the job that used to live here, became
 * agent-driven — an hourly `checkMission` automation.)
 */

import { CONVERSATION_FOLLOW_JOB, runConversationFollowJob } from './conversationFollow';
import { DAILY_TEAM_REPORT_JOB, runDailyTeamReportJob } from './dailyTeamReport';
import { ERROR_WATCH_JOB, runErrorWatch } from './errorWatch';
import { factoryCarryJobs } from './factoryCarry';
import { INDEX_ARTIFACT_JOB, runIndexArtifactJob } from './indexArtifact';
import { liveCheckJobs } from './liveCheck';
import { mockupDefaultJobs } from './mockupDefault';
import { NARRATE_RECORDING_JOB, runNarrateRecordingJob } from './narrateRecording';
import { NOTIFY_ASKS_JOB, runNotifyAsksJob } from './notifyAsks';
import { REFRESH_EVALS_JOB, runRefreshEvalsJob } from './refreshEvals';
import { runSlackThreadFollowJob, runSlackThreadRecordingJob, SLACK_THREAD_FOLLOW_JOB, SLACK_THREAD_RECORDING_JOB } from './slackThreadFollow';
import { runSweepIdleConversationsJob, SWEEP_IDLE_CONVERSATIONS_JOB } from './sweepIdleConversations';

type BuiltInJob = (orgId: string, input: Record<string, unknown>) => Promise<unknown>;

const JOBS: Record<string, BuiltInJob> = {
  [DAILY_TEAM_REPORT_JOB]: runDailyTeamReportJob,
  [NOTIFY_ASKS_JOB]: runNotifyAsksJob,
  [REFRESH_EVALS_JOB]: runRefreshEvalsJob,
  [INDEX_ARTIFACT_JOB]: runIndexArtifactJob,
  [SWEEP_IDLE_CONVERSATIONS_JOB]: (orgId, input) => runSweepIdleConversationsJob(orgId, input),
  [ERROR_WATCH_JOB]: (orgId, input) => runErrorWatch(orgId, input),
  ...factoryCarryJobs,
  ...mockupDefaultJobs,
  ...liveCheckJobs,
  [NARRATE_RECORDING_JOB]: (orgId, input) => runNarrateRecordingJob(orgId, input),
  [SLACK_THREAD_FOLLOW_JOB]: (orgId, input) => runSlackThreadFollowJob(orgId, input),
  [SLACK_THREAD_RECORDING_JOB]: (orgId, input) => runSlackThreadRecordingJob(orgId, input),
  [CONVERSATION_FOLLOW_JOB]: (orgId, input) => runConversationFollowJob(orgId, input),
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
