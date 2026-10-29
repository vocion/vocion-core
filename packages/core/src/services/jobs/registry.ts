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
 *   - `record-duplicate-check` — on `object.created` for a type with
 *     `x-duplicate-check`: is the new record one already on file? Linked with
 *     Undo above the type's bar (ADR 0007: Jev first when the workspace says
 *     so). Not for a factory request, whose intake already checks.
 *     `services/objects/duplicateCheck.ts`.
 *   - `error-watch` — production errors from the error tracker become records
 *     of the type the automation names, opened or updated past a threshold,
 *     each with its cause read by the classifier, and the events it names
 *     raised for whatever listens. `services/jobs/errorWatch.ts`.
 *   - `live-check-ended` — QA's live check of a release ended: seen, checked
 *     once more carrying why, or "could not reach the change" written on the
 *     release and its features. `services/jobs/liveCheck.ts`.
 *   - `asker-follow` — a record's status moved; when its type tells the asker
 *     about that move (`x-tell`), the conversation it was asked in hears it,
 *     in the app's chat and its Slack thread, once. `slack-thread-recording`
 *     carries a filed demo into that thread. `services/jobs/askerFollow.ts`.
 *   - `team-thread` — opens a team thread: a lead's specialists argue one
 *     question out in rounds and the lead writes the outcome, recorded as one
 *     run with its cost. `services/jobs/teamThread.ts`.
 *   - `narrate-recording` — a recording just filed is narrated in a seat's
 *     voice, off the event's path, when a voice is connected. Subscribed by
 *     the software-factory plugin when its `narrateRecordings` setting is on.
 *     `services/jobs/narrateRecording.ts`.
 *   - `meeting-followup` — a captured meeting (`meeting.transcript_ready`) is
 *     read by the classifier; one with a client or prospect after which a
 *     follow-up is owed raises `meeting.followup_owed` (its drafting runs
 *     inline), and each email that run proposed raises
 *     `meeting.followup_ready` for the meeting's owner. Subscribed by the
 *     meeting-followup plugin. `services/jobs/meetingFollowup.ts`.
 *   - `seo-opportunities` — each project with an SEO cadence is checked
 *     against its pages a month; one behind pace queues the strategist's
 *     background run for just the pages it is short, one on pace gets
 *     nothing. Scheduled weekly by the seo plugin. `services/seo/cadence.ts`.
 *
 * (Discovery-call detection, the job that used to live here, became
 * agent-driven — an hourly `checkMission` automation.)
 */

import { ASKER_FOLLOW_JOB, ASKER_RECORDING_JOB, RETIRED_FOLLOW_JOBS, runAskerFollowJob, runAskerRecordingJob } from './askerFollow';
import { DAILY_TEAM_REPORT_JOB, runDailyTeamReportJob } from './dailyTeamReport';
import { ERROR_WATCH_JOB, runErrorWatch } from './errorWatch';
import { factoryCarryJobs } from './factoryCarry';
import { INDEX_ARTIFACT_JOB, runIndexArtifactJob } from './indexArtifact';
import { liveCheckJobs } from './liveCheck';
import { mockupDefaultJobs } from './mockupDefault';
import { NARRATE_RECORDING_JOB, runNarrateRecordingJob } from './narrateRecording';
import { NOTIFY_ASKS_JOB, runNotifyAsksJob } from './notifyAsks';
import { REFRESH_EVALS_JOB, runRefreshEvalsJob } from './refreshEvals';
import { runSweepIdleConversationsJob, SWEEP_IDLE_CONVERSATIONS_JOB } from './sweepIdleConversations';
import { runTeamThreadJob, TEAM_THREAD_JOB } from './teamThread';

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
  [ASKER_FOLLOW_JOB]: (orgId, input) => runAskerFollowJob(orgId, input),
  [ASKER_RECORDING_JOB]: (orgId, input) => runAskerRecordingJob(orgId, input),
  [TEAM_THREAD_JOB]: (orgId, input) => runTeamThreadJob(orgId, input),
  // Loaded when it runs: the registry is on many routes, and the job is not.
  'meeting-followup': async (orgId, input) => (await import('./meetingFollowup')).runMeetingFollowupJob(orgId, input),
  // `object.created` for a type with `x-duplicate-check` whose intake does not
  // already run it (a factory request's does): is this one we already have?
  'record-duplicate-check': async (orgId, input) => (await import('@/services/objects/duplicateCheck')).checkNewRecordForDuplicate(orgId, input),
  // The Marketing plugin's four-hourly read of the ad account: raises an event only when something changed (ADR 0008).
  'ads-guard': async (orgId, input) => (await import('./adsGuard')).runAdsGuardJob(orgId, input),
  // The SEO plugin's weekly cadence check: queues the strategist only for a project behind its pages a month.
  'seo-opportunities': async (orgId, input) => (await import('@/services/seo/cadence')).runSeoOpportunitiesJob(orgId, input),
  // A workspace whose old automation still names these hears nothing from them: asker-follow says it.
  ...Object.fromEntries(RETIRED_FOLLOW_JOBS.map(name => [name, async () => ({ said: false, reason: `${name} is retired; asker-follow tells the asker` })])),
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
