// The record the runner writes to Vocion beside the run it holds: the task the run was queued for
// (`run.input.record`, `{ type, id }`), at claim, at completion and at failure. Pure functions, no
// I/O, so the tests read the shape without a server.
//
// Every write goes through POST /api/v1/objects with an externalKey, which upserts: the same key
// twice is one row, metadata shallow-merged, title and status replaced. The record's type is the
// one the run names, never one written here: the plugin that queued the run says what a task is.
//
// Field names follow the software-factory plugin's task type (camelCase). The snake_case contract
// itself rides beside them as `contract`, whole, so a person reads what the runner read.

import { taskHeadline } from './keep.mjs';

/** The object status a task carries at each step. Only these nine exist on the plugin's type. */
export const TASK_STATUS = {
  ready: 'ready', // record written, run not yet queued
  dispatched: 'dispatched', // run queued, no worker has claimed it
  running: 'running', // a worker claimed the run
  awaiting_review: 'awaiting_review', // the run completed and opened a PR for a person
  rejected: 'rejected', // the run failed; the note says why, keptBranch says where the work is
  abandoned: 'abandoned', // a person gave the task up
};

/** One key per task id, for the launcher and the worker alike. */
export function taskExternalKey(taskId) {
  return { system: 'factory', id: `task:${taskId}` };
}

const TITLE_MAX = 100;

/**
 * A record title from the task: its own `title`, whole, because a person wrote it to be read. A
 * task with no title falls back to the first sentence of the objective, and that fallback keeps
 * the ellipsis when it runs past 100 characters, because a cut objective really is cut short.
 * A bare string argument is read as an objective, for the callers that only have one.
 */
export function taskTitle(task) {
  const t = typeof task === 'string' ? { objective: task } : task || {};
  const given = typeof t.title === 'string' ? t.title.trim() : '';
  if (given) {
    return given.length <= TITLE_MAX ? given : taskHeadline(t, { max: TITLE_MAX });
  }
  const whole = taskHeadline(t, { max: Infinity });
  const text = whole || String(t.objective || '').trim() || 'Engineering task';
  if (text.length <= TITLE_MAX) {
    return text;
  }
  return `${taskHeadline({ title: text }, { max: TITLE_MAX - 3 })}...`;
}

/** owner/name from an https clone URL; the string itself when it is not one. */
export function repoName(url) {
  const m = String(url || '').match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1] : String(url || '');
}

/** The `repo` record slug the plugin's registry names: the repository name without its owner. */
export function repoSlug(url) {
  return repoName(url).split('/').pop() || '';
}

function cents(usd) {
  const n = Number(usd);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined;
}

/** What the runner writes when it claims the run: running, with the attempt and the runner. */
export function taskClaimed(task, { type, runId, attempt, workerId }) {
  return {
    type,
    externalKey: taskExternalKey(task.task_id),
    title: taskTitle(task),
    status: TASK_STATUS.running,
    metadata: { runId, attempt, workerId, claimedAt: new Date().toISOString() },
  };
}

function checkRows(checks) {
  return (checks || []).map(c => ({ name: c.name, passed: c.status === 'passed', exitCode: c.exit_code ?? undefined, summary: c.status === 'skipped' ? 'skipped' : String(c.tail || '').split('\n').slice(-1)[0].slice(0, 200) }));
}

/**
 * The QA flows a task record keeps: the contract's and the engineer's, each with its surface, so a
 * reader needs nothing else to replay it. `fill` values travel as written; the contract already
 * forbids a credential there, and the flows are in the pull request body too.
 */
export function recordableFlows(qa) {
  if (!qa || !Array.isArray(qa.flows)) {
    return [];
  }
  return qa.flows.map(f => ({
    name: f.name,
    path: f.path,
    surface: qa.surface || 'app',
    viewports: Array.isArray(f.viewports) && f.viewports.length ? [...f.viewports] : ['desktop'],
    sign_in: Boolean(f.sign_in),
    steps: Array.isArray(f.steps) ? structuredClone(f.steps) : [],
    ...(f.criterion ? { criterion: f.criterion } : {}),
  }));
}

/** What the runner writes when the run completed: the PR, the files, the checks, the cost. */
export function taskCompleted(task, result, { type, runId, summary, costUsd }) {
  const checks = checkRows(result.checks);
  return {
    type,
    externalKey: taskExternalKey(task.task_id),
    title: taskTitle(task),
    status: TASK_STATUS.awaiting_review,
    metadata: {
      runId,
      runStatus: 'completed',
      attempt: result.attempt,
      branch: result.branch,
      baseSha: result.base_sha,
      commitSha: result.commit_sha,
      prUrl: result.pr_url,
      filesChanged: result.files_changed || [],
      checks: checks.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })),
      verification: checks.map(({ name, passed, exitCode, summary: s }) => ({ check: name, passed, exitCode, summary: s })),
      knownFailures: result.known_failures || [],
      assumptions: result.assumptions || [],
      actualCents: cents(costUsd) ?? 0,
      costUpdatedAt: new Date().toISOString(),
      summary: String(summary || '').slice(0, 2000),
      keptBranch: null,
      // QA evidence. `qaCaptured` is never left off: false with a reason is the point, a missing
      // field is the silent skip this replaces. `qaEvidence` carries the presigned urls so a
      // person reaches the screenshots from the record even before Vocion has an artifacts route.
      qaCaptured: result.qa_captured === null || result.qa_captured === undefined ? null : Boolean(result.qa_captured),
      qaEvidence: (result.qa_evidence || []).slice(0, 40),
      qaSummary: String(result.qa_summary || '').slice(0, 500),
      qaReport: String(result.qa_report || '').slice(0, 8000),
      // The flows QA shot, steps and all, so the live check after the release replays the same
      // states on production (a team's live check). Without them only a flow's name and
      // criterion reached the record, and nothing could reach its state again.
      qaFlows: (result.qa_flows || []).slice(0, 40),
    },
  };
}

/** What the runner writes when the run failed: why, what was kept and where, what it cost. */
export function taskFailed(task, { type, runId, error, failures = [], kept = null, checks = [], costUsd = 0, attempt }) {
  const rows = checkRows(checks);
  const meta = {
    runId,
    runStatus: 'failed',
    attempt,
    summary: String(error || '').slice(0, 2000),
    knownFailures: failures.map(f => `${f.scope || 'worker'}: ${String(f.message || f).slice(0, 300)}`),
    checks: rows.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })),
    verification: rows.map(({ name, passed, exitCode, summary: s }) => ({ check: name, passed, exitCode, summary: s })),
    actualCents: cents(costUsd) ?? 0,
    costUpdatedAt: new Date().toISOString(),
  };
  if (kept) {
    meta.keptBranch = kept.branch || null;
    meta.branch = kept.branch || undefined;
    meta.prUrl = kept.prUrl || undefined;
    meta.commitSha = kept.commitSha || undefined;
    meta.filesChanged = kept.files || [];
    meta.continue = kept.continue || undefined;
  }
  return { type, externalKey: taskExternalKey(task.task_id), title: taskTitle(task), status: TASK_STATUS.rejected, metadata: meta };
}
