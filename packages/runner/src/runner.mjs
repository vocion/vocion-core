#!/usr/bin/env node
// The Vocion runner: runs ONE engineering task as a Vocion worker_run (ADR 0004) inside a disposable
// container. Plain Node 22, no dependencies (Playwright, for QA evidence, is in the image).
//
// The runner is the mechanism and names no product: what a repository builds, which services it
// needs, which commands its checks run, which files its people own and how its surfaces are served
// arrive in the task contract, filled at dispatch from the repo record and the product's
// environments (packages/runner/contract/schema.json). Where the container runs is the target's
// business (on the box, Fargate, a laptop); the loop is the same.
//
// Flow: claim -> read the task contract -> clone at base_sha on a factory/* branch (a branch in
// base_sha is a resume: checked out and rebased on origin/main) -> services the contract asks for
// (postgres sidecar, migrations) -> headless `claude -p` under hooks -> deterministic verification
// -> commit, push, open a PR -> complete. When the run stops short (checks failed, budget, wall
// clock, claude exit) with changes inside allowed_paths, the worker commits them, pushes
// factory/<task_id>-wip-<run id>, opens a draft PR labelled checks-failed and still fails the run.
// Heartbeats run in the background the whole time and carry cost; the reply's stop/paused signals
// are honored. Every phase is one JSON line on stdout so CloudWatch shows the timeline.
//
// Modes:
//   WORKER_RUN_ID set            claim that run
//   WORKER_RUN_ID unset          poll GET /worker-runs?status=queued&agentSlug=... for POLL_MAX_SECONDS
//   LOCAL_TASK / LOCAL_TASK_JSON no Vocion at all: run the contract from a file, stdin (LOCAL_TASK=-) or inline JSON
//
// Exit code is 0 in every case so ECS never retries a task on its own; Vocion holds the truth.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { BUILTIN_CHECKS, ContractError, criterionTests, ENGINEER_FLOW_LIMITS, mergeEngineerFlows, normalizeContract, normalizeQa } from './contract.mjs';
import { createEventLog, isFinalResult, lineSplitter, looksLikeEventsRejection, MAX_BATCH, messageEvents, renderTranscriptMarkdown } from './events.mjs';
import { classifyBase, classifyStop, continueLine, criteriaAllSkipped, effectiveAttempt, evidenceSection, globMatches, humanOwned, keepDecision, namedTestStatus, plainDashes, prTitle, refusedFlowsSection, runtimeDdlHits, skipReason, taskHeadline, testNamePattern, testRunMarkdown, testsSection, verdictText, wipBranchName, wipCommitMessage, wipPrBody, wipPrTitle } from './keep.mjs';
import { planRequirement } from './plan.mjs';
import { checkAllowedPaths, pathsMissingFailure } from './preflight.mjs';
import { captureEvidence, containerCredentials, productionBase, publishArtifact, surfaceOf, uploadEvidence } from './qa.mjs';
import { recordableFlows, repoName, taskClaimed, taskCompleted, taskFailed } from './record.mjs';
import { checkPlan, serviceSpec } from './services.mjs';

// ---------- configuration ----------

const env = process.env;
const cfg = {
  vocionUrl: (env.VOCION_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, ''),
  vocionToken: env.VOCION_TOKEN || '',
  agentSlug: env.VOCION_AGENT_SLUG || '',
  // Which deploy target this container is (on-box, aws-fargate, local...), said at claim and on
  // every heartbeat so the Runs page names what claimed a run.
  target: env.RUNNER_TARGET || 'local',
  runId: env.WORKER_RUN_ID || '',
  localTask: env.LOCAL_TASK || '',
  localTaskJson: env.LOCAL_TASK_JSON || '',
  pollMaxSeconds: num(env.POLL_MAX_SECONDS, 900),
  pollEverySeconds: num(env.POLL_EVERY_SECONDS, 20),
  heartbeatSeconds: num(env.HEARTBEAT_SECONDS, 30),
  maxBudgetUsd: num(env.MAX_BUDGET_USD, 12),
  wallClockMinutes: num(env.WALL_CLOCK_MINUTES, 45),
  githubToken: env.GITHUB_TOKEN || '',
  workspace: env.WORKSPACE || '/workspace',
  runnerHome: env.RUNNER_HOME || '/opt/vocion-runner',
  // Only for a run queued with a bare message and no contract: where that docs task is written.
  defaultRepo: env.DEFAULT_REPO || '',
  defaultProduct: env.DEFAULT_PRODUCT || 'default',
  defaultModel: env.DEFAULT_MODEL || 'sonnet',
  claudeBin: env.CLAUDE_BIN || 'claude',
  // Where a `postgres` service answers when the contract names no url: the target's sidecar or
  // compose service. A repo whose tests expect another address names it on its repo record.
  postgresUrl: env.RUNNER_POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/postgres',
  servicesWaitSeconds: num(env.SERVICES_WAIT_SECONDS, 90),
  // QA evidence: where the screenshots are stored and who signs the links. Presign keys that do
  // not rotate keep a seven-day link seven days. No bucket: the shots go into Vocion inline.
  qaBucket: env.QA_EVIDENCE_BUCKET || '',
  qaRegion: env.QA_EVIDENCE_REGION || env.AWS_REGION || 'us-west-2',
  qaPresignKeyId: env.PRESIGN_ACCESS_KEY_ID || '',
  qaPresignSecret: env.PRESIGN_SECRET_ACCESS_KEY || '',
  qaEnabled: env.QA_CAPTURE !== '0',
};
const REPO_DIR = path.join(cfg.workspace, 'repo');
const LOG_DIR = path.join(cfg.workspace, 'logs');
// The commit the image was built from (Dockerfile ARG WORKER_VERSION), sent with every claim and heartbeat.
const WORKER_VERSION = process.env.WORKER_VERSION || 'unknown';
const SCRATCH_DIR = path.join(cfg.workspace, 'scratch');
// Where the engineer writes one QA flow per visible criterion. Outside the repo, so it is never a change.
const QA_FLOWS_FILE = path.join(SCRATCH_DIR, 'qa-flows.json');
const CRITERIA_TESTS_FILE = path.join(SCRATCH_DIR, 'criteria-tests.json');
// Where this worker's modules live (/opt/factory in the image), so the engineer can run the flow check.
const WORKER_HOME = path.dirname(fileURLToPath(import.meta.url));
const LAND_RESERVE_SECONDS = 300; // kept back from the wall clock for verify + land

const startedAt = Date.now();
const hostId = (env.ECS_CONTAINER_METADATA_URI_V4 ? await ecsTaskId() : '') || os.hostname();
const workerId = `${cfg.target}-${hostId}-${process.pid}`;

function num(v, d) {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d;
}

// ---------- logging ----------

// `record` is the task record the run was queued for (run.input.record, { type, id }, set by the
// dispatch); null for a run queued bare, which then reports to nothing.
const state = { runId: cfg.runId || null, phase: 'boot', note: '', counts: {}, pendingUsage: null, model: null, costUsd: 0, stopped: false, stopReason: '', killReason: '', paused: false, lostLease: false, claude: null, services: [], serviceEnv: {}, kept: null, record: null, task: null, runLogs: null };

// The run's own step log, small enough to ride heartbeat/complete/fail (backlog 036, the fixed
// contract): one event per phase this worker logs, plus claude.tool / claude.tool.result from the
// stream-json reader below. Bulk bytes never go through it; see publishRunLogs.
const eventLog = createEventLog();
const ERROR_PHASE_RE = /\.(?:failed|crashed|rejected|refused|error)$|^crash$/;

// Debounced "the page feels live" trigger: at most one extra heartbeat every 5s, on top of the
// regular HEARTBEAT_SECONDS interval, so a phase change reaches Vocion without waiting a full tick.
const EARLY_HEARTBEAT_DEBOUNCE_MS = 5000;
let lastHeartbeatAttemptAt = 0;
let earlyHeartbeatScheduled = false;
function requestEarlyHeartbeat() {
  // eslint-disable-next-line no-use-before-define -- called only once the client below exists
  if (!vocion.enabled || !state.runId || state.lostLease || earlyHeartbeatScheduled) {
    return;
  }
  const wait = Math.max(0, EARLY_HEARTBEAT_DEBOUNCE_MS - (Date.now() - lastHeartbeatAttemptAt));
  earlyHeartbeatScheduled = true;
  setTimeout(() => {
    earlyHeartbeatScheduled = false; heartbeat().catch(() => {});
  }, wait).unref();
}

function log(phase, extra = {}) {
  const rec = { ts: new Date().toISOString(), phase, run: state.runId, worker: workerId, elapsed_s: Math.round((Date.now() - startedAt) / 1000), ...extra };
  process.stdout.write(`${JSON.stringify(rec)}\n`);
  if (phase !== 'heartbeat') {
    const { note, error, ...fields } = extra || {};
    eventLog.add(phase, { level: ERROR_PHASE_RE.test(phase) ? 'error' : undefined, message: note || error, fields, ts: rec.ts });
    requestEarlyHeartbeat();
  }
}
function setPhase(phase, note = '') {
  state.phase = phase; state.note = note; log(phase, note ? { note } : {});
}

async function ecsTaskId() {
  try {
    const r = await fetch(`${env.ECS_CONTAINER_METADATA_URI_V4}/task`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return String(j.TaskARN || '').split('/').pop() || '';
  } catch {
    return '';
  }
}

// ---------- Vocion client ----------

const vocion = {
  enabled: Boolean(cfg.vocionUrl && cfg.vocionToken),
  async call(method, p, body) {
    const url = `${cfg.vocionUrl}/api/v1${p}`;
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${cfg.vocionToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: res.status, ok: res.ok, json };
  },
  get(p) {
    return this.call('GET', p);
  },
  post(p, body) {
    return this.call('POST', p, body);
  },
  /**
   * The run's last word (complete / fail) survives Vocion restarting under it. Run 361
   * (2026-09-26) opened its PR and then failed: the complete call timed out while a Vocion
   * deploy restarted the app. A network error, a timeout or a 5xx is retried with back-off for
   * about two minutes; a 4xx is an answer and is returned.
   */
  async postFinal(p, body) {
    let last;
    for (const waitS of [0, 5, 15, 30, 60]) {
      if (waitS) {
        await sleep(waitS * 1000);
      }
      try {
        last = await this.call('POST', p, body);
        if (last.status < 500) {
          return last;
        }
      } catch (e) {
        last = { status: 0, ok: false, json: { error: String(e.message || e) } };
      }
      log('vocion.retry', { path: p, status: last.status, next_wait_s: waitS });
    }
    return last;
  },
};

// ---------- heartbeat ----------

let heartbeatTimer = null;

// What a successful heartbeat reply (from either the events-carrying call or its no-events retry)
// does to state: log it, honor stop/pause. Shared so the fallback path behaves identically.
function applyHeartbeatReply(r) {
  const { stop, paused, capRemainingCents, endsAt, status } = r.json || {};
  log('heartbeat', { stop, paused, capRemainingCents, endsAt, status, cost_usd: round2(state.costUsd) });
  if (stop && !state.stopped) {
    state.stopped = true;
    state.stopReason = capRemainingCents != null && capRemainingCents <= 0 ? 'budget-stop' : (endsAt && new Date(endsAt).getTime() <= Date.now() ? 'wall-clock' : 'stop');
    killClaude(`stop requested by Vocion (${state.stopReason})`);
  }
  if (paused && !state.paused) {
    state.paused = true; log('paused'); if (state.claude) {
      try {
        state.claude.kill('SIGSTOP');
      } catch {}
    }
  }
  if (!paused && state.paused) {
    state.paused = false; log('resumed'); if (state.claude) {
      try {
        state.claude.kill('SIGCONT');
      } catch {}
    }
  }
}

async function heartbeat() {
  if (!vocion.enabled || !state.runId || state.lostLease) {
    return;
  }
  lastHeartbeatAttemptAt = Date.now();
  const batch = (!eventLog.isDisabled() && eventLog.hasPending()) ? eventLog.nextBatch() : [];
  const body = {
    workerId,
    workerVersion: WORKER_VERSION,
    progress: { phase: state.phase, note: state.note, elapsed_s: Math.round((Date.now() - startedAt) / 1000), model: state.model || undefined },
    counts: Object.keys(state.counts).length ? state.counts : undefined,
  };
  if (state.pendingUsage) {
    body.usage = state.pendingUsage;
  }
  if (batch.length) {
    body.events = batch;
  }
  let r;
  try {
    r = await vocion.post(`/worker-runs/${state.runId}/heartbeat`, body);
  } catch (e) {
    log('heartbeat.error', { error: String(e.message || e) }); return;
  }
  if (r.ok) {
    state.pendingUsage = null; // charged once, never double-reported
    if (batch.length) {
      eventLog.ack(batch, r.json?.eventsAccepted);
    }
    applyHeartbeatReply(r);
    return;
  }
  // The heartbeat must never fail because of the events it carried: an older core, or one that
  // refuses this batch for a reason named in the error, gets one retry with events stripped, and
  // this run stops sending events rather than risk every future heartbeat the same way.
  if (batch.length && looksLikeEventsRejection(r.status, r.json)) {
    eventLog.disable();
    log('events.disabled', { status: r.status, error: r.json?.error, note: 'heartbeat rejected the events payload; retrying without events and dropping further events for this run' });
    let r2;
    try {
      r2 = await vocion.post(`/worker-runs/${state.runId}/heartbeat`, { ...body, events: undefined });
    } catch (e) {
      log('heartbeat.error', { error: String(e.message || e) }); return;
    }
    if (r2.ok) {
      state.pendingUsage = null; applyHeartbeatReply(r2); return;
    }
    r = r2;
  }
  log('heartbeat.rejected', { status: r.status, error: r.json?.error });
  if (r.status === 403 || r.status === 409 || r.status === 404) {
    // Another worker holds the lease, or the run is terminal. Nothing we report will land; stop working.
    state.lostLease = true;
    killClaude(`lease lost (${r.status})`);
  }
}

/**
 * Whatever is still queued when the run is ending, sent in ordinary heartbeats of at most 200
 * until one batch is left; that last batch is handed back so complete/fail can carry it on the
 * terminal call itself, since the contract takes `events` there too. Never throws: an unreachable
 * Vocion just leaves the rest unsent, same as every other heartbeat in this run.
 */
async function drainEventsBeforeTerminal() {
  if (!vocion.enabled || !state.runId || eventLog.isDisabled()) {
    return [];
  }
  while (eventLog.size > MAX_BATCH) {
    const batch = eventLog.nextBatch();
    const body = { workerId, progress: { phase: state.phase, note: state.note, elapsed_s: Math.round((Date.now() - startedAt) / 1000), model: state.model || undefined }, events: batch };
    let r;
    try {
      r = await vocion.post(`/worker-runs/${state.runId}/heartbeat`, body);
    } catch (e) {
      log('heartbeat.error', { error: String(e.message || e) }); break;
    }
    if (!r.ok) {
      if (looksLikeEventsRejection(r.status, r.json)) {
        eventLog.disable(); log('events.disabled', { status: r.status, error: r.json?.error });
      }
      break;
    }
    eventLog.ack(batch, r.json?.eventsAccepted);
  }
  return eventLog.isDisabled() ? [] : eventLog.nextBatch();
}
function startHeartbeat() {
  if (!vocion.enabled) {
    return;
  }
  heartbeatTimer = setInterval(() => {
    heartbeat().catch(() => {});
  }, cfg.heartbeatSeconds * 1000);
  heartbeatTimer.unref();
}
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
}

function killClaude(reason) {
  const c = state.claude;
  if (!c) {
    return;
  }
  state.killReason = reason;
  log('claude.kill', { reason });
  try {
    c.kill('SIGCONT');
  } catch {}
  try {
    c.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    try {
      c.kill('SIGKILL');
    } catch {}
  }, 10000).unref();
}

// ---------- shell helpers ----------

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd || REPO_DIR, env: { ...process.env, ...gitAuthEnv(), ...(opts.env || {}) }, timeout: (opts.timeoutSeconds || 600) * 1000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? (r.signal ? 128 : 1), stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal || null };
}
function must(cmd, args, opts = {}) {
  const r = sh(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.code}): ${(r.stderr || r.stdout).trim().slice(-800)}`);
  }
  return r.stdout;
}
// Git authenticates through a credential helper fed from the environment, so the token is never in
// a remote URL, in .git/config, or on disk.
function gitAuthEnv() {
  if (!cfg.githubToken) {
    return {};
  }
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '!f() { echo username=x-access-token; echo "password=$GITHUB_TOKEN"; }; f',
    GIT_TERMINAL_PROMPT: '0',
  };
}
function tail(s, n = 20) {
  return String(s || '').trim().split('\n').slice(-n).join('\n').slice(-4000);
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function slugify(s, max = 40) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'task';
}
function refExistsOnOrigin(ref) {
  const r = sh('git', ['ls-remote', '--exit-code', '--heads', 'origin', ref], { timeoutSeconds: 60 }); return r.code === 0;
}
const NO_EM_DASH = String.fromCharCode(0x2014);
function hasEmDash(s) {
  return String(s || '').includes(NO_EM_DASH);
}
// ---------- scope, and what a person owns ----------
//
// allowed_paths is the plan's scope: where it expects the change to land. It is where the engineer
// starts, not a fence (Chris, 2026-09-30: "engineering should be free to be creative and improve
// and expand execution where needed... The goal should be the outcome. Not a rigid set of files").
// A file beyond it is kept, committed and named on the pull request as beyond the plan, and QA
// reads the diff. What stays off limits is what a person owns, the same list hooks/guard-write.sh
// blocks: secrets and env files, .git, CI workflows, and the factory's own hooks and settings
// (humanOwned, keep.mjs, plus the contract's human_owned).

function pathAllowed(rel, globs) {
  return (globs || []).some(g => globMatches(g, rel));
}

// ---------- task contract ----------
//
// The contract is validated against factory/contracts/schema.json (contract.mjs) before anything is
// cloned. Required fields are never defaulted: a contract with camelCase keys, an empty acceptance
// contract or a check the worker cannot run is refused with every problem named. Only the optional
// fields (dependencies, model_policy, environment, attempt, token_budget_usd, wall_clock_minutes)
// get defaults, and the `task` log line says which ones were applied.

function taskFromRun(run) {
  const input = run?.input || {};
  if (input.task && typeof input.task === 'object') {
    return { raw: input.task, synthesized: false };
  }
  const message = typeof input.message === 'string' ? input.message : (typeof input.prompt === 'string' ? input.prompt : '');
  if (!message) {
    throw new Error('run.input has neither task nor message');
  }
  if (!cfg.defaultRepo) {
    throw new Error('run.input carries only a message, and this runner has no DEFAULT_REPO to write a docs task in; queue the run with a task contract');
  }
  log('task.synthesized', { from: 'input.message', risk_class: 'docs', allowed_paths: ['docs/**'] });
  return {
    synthesized: true,
    raw: {
      task_id: `run-${run.id}`,
      product: cfg.defaultProduct,
      repo: cfg.defaultRepo,
      base_sha: 'origin/main',
      objective: message,
      request_id: `vocion:worker-run:${run.id}`,
      acceptance_contract: ['Every changed file is inside docs/**', 'No changed file contains an em dash (U+2014)'],
      allowed_paths: ['docs/**'],
      risk_class: 'docs',
      required_checks: ['no-em-dashes'],
    },
  };
}

// Throws ContractError listing every problem. The worker's own limits are the defaults for the budgets.
function validateTask(raw) {
  return normalizeContract(raw, { token_budget_usd: cfg.maxBudgetUsd, wall_clock_minutes: cfg.wallClockMinutes });
}

// One line in the run log saying what the plan rule decided and what the contract carried, so a
// reader of the log can tell an approved plan from a recorded skip from a task that needed neither.
function planLogLine(t) {
  const decision = planRequirement(t);
  const plan = t.plan;
  return {
    level: decision.level,
    triggers: decision.triggers.map(x => x.code),
    unknown: decision.unknown,
    carried: plan ? (plan.skipped ? 'skipped' : 'approved') : 'none',
    plan_id: plan?.plan_id,
    skip_reason: plan?.skip_reason,
  };
}

function renderTaskMarkdown(t, runId) {
  const list = a => (a && a.length ? a.map(x => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '- (none)');
  return [
    `# Engineering task ${t.task_id}`,
    '',
    `Vocion worker run: ${runId}`,
    `Product: ${t.product}`,
    `Repository: ${t.repo} at ${t.base_sha} (already cloned in the current directory, on your working branch)`,
    `Risk class: ${t.risk_class}`,
    t.request_id ? `Request: ${t.request_id}` : '',
    '',
    '## Objective',
    '',
    t.objective,
    '',
    '## Acceptance contract (observable definition of done)',
    '',
    list(t.acceptance_contract),
    '',
    '## Planned paths (where the plan expects the change)',
    '',
    list(t.allowed_paths),
    '',
    'Start here, and go wherever the outcome needs: another package, a migration, a shared type, a test, a fix to something in the way. Every file beyond these paths is named on the pull request; say in your report why each one was needed.',
    '',
    '## Required checks the worker runs after you finish',
    '',
    list(t.required_checks),
    '',
    t.plan && !t.plan.skipped ? `## Approved plan\n\nThis work was planned and the plan was approved${t.plan.approved_by ? ` by ${t.plan.approved_by}` : ''}${t.plan.plan_id ? ` (${t.plan.plan_id})` : ''}${t.plan.url ? `: ${t.plan.url}` : ''}. Build the outcome it describes. Where the plan is wrong or incomplete, do what the outcome needs and say in your report what you changed from the plan and why.\n${t.plan.summary ? `\n${t.plan.summary}\n` : ''}` : '',
    t.plan && t.plan.skipped ? `## Plan\n\nA plan was offered and declined: ${t.plan.skip_reason}\n` : '',
    t.notes ? `## Notes\n\n${t.notes}\n` : '',
    t.qa?.flows?.length ? `## QA evidence\n\nAfter the checks pass, the worker screenshots these paths on production and on your branch, at the viewports named, and posts them on the task: ${t.qa.flows.map(f => `${f.name} (${f.path}, ${(f.viewports || ['desktop']).join(' and ')})`).join('; ')}. Keep those paths loading.\n\nQA judges every acceptance criterion against a picture of THAT state, and one picture of a page at rest proves nothing about typing, filtering or an empty result. So for each criterion a person can see, write a flow into \`${QA_FLOWS_FILE}\` (outside the repo; it is not a change) that reaches the state and shoots it:\n\n\`\`\`json\n{ "flows": [ { "name": "<the criterion, short>", "criterion": "<the acceptance line, as written>", "path": "/", "viewports": ["desktop"], "steps": [ { "wait_for": "<text or selector>" }, { "fill": { "selector": "input[type=search]", "value": "kes" } }, { "shoot": "<what this shows>" } ] } ] }\n\`\`\`\n\nSteps name exactly one of wait_for, click, fill, upload ({ selector, megabytes }: a generated file into a file input), offline (true drops the network, false restores it), shoot. To show a bad-connection state: upload, wait for progress, offline: true, wait_for the message, shoot. Up to ${ENGINEER_FLOW_LIMITS.flows} flows of ${ENGINEER_FLOW_LIMITS.steps} steps.\n\nThe worker holds each flow to what it claims:\n- A criterion that is reached by doing something (a dialog that opens, a click, a toggle turned on, a row that shows after a send) needs the steps that do it: at least one click, fill, upload or offline before the shoot. A flow that names one and only looks at the page is refused.\n- A step that fails (a selector that matched nothing) makes every shot after it NOT EVIDENCE, and the report says which step. Targets are the visible text or accessible name (\`"Remind"\`), a CSS selector, or a Playwright selector (\`text=Remind\`, \`button:has-text('Send reminder')\`, \`[role=switch]\`).\n- A shot byte-for-byte the same as another flow's is marked a duplicate and proves nothing for its criterion. Two criteria are two different pictures.\n\nCheck your flows before you finish: \`node ${path.join(WORKER_HOME, 'contract.mjs')} check-flows ${QA_FLOWS_FILE}\` prints every refusal.\n\nThe after build is built from YOUR branch${t.qa.flows.some(f => f.sign_in) ? ' in the repository\'s preview mode, signed in with its sample account' : ''}. ${surfaceOf(t.qa).preview_note ? `${surfaceOf(t.qa).preview_note} ` : ''}When your change adds a state a criterion needs (a row in a new state, an error), put that state in the preview's data in this change and point the flow at it. A criterion a screenshot cannot show is covered below.\n` : '',
    `## Criteria a screenshot cannot show\n\nA query scope, a URL, a plan limit, a migration: prove each with a test, and name it in \`${CRITERIA_TESTS_FILE}\` (outside the repo) so the pull request lists it and QA can open it:\n\n\`\`\`json\n{ "tests": [ { "criterion": "<the acceptance line, as written>", "file": "<path/to/x.test.ts>", "name": "<the it() or test() name, exactly>" } ] }\n\`\`\`\n\nThe worker keeps an entry only when that file is in your branch and contains that test name. A criterion with neither a shot nor a named test is recorded as unproven.\n`,
    state.services.length ? `## Services\n\nRunning for this task: ${state.services.join(', ')}. ${Object.keys(state.serviceEnv).join(' and ')} ${Object.keys(state.serviceEnv).length === 1 ? 'is' : 'are'} set in your environment, and each service's setup (its migrations) has run, so the suites that need it run.\n` : '',
    t.engineer_rules?.length ? `## This repository's rules\n\n${t.engineer_rules.map(r => `- ${r}`).join('\n')}\n` : '',
    '## When you are done',
    '',
    'Leave the changes in the working tree. Do not commit, push, or open a PR; the worker does that after verification.',
    'Finish with a short plain-text report: what you changed, how you verified it, and any assumption you made.',
  ].filter(l => l !== undefined && l !== null).join('\n');
}

/**
 * The rules every engineer run carries, whatever the repository. A repository's own (voice, a house
 * style a check enforces) ride the contract's engineer_rules and the prompt's section for them.
 */
function standingRules(t) {
  const lines = [
    'You are the engineer inside a Vocion software factory. One task, one branch. The goal is the outcome in the acceptance contract, working and proven: build it, test it, fix what stands in the way, and confirm it against reality.',
    '',
    'Rules, enforced by hooks and by a deterministic verifier that runs after you exit:',
    `- The plan's paths are where to start, not a fence. Change whatever the outcome needs inside the repository. Off limits, because a person owns them: secrets and env files, .git, .github/workflows${t?.human_owned?.length ? `, ${t.human_owned.join(', ')}` : ''}.`,
    '- Do not run git commit, git push, git merge, gh pr create or any deploy or publish command. The worker commits and opens the PR.',
    '- A schema change is a migration (the repo\'s migrations directory), never CREATE/ALTER/DROP TABLE in application code; the worker fails a change that does it.',
    '- Never read or print secrets: .env files, ~/.aws, ~/.ssh, *.pem, tokens in the environment.',
    ...((t?.required_checks || []).includes('no-em-dashes') ? ['- No em dashes anywhere (the character U+2014). Use a comma, a colon, a period, or restructure the sentence. The verifier greps for it.'] : []),
    '- Verify against reality, not against green output: open the file you wrote, run the command, read the result.',
    '- Follow CLAUDE.md (or AGENTS.md) in the repository for voice and conventions.',
    '- Stop only when a criterion is impossible as written. Then say exactly which criterion and why in your final message, and do everything else.',
    '- Temporary files go in /workspace/scratch, never in the repository.',
  ];
  return lines.join('\n');
}

// ---------- phases ----------

async function claimRun(id) {
  setPhase('claim', `run ${id}`);
  const r = await vocion.post(`/worker-runs/${id}/claim`, { workerId, workerVersion: WORKER_VERSION, target: cfg.target });
  if (r.status === 402 || r.status === 409) {
    log('claim.refused', { status: r.status, error: r.json?.error });
    return null;
  }
  if (!r.ok) {
    throw new Error(`claim failed: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const run = r.json.run;
  log('claimed', { attempt: run.attempt, leaseExpiresAt: r.json.leaseExpiresAt, capCents: run.capCents, endsAt: run.endsAt, kind: run.kind, agentSlug: run.agentSlug });
  return run;
}

async function pollForRun() {
  setPhase('poll', `${cfg.agentSlug ? `agentSlug=${cfg.agentSlug}` : 'any engineer'} up to ${cfg.pollMaxSeconds}s`);
  const deadline = Date.now() + cfg.pollMaxSeconds * 1000;
  const query = `status=queued&kind=worker${cfg.agentSlug ? `&agentSlug=${encodeURIComponent(cfg.agentSlug)}` : ''}&limit=1`;
  while (Date.now() < deadline) {
    const r = await vocion.get(`/worker-runs?${query}`);
    if (r.ok && Array.isArray(r.json?.runs) && r.json.runs.length) {
      return String(r.json.runs[0].id);
    }
    if (!r.ok) {
      log('poll.error', { status: r.status, error: r.json?.error });
    }
    await sleep(cfg.pollEverySeconds * 1000);
  }
  return null;
}

function prepareRepo(task, run) {
  setPhase('prepare', `clone ${task.repo} at ${task.base_sha}`);
  fs.rmSync(REPO_DIR, { recursive: true, force: true });
  fs.mkdirSync(cfg.workspace, { recursive: true });
  must('git', ['clone', '--quiet', task.repo, REPO_DIR], { cwd: cfg.workspace, timeoutSeconds: 900 });
  const base = classifyBase(task.base_sha);
  let baseRef = base.ref;
  if (base.kind !== 'sha') {
    if (!refExistsOnOrigin(base.ref)) {
      throw new Error(`base_sha names ${base.ref}, which is not a branch on origin (and not a commit sha)`);
    }
    must('git', ['fetch', '--quiet', 'origin', base.ref]);
    baseRef = `origin/${base.ref}`;
  }
  const baseSha = must('git', ['rev-parse', baseRef]).trim();
  must('git', ['checkout', '--quiet', '--detach', baseSha]);
  const attempt = effectiveAttempt(run?.attempt, task.attempt);
  let branch = `factory/${slugify(task.task_id, 48)}-${slugify(task.objective, 32)}${attempt > 1 ? `-a${attempt}` : ''}`;
  if (refExistsOnOrigin(branch)) {
    branch += `-r${slugify(String(state.runId), 16)}`;
  } // never push over an earlier attempt's branch
  must('git', ['checkout', '--quiet', '-b', branch]);

  // A branch in base_sha is a resume (a factory/...-wip-... branch a failed run kept, or any other
  // branch). The working branch starts from it and is rebased on origin/main before Claude starts,
  // so the PR that follows lands on today's main. A rebase that does not apply cleanly fails the
  // run here, at cost 0, with the conflicting files in the note.
  let resumedFrom = null;
  if (base.resume) {
    must('git', ['fetch', '--quiet', 'origin', 'main']);
    const mainSha = must('git', ['rev-parse', 'origin/main']).trim();
    const ahead = Number(must('git', ['rev-list', '--count', `origin/main..${baseSha}`]).trim()) || 0;
    const rebase = sh('git', ['rebase', '--quiet', 'origin/main'], { timeoutSeconds: 300 });
    if (rebase.code !== 0) {
      const conflicts = sh('git', ['diff', '--name-only', '--diff-filter=U']).stdout.trim().split('\n').filter(Boolean);
      sh('git', ['rebase', '--abort']);
      throw new Error(`resume branch ${base.ref} does not rebase cleanly on origin/main (${conflicts.join(', ') || tail(rebase.stderr || rebase.stdout, 4)}); resolve it by hand or pass a sha`);
    }
    resumedFrom = { ref: base.ref, sha: baseSha, commits: ahead, rebased_onto: mainSha, head: must('git', ['rev-parse', 'HEAD']).trim() };
    log('resumed', resumedFrom);
  }
  const headBranch = must('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  log('prepared', { branch: headBranch, base_sha: baseSha, attempt, resumed_from: resumedFrom || undefined });
  return { branch: headBranch, baseSha, attempt, resumedFrom };
}

// ---------- services and dependencies ----------

// npm ci once per run, without dependency scripts; then the repo's own postinstall (a generated
// client, say), which the checks and the tests need.
function ensureInstalled() {
  if (fs.existsSync(path.join(REPO_DIR, 'node_modules'))) {
    return { ok: true };
  }
  log('install', { note: 'npm ci --ignore-scripts, then the repo postinstall' });
  const inst = sh('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { timeoutSeconds: 900 });
  if (inst.code !== 0) {
    return { ok: false, tail: `npm ci failed: ${tail(inst.stderr || inst.stdout, 15)}` };
  }
  const post = sh('npm', ['run', 'postinstall', '--if-present', '--silent'], { timeoutSeconds: 600 });
  if (post.code !== 0) {
    return { ok: false, tail: `postinstall failed: ${tail(post.stderr || post.stdout, 15)}` };
  }
  return { ok: true };
}

function waitForTcp(url, seconds) {
  const u = new URL(url);
  const port = Number(u.port) || 5432;
  const host = u.hostname || 'localhost';
  const deadline = Date.now() + seconds * 1000;
  return new Promise((resolve) => {
    const attempt = () => {
      const sock = net.connect({ host, port });
      const done = (ok) => {
        sock.destroy(); if (ok || Date.now() > deadline) {
          resolve(ok);
        } else {
          setTimeout(attempt, 2000);
        }
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      sock.setTimeout(3000, () => done(false));
    };
    attempt();
  });
}

// environment.services from the contract. The target provides each service (a sidecar, a compose
// service); the runner waits for it, exports its url, runs the setup commands the repo record
// names (its migrations), then environment.setup. A service that never answers fails the run here,
// before any model call, with the address it waited on.
async function startServices(task) {
  const wanted = (task.environment?.services || []).map(e => serviceSpec(e, { postgresUrl: cfg.postgresUrl }));
  const setup = Array.isArray(task.environment?.setup) ? task.environment.setup : [];
  if (!wanted.length && !setup.length) {
    return;
  }
  setPhase('services', wanted.map(w => w.name).join(',') || 'setup');
  for (const svc of wanted) {
    if (svc.name !== 'postgres') {
      throw new Error(`service ${svc.name} is not one this runner can wait for`);
    }
    const up = await waitForTcp(svc.url, cfg.servicesWaitSeconds);
    if (!up) {
      throw new Error(`contract asks for postgres but nothing listens at ${new URL(svc.url).host} after ${cfg.servicesWaitSeconds}s; this target starts no database beside the runner (the Fargate target's -db task definition, the on-box compose service, or RUNNER_POSTGRES_URL names one)`);
    }
    for (const k of svc.env) {
      state.serviceEnv[k] = svc.url;
    }
    Object.assign(process.env, state.serviceEnv);
    const inst = ensureInstalled();
    if (!inst.ok) {
      throw new Error(inst.tail);
    }
    for (const cmd of svc.setup) {
      const r = sh('sh', ['-c', cmd], { timeoutSeconds: 600 });
      if (r.code !== 0) {
        throw new Error(`${svc.name} setup \`${cmd}\` failed: ${tail(r.stderr || r.stdout, 15)}`);
      }
      log('service.setup', { service: svc.name, command: cmd, tail: tail(r.stdout, 3) });
    }
    state.services.push(svc.name);
    log('service.started', { service: svc.name, host: new URL(svc.url).host });
  }
  if (setup.length) {
    const inst = ensureInstalled();
    if (!inst.ok) {
      throw new Error(inst.tail);
    }
    for (const cmd of setup) {
      const r = sh('sh', ['-c', cmd], { timeoutSeconds: 600 });
      if (r.code !== 0) {
        throw new Error(`setup \`${cmd}\` failed: ${tail(r.stderr || r.stdout, 15)}`);
      }
      log('setup', { command: cmd, tail: tail(r.stdout, 3) });
    }
  }
  log('services_started', { services_started: state.services });
}

function runClaude(task, runId) {
  const model = task.model_policy.model || cfg.defaultModel;
  const budget = Math.min(cfg.maxBudgetUsd, num(task.token_budget_usd, cfg.maxBudgetUsd));
  const wallSeconds = Math.min(cfg.wallClockMinutes, num(task.wall_clock_minutes, cfg.wallClockMinutes)) * 60;
  const claudeTimeout = Math.max(300, wallSeconds - LAND_RESERVE_SECONDS);
  setPhase('claude', `model=${model} budget=$${budget} timeout=${claudeTimeout}s`);

  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--max-budget-usd',
    String(budget),
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    'Read',
    'Edit',
    'Write',
    'MultiEdit',
    'Glob',
    'Grep',
    'Bash',
    'TodoWrite',
    'Task',
    '--disallowedTools',
    'WebSearch',
    'NotebookEdit',
    '--settings',
    path.join(cfg.runnerHome, 'claude-settings.json'),
    '--append-system-prompt',
    standingRules(task),
    '--model',
    model,
    '--no-session-persistence',
  ];
  if (task.model_policy.effort) {
    args.push('--effort', String(task.model_policy.effort));
  }
  if (task.model_policy.escalate_to) {
    args.push('--fallback-model', String(task.model_policy.escalate_to));
  }

  // The agent never sees the GitHub or Vocion credentials; it only needs the Anthropic key.
  const childEnv = { ...process.env };
  for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'VOCION_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_AUTHORIZATION_TOKEN']) {
    delete childEnv[k];
  }
  Object.assign(childEnv, state.serviceEnv, {
    // The hooks fence the repository, not the plan's scope (humanOwned, keep.mjs).
    RUNNER_ALLOWED_PATHS: JSON.stringify(['**']),
    RUNNER_HUMAN_OWNED: JSON.stringify(task.human_owned || []),
    RUNNER_REPO: REPO_DIR,
    RUNNER_RUN_ID: String(runId),
    RUNNER_TOOL_LEDGER: path.join(LOG_DIR, 'tools.jsonl'),
    CLAUDE_PROJECT_DIR: REPO_DIR,
  });

  const prompt = renderTaskMarkdown(task, runId);
  fs.writeFileSync(path.join(LOG_DIR, 'prompt.md'), prompt);

  const streamPath = path.join(LOG_DIR, 'claude.stream.jsonl');
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cfg.claudeBin, args, { cwd: REPO_DIR, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    state.claude = child;
    let out = '';
    let err = '';
    let finalResult = null;
    const messages = [];
    // Every line is one Claude Code message the moment it prints, not just at exit: a tool call
    // reaches the run's event buffer (and, debounced, an early heartbeat) as it happens.
    const splitter = lineSplitter((line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      messages.push(message);
      const events = messageEvents(message);
      for (const ev of events) {
        eventLog.add(ev.phase, ev);
      }
      if (events.length) {
        requestEarlyHeartbeat();
      }
      if (isFinalResult(message)) {
        finalResult = message;
      }
    });
    child.stdout.on('data', (d) => {
      const s = d.toString(); out += s; splitter.push(s);
    });
    child.stderr.on('data', (d) => {
      err += d; if (err.length > 200000) {
        err = err.slice(-100000);
      }
    });
    child.stdin.end(prompt);
    const timer = setTimeout(() => killClaude(`wall clock: claude exceeded ${claudeTimeout}s`), claudeTimeout * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      state.claude = null;
      splitter.flush();
      fs.writeFileSync(streamPath, out);
      fs.writeFileSync(path.join(LOG_DIR, 'claude.stderr.log'), err);
      // The last `type: result` line is exactly what --output-format json used to print whole, so
      // everything below reads it identically.
      const result = finalResult;
      const durationS = Math.round((Date.now() - started) / 1000);
      const costUsd = Number(result?.total_cost_usd) || 0;
      const modelUsage = result?.modelUsage || {};
      const model = Object.entries(modelUsage).sort((a, b) => (b[1]?.costUSD || 0) - (a[1]?.costUSD || 0))[0]?.[0] || null;
      const usage = result?.usage || {};
      state.costUsd += costUsd;
      state.model = model || state.model;
      state.counts.turns = Number(result?.num_turns) || 0;
      state.counts.permissionDenials = Array.isArray(result?.permission_denials) ? result.permission_denials.length : 0;
      if (model) {
        state.pendingUsage = {
          model,
          inputTokens: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
          outputTokens: usage.output_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cents: Math.round(costUsd * 100),
        };
      }
      log('claude.finished', {
        exit_code: code,
        signal,
        duration_s: durationS,
        cost_usd: round2(costUsd),
        model,
        turns: result?.num_turns,
        is_error: result?.is_error,
        subtype: result?.subtype,
        permission_denials: state.counts.permissionDenials,
        result_preview: String(result?.result || '').slice(0, 300),
        stderr_tail: code === 0 ? undefined : tail(err, 8),
      });
      resolve({ code, signal, result, costUsd, model, usage, modelUsage, durationS, stderrTail: tail(err, 20), stderrFull: err, rawTail: result ? undefined : tail(out, 20), messages, streamPath });
    });
  });
}

function changedFiles() {
  const out = must('git', ['status', '--porcelain=v1', '-z', '-uall']);
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (!e) {
      continue;
    }
    const code = e.slice(0, 2);
    const p = e.slice(3);
    if (code[0] === 'R' || code[0] === 'C') {
      files.push(p); files.push(parts[++i]);
    } else {
      files.push(p);
    }
  }
  return [...new Set(files.filter(Boolean))];
}

function verify(task) {
  setPhase('verify');
  const files = changedFiles();
  const owns = f => humanOwned(f, task.human_owned);
  const owned = files.filter(owns);
  const beyondPlan = files.filter(f => !owns(f) && !pathAllowed(f, task.allowed_paths));
  const checks = [];
  // Each command check's full stdout+stderr, keyed by check name; never sent to Vocion in the
  // body (that still carries only `tail`), only uploaded to the log bucket and linked.
  const outputs = {};
  if (owned.length) {
    return { ok: false, files, beyondPlan, checks, outputs, error: `changes to files a person owns (secrets, .git, CI workflows, the repository's own list): ${owned.join(', ')}` };
  }
  if (beyondPlan.length) {
    log('verify.beyond_plan', { files: beyondPlan });
  }
  // With no changes the checks still run: they say whether the base itself is green, which is what
  // a "make no code change" contract or a resumed branch is asking.
  if (!files.length) {
    log('verify.no_changes', { note: 'no changes in the working tree; running the required checks on the base anyway' });
  }

  const pkg = readJson(path.join(REPO_DIR, 'package.json')) || {};
  const scripts = pkg.scripts || {};
  // A check the repo record gives a command runs that command, exactly as written there (checkPlan).
  for (const step of checkPlan(task, scripts)) {
    const { name } = step;
    const t0 = Date.now();
    let rec;
    if (step.kind === 'em-dashes') {
      const hits = [];
      for (const f of files) {
        const fp = path.join(REPO_DIR, f);
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
          continue;
        }
        const lines = fs.readFileSync(fp, 'utf8').split('\n');
        lines.forEach((l, i) => {
          if (hasEmDash(l)) {
            hits.push(`${f}:${i + 1}`);
          }
        });
      }
      rec = { name, status: hits.length ? 'failed' : 'passed', exit_code: hits.length ? 1 : 0, tail: hits.length ? `em dash (U+2014) found at ${hits.slice(0, 20).join(', ')}` : `no em dash in ${files.length} changed file(s)` };
    } else if (step.kind === 'skipped') {
      rec = { name, status: 'skipped', exit_code: null, tail: step.reason };
    } else {
      const inst = ensureInstalled();
      if (!inst.ok) {
        rec = { name, status: 'failed', exit_code: 1, tail: inst.tail }; outputs[name] = inst.tail;
      }
      if (!rec) {
        const r = sh('sh', ['-c', step.command], { timeoutSeconds: 1200 });
        const full = `${r.stdout}\n${r.stderr}`;
        outputs[name] = full;
        rec = { name, status: r.code === 0 ? 'passed' : 'failed', exit_code: r.code, tail: tail(full, 25), ...(step.kind === 'command' ? { command: step.command } : {}) };
      }
    }
    rec.duration_s = Math.round((Date.now() - t0) / 1000);
    checks.push(rec);
    log('check', rec);
  }
  // Always run, whatever the contract lists: a schema change is a migration.
  if (files.length) {
    const read = (rel) => {
      const fp = path.join(REPO_DIR, rel); return fs.existsSync(fp) && !fs.statSync(fp).isDirectory() ? fs.readFileSync(fp, 'utf8') : null;
    };
    const hits = runtimeDdlHits(files, read);
    const rec = { name: 'no-runtime-ddl', status: hits.length ? 'failed' : 'passed', exit_code: hits.length ? 1 : 0, tail: hits.length ? `schema change in application code (put it in a migration): ${hits.slice(0, 20).join(', ')}` : 'no table or index changes outside migrations', duration_s: 0 };
    checks.push(rec);
    log('check', rec);
  }
  const failed = checks.filter(c => c.status === 'failed');
  if (!files.length) {
    return { ok: false, files, beyondPlan, checks, outputs, noChanges: true, error: `Claude produced no changes in the working tree (checks on the base: ${checks.map(c => `${c.name}=${c.status}`).join(', ') || 'none'})` };
  }
  return { ok: failed.length === 0, files, beyondPlan, checks, outputs, error: failed.length ? `required checks failed: ${failed.map(c => c.name).join(', ')}` : null };
}

function modelDisplayName(id) {
  if (!id) {
    return 'Claude';
  }
  const parts = String(id).replace(/^claude-/, '').split('-').filter(p => !/^\d{8}$/.test(p));
  const name = parts.shift() || '';
  const version = parts.filter(p => /^\d+$/.test(p)).join('.');
  return `Claude ${name.charAt(0).toUpperCase()}${name.slice(1)}${version ? ` ${version}` : ''}`.trim();
}

/**
 * The engineer's named tests (criteria-tests.json), each kept only when it is in the branch, then
 * run by itself here, and the output stored in Vocion on the task: QA runs nothing, so the proof
 * it opens is this run's output. A named test that does not pass is dropped from the pull request.
 */
async function provenByTests(recordId, runId) {
  if (!fs.existsSync(CRITERIA_TESTS_FILE)) {
    return { proofs: [], runLink: null, notRun: [], allSkipped: [] };
  }
  const read = (rel) => {
    const f = path.join(REPO_DIR, rel); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  const { proofs, refused } = criterionTests(fs.readFileSync(CRITERIA_TESTS_FILE, 'utf8'), read);
  const runs = proofs.map((p) => {
    // The package the test lives in (apps/<x> or packages/<x>), where vitest runs.
    const parts = p.file.split('/');
    const ws = ['apps', 'packages'].includes(parts[0]) && parts.length > 2 && fs.existsSync(path.join(REPO_DIR, parts[0], parts[1], 'package.json')) ? path.join(parts[0], parts[1]) : '.';
    const rel = ws === '.' ? p.file : parts.slice(2).join('/');
    // -t is a regular expression: a name with a bracket or a question mark must match itself.
    const args = ['vitest', 'run', rel, '-t', testNamePattern(p.name), '--reporter=verbose'];
    // Plain text: the stored run is read by QA and by people, and color codes made it noise.
    // The services' env (DATABASE_URL, TEST_DATABASE_URL) is in process.env since startServices, so sh passes it on.
    const r = sh('npx', args, { cwd: path.join(REPO_DIR, ws), timeoutSeconds: 300, env: { NO_COLOR: '1', FORCE_COLOR: '0' } });
    const output = `${r.stdout}\n${r.stderr}`;
    const { status, line } = namedTestStatus(output, p.name, r.code);
    const reason = status === 'skipped' ? skipReason(read(p.file), p.name, process.env) : '';
    return { ...p, passed: status === 'passed', status, line, reason, command: `cd ${ws} && npx ${args.map(a => (/[\s()[\]?*+|^$\\]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`, output: output.slice(-6000) };
  });
  const notRun = runs.filter(r => !r.passed);
  const allSkipped = criteriaAllSkipped(runs);
  // Loud: a criterion whose every named test was skipped has no test proof at all, whatever the
  // exit code said. It is an error line, a known failure on the result, and a line in the PR.
  for (const c of allSkipped) {
    log('criteria.tests.all_skipped', { level: 'error', criterion: c.criterion.slice(0, 200), reasons: c.reasons });
  }
  let runLink = null;
  if (runs.length && vocion.enabled && recordId) {
    const md = testRunMarkdown(runs, runId);
    const passedCount = runs.filter(r => r.passed).length;
    const skippedCount = runs.filter(r => r.status === 'skipped').length;
    const caption = `${passedCount} of ${runs.length} named tests passed on the branch${skippedCount ? `, ${skippedCount} not run (skipped)` : ''}${allSkipped.length ? `; ${allSkipped.length} criteria with no named test that ran` : ''}`;
    const res = await publishArtifact((p, body) => vocion.post(p, body), { recordType: 'object', recordId: String(recordId), recordRole: 'qa-test-run', kind: 'markdown', title: `Named tests, run ${runId}`, spec: { md, title: `Named tests, run ${runId}`, summary: caption, caption } });
    if (res.ok && res.id) {
      runLink = `${cfg.vocionUrl}/dashboard/artifacts/${res.id}`;
    }
  }
  log('criteria.tests', { kept: proofs.length, passed: runs.filter(r => r.passed).length, not_run: notRun.map(r => `${r.name.slice(0, 80)}: ${verdictText(r)}`).slice(0, 8), refused: refused.slice(0, 8), stored: Boolean(runLink) });
  return { proofs: runs.filter(r => r.passed), runLink, notRun, allSkipped };
}

function land(task, runId, verification, claude, prepared, evidence = null, tests = { proofs: [], runLink: null }) {
  setPhase('land', `commit and push ${prepared.branch}`);
  must('git', ['add', '-A', '--', ...verification.files]);
  const title = taskHeadline(task, { max: 72 });
  const message = [
    `${task.risk_class}: ${title}`,
    '',
    task.objective.trim(),
    '',
    `Task: ${task.task_id}${task.request_id ? ` (request ${task.request_id})` : ''}`,
    `Checks: ${verification.checks.map(c => `${c.name}=${c.status}`).join(', ') || 'none'}`,
    '',
    `Vocion-Worker-Run: ${runId}`,
    `Co-Authored-By: ${modelDisplayName(claude.model)} <noreply@anthropic.com>`,
  ].map(plainDashes).join('\n');
  if (hasEmDash(message)) {
    throw new Error('commit message contains an em dash');
  }
  fs.writeFileSync(path.join(SCRATCH_DIR, 'commit-msg.txt'), message);
  must('git', ['commit', '--quiet', '-F', path.join(SCRATCH_DIR, 'commit-msg.txt')]);
  const commitSha = must('git', ['rev-parse', 'HEAD']).trim();
  must('git', ['push', '--quiet', '-u', 'origin', prepared.branch], { timeoutSeconds: 300 });
  log('pushed', { branch: prepared.branch, commit_sha: commitSha });

  // A PERSON READS THIS FIRST (2026-09-26): the body opened with the raw
  // contract JSON. Now it leads with what changed and how to check it, and
  // the contract folds underneath for whoever wants the machine's view.
  const passed = verification.checks.filter(c => c.status === 'passed').length;
  const body = [
    `## ${taskHeadline(task, { max: 90 })}`,
    '',
    task.objective.trim(),
    '',
    `**Checks:** ${passed} of ${verification.checks.length} passed${task.request_id ? ` · request #${task.request_id}` : ''}${task.plan?.plan_id ? ` · plan #${task.plan.plan_id}` : ''}`,
    '',
    '### Done when',
    '',
    ...(task.acceptance_contract || []).map(a => `- [ ] ${a}`),
    '',
    ...(task.qa?.flows?.length ? ['### Try it', '', ...task.qa.flows.map(f => `- ${f.name}: open \`${f.path}\`${f.sign_in ? ' signed in' : ''}`), ''] : []),
    ...evidenceSection(evidence?.evidence, vocion.enabled ? id => `${cfg.vocionUrl}/dashboard/artifacts/${id}` : null),
    ...refusedFlowsSection(evidence?.refusedFlows),
    ...testsSection(tests.proofs, rel => `https://github.com/${repoName(task.repo)}/blob/${commitSha}/${rel}`, tests.runLink, tests.notRun),
    '<details><summary>Task contract</summary>',
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
    '</details>',
    '',
    '## Verification',
    '',
    `Changed files${verification.beyondPlan?.length ? ` (${verification.beyondPlan.length} beyond the plan's paths; the report says why)` : ''}:`,
    ...verification.files.map(f => `- \`${f}\`${verification.beyondPlan?.includes(f) ? ' (beyond the plan)' : ''}`),
    '',
    '| check | status | exit | detail |',
    '|---|---|---|---|',
    ...verification.checks.map(c => `| ${c.name} | ${c.status} | ${c.exit_code ?? ''} | ${String(c.tail || '').split('\n').slice(-1)[0].replace(/\|/g, '\\|').slice(0, 160)} |`),
    '',
    '## Run',
    '',
    `- Vocion worker run: \`${runId}\``,
    `- Worker: \`${workerId}\``,
    `- Model: \`${claude.model || 'unknown'}\`, cost $${round2(claude.costUsd)}, ${claude.result?.num_turns ?? '?'} turns, ${claude.durationS}s`,
    `- Base: \`${prepared.baseSha}\`${prepared.resumedFrom ? ` (resumed from \`${prepared.resumedFrom.ref}\` at \`${prepared.resumedFrom.sha}\`, rebased on \`${prepared.resumedFrom.rebased_onto}\`)` : ''}`,
    '',
    '## Agent report',
    '',
    String(claude.result?.result || '(none)').slice(0, 4000),
    '',
    'Opened by the Vocion runner. Review the diff against the contract; the merge follows the workspace\'s trust rule.',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n').split(NO_EM_DASH).join(',');
  fs.writeFileSync(path.join(SCRATCH_DIR, 'pr-body.md'), body);
  const pullRequestTitle = prTitle({ task });
  let prUrl = '';
  const create = sh('gh', ['pr', 'create', '--base', 'main', '--head', prepared.branch, '--title', pullRequestTitle, '--body-file', path.join(SCRATCH_DIR, 'pr-body.md')], { timeoutSeconds: 120 });
  if (create.code === 0) {
    prUrl = (create.stdout.match(/https:\/\/github\.com\/\S+\/pull\/\d+/) || [''])[0];
  } else {
    // A PR may already exist for this branch (re-claimed run). Find it instead of failing.
    const list = sh('gh', ['pr', 'list', '--head', prepared.branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], { timeoutSeconds: 60 });
    prUrl = list.stdout.trim();
    if (!prUrl) {
      throw new Error(`gh pr create failed: ${tail(create.stderr || create.stdout, 6)}`);
    }
    log('pr.existing', { pr_url: prUrl });
  }
  log('pr.opened', { pr_url: prUrl, title: pullRequestTitle });
  return { commitSha, prUrl };
}

// ---------- keeping failed work ----------

function ensureLabel(name, color, description) {
  const list = sh('gh', ['label', 'list', '--search', name, '--json', 'name', '--jq', '.[].name'], { timeoutSeconds: 60 });
  if (list.code === 0 && list.stdout.split('\n').map(l => l.trim()).includes(name)) {
    return;
  }
  const create = sh('gh', ['label', 'create', name, '--color', color, '--description', description], { timeoutSeconds: 60 });
  if (create.code !== 0 && !/already exists/i.test(create.stderr)) {
    log('label.create.failed', { name, error: tail(create.stderr, 3) });
  }
}

// The working tree after a run that did not pass. Every change but a person's files is committed on
// factory/<task_id>-wip-<run id>, pushed, and put up as a draft PR labelled checks-failed with the
// contract, the check tails, the claude preview, the cost and the line the next contract copies.
// Returns null when there is nothing to keep. Never throws: a failure to keep is logged and the run
// fails as it would have anyway.
function keepWork(task, runId, prepared, claude, verification, reason) {
  let files;
  try {
    files = changedFiles();
  } catch (e) {
    log('keep.skipped', { error: e.message }); return null;
  }
  const decision = keepDecision(files, f => !humanOwned(f, task.human_owned));
  if (!decision.keep) {
    log('keep.skipped', { note: 'no changes to keep', outside: decision.outside }); return null;
  }
  const branch = wipBranchName(task.task_id, runId);
  const attempt = prepared?.attempt || 1;
  setPhase('keep', `${reason}: ${decision.kept.length} file(s) to ${branch}`);
  try {
    must('git', ['checkout', '--quiet', '-B', branch]);
    must('git', ['add', '-A', '--', ...decision.kept]);
    const message = wipCommitMessage({ task, reason, runId, model: modelDisplayName(claude?.model) });
    fs.writeFileSync(path.join(SCRATCH_DIR, 'wip-commit-msg.txt'), message);
    must('git', ['commit', '--quiet', '-F', path.join(SCRATCH_DIR, 'wip-commit-msg.txt')]);
    const commitSha = must('git', ['rev-parse', 'HEAD']).trim();
    must('git', ['push', '--quiet', '--force', '-u', 'origin', branch], { timeoutSeconds: 300 });
    log('kept.pushed', { branch, commit_sha: commitSha, files: decision.kept.length, outside: decision.outside });

    const costUsd = round2(state.costUsd || claude?.costUsd || 0);
    const body = wipPrBody({
      task,
      runId,
      reason,
      branch,
      attempt,
      checks: verification?.checks || [],
      verificationError: verification?.error || '',
      claude,
      costUsd,
      kept: decision.kept,
      outside: decision.outside,
      workerId,
      baseSha: prepared?.baseSha || '',
      resumedFrom: prepared?.resumedFrom || null,
    });
    fs.writeFileSync(path.join(SCRATCH_DIR, 'wip-pr-body.md'), body);
    const title = wipPrTitle({ task, reason, runId });
    ensureLabel('checks-failed', 'D93F0B', 'Factory run kept unverified work as a draft PR');
    let prUrl = '';
    const create = sh('gh', ['pr', 'create', '--draft', '--base', 'main', '--head', branch, '--title', title, '--label', 'checks-failed', '--body-file', path.join(SCRATCH_DIR, 'wip-pr-body.md')], { timeoutSeconds: 120 });
    if (create.code === 0) {
      prUrl = (create.stdout.match(/https:\/\/github\.com\/\S+\/pull\/\d+/) || [''])[0];
    } else {
      const list = sh('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], { timeoutSeconds: 60 });
      prUrl = list.stdout.trim();
      if (!prUrl) {
        throw new Error(`gh pr create failed: ${tail(create.stderr || create.stdout, 6)}`);
      }
      sh('gh', ['pr', 'edit', prUrl, '--add-label', 'checks-failed', '--body-file', path.join(SCRATCH_DIR, 'wip-pr-body.md')], { timeoutSeconds: 60 });
      log('pr.existing', { pr_url: prUrl });
    }
    const kept = { branch, commitSha, prUrl, files: decision.kept, outside: decision.outside, reason, attempt, nextAttempt: attempt + 1, continue: continueLine(branch, attempt) };
    state.kept = kept;
    state.counts.prsOpened = (state.counts.prsOpened || 0) + 1;
    log('kept', { pr_url: prUrl, kept_branch: branch, commit_sha: commitSha, reason, files: decision.kept.length });
    return kept;
  } catch (e) {
    log('keep.failed', { error: e.message, branch });
    return state.kept = { branch, prUrl: '', error: e.message, reason, files: decision.kept };
  }
}

// ---------- the run's logs ----------

// Where a run's bytes live: the same QA evidence bucket qa.mjs already uploads screenshots to,
// under its own prefix. Vocion never holds these bytes, only presigned links to them.
function runLogsPrefix(taskId, runId) {
  return `runs/${slugify(String(taskId), 64)}/${slugify(String(runId), 32)}/`;
}

/**
 * Everything a person would want to open about one run, uploaded straight to S3 (never through
 * Vocion's own request body) and recorded as pointers: the prompt and a readable transcript become
 * Vocion artifacts (the way a QA screenshot does, kind 'link'), so their ids can ride in `result`
 * as transcriptArtifactId/promptArtifactId; the raw stream, stderr and each check's full output
 * are plain presigned links in `result.logLinks`, with no Vocion artifact row at all.
 *
 * Called once per run, after the outcome is known, so it never creates a duplicate artifact.
 * Nothing here can fail the run: every upload failure is logged and left out of the result.
 */
async function publishRunLogs({ task, runId, streamPath, promptPath, transcriptMarkdown, stderrText, checkOutputs }) {
  const out = { logLinks: { checks: {} } };
  if (!cfg.qaBucket) {
    return out;
  }
  let credentials = null;
  try {
    credentials = await containerCredentials();
  } catch (e) {
    log('logs.upload.failed', { file: 'credentials', error: String(e.message || e).slice(0, 200) });
  }
  const presign = { accessKeyId: cfg.qaPresignKeyId, secretAccessKey: cfg.qaPresignSecret };
  if (!credentials || !presign.accessKeyId) {
    log('logs.upload.skipped', { note: `cannot store run logs: ${!credentials ? 'no task role credentials' : 'no presign keys'}` });
    return out;
  }
  const prefix = runLogsPrefix(task.task_id, runId);
  async function put(name, body, contentType) {
    try {
      return await uploadEvidence({ bucket: cfg.qaBucket, region: cfg.qaRegion, key: `${prefix}${name}`, body, contentType, credentials, presign });
    } catch (e) {
      log('logs.upload.failed', { file: name, error: String(e.message || e).slice(0, 200) });
      return null;
    }
  }

  const [promptUrl, transcriptUrl, streamUrl, stderrUrl] = await Promise.all([
    fs.existsSync(promptPath) ? put('prompt.md', fs.readFileSync(promptPath), 'text/markdown') : Promise.resolve(null),
    put('transcript.md', Buffer.from(transcriptMarkdown || '', 'utf8'), 'text/markdown'),
    fs.existsSync(streamPath) ? put('claude.stream.jsonl.gz', zlib.gzipSync(fs.readFileSync(streamPath)), 'application/gzip') : Promise.resolve(null),
    stderrText ? put('stderr.log', Buffer.from(stderrText, 'utf8'), 'text/plain') : Promise.resolve(null),
  ]);
  if (streamUrl) {
    out.logLinks.stream = streamUrl;
  }
  if (stderrUrl) {
    out.logLinks.stderr = stderrUrl;
  }
  for (const [name, text] of Object.entries(checkOutputs || {})) {
    const url = await put(`check-${slugify(name, 40)}.log`, Buffer.from(text || '', 'utf8'), 'text/plain');
    if (url) {
      out.logLinks.checks[name] = url;
    }
  }

  if (vocion.enabled && state.record?.id) {
    const post = (p, body) => vocion.post(p, body);
    if (promptUrl) {
      const title = `Prompt, run ${runId}`.slice(0, 100);
      const r = await publishArtifact(post, { recordType: 'object', recordId: String(state.record.id), recordRole: 'prompt', kind: 'link', title, spec: { href: promptUrl, url: promptUrl, title, description: 'The task markdown Claude was given', caption: 'The task markdown Claude was given', filename: 'prompt.md', contentType: 'text/markdown' } });
      if (r.ok && r.id) {
        out.promptArtifactId = r.id;
      } else {
        log('logs.artifact.failed', { file: 'prompt.md', error: r.error });
      }
    }
    if (transcriptUrl) {
      const title = `Transcript, run ${runId}`.slice(0, 100);
      const r = await publishArtifact(post, { recordType: 'object', recordId: String(state.record.id), recordRole: 'transcript', kind: 'link', title, spec: { href: transcriptUrl, url: transcriptUrl, title, description: 'Claude\'s tool calls and result for this run', caption: 'Claude\'s tool calls and result for this run', filename: 'transcript.md', contentType: 'text/markdown' } });
      if (r.ok && r.id) {
        out.transcriptArtifactId = r.id;
      } else {
        log('logs.artifact.failed', { file: 'transcript.md', error: r.error });
      }
    }
  }
  return out;
}

/**
 * Runs publishRunLogs from whatever runClaude returned, wherever the worker is about to report an
 * outcome (main() calls this exactly once per run, right before the branch that calls complete or
 * fail; never called at all when Claude did not run, such as a contract refusal or a services
 * failure, since there is nothing to publish). Sets state.runLogs, which complete()/fail() read.
 */
async function finalizeRunLogs(task, runId, claude, checkOutputs) {
  if (!claude) {
    return state.runLogs;
  }
  try {
    state.runLogs = await publishRunLogs({
      task,
      runId,
      streamPath: claude.streamPath,
      promptPath: path.join(LOG_DIR, 'prompt.md'),
      transcriptMarkdown: renderTranscriptMarkdown(claude.messages || [], { taskId: task.task_id, runId }),
      stderrText: claude.stderrFull || '',
      checkOutputs: checkOutputs || {},
    });
  } catch (e) {
    log('logs.publish.crashed', { error: String(e.message || e).slice(0, 300) });
  }
  return state.runLogs;
}

// ---------- the task record ----------

// The task record is what a person reads; the run is the lease. When the run was queued for a record
// (input.record = { type, id }, the dispatch's job), the runner writes its state onto that record at
// claim, at completion and at failure over POST /objects with the task's external key, so the work
// page shows running, awaiting_review or rejected with the PR, the checks, the kept branch and the
// cost. The record's type is the one the run names. Best effort: a refused write is one log line,
// never a failed run. The object route needs the approve capability; a token without it logs 403.
async function reportToRecord(step, body) {
  if (!vocion.enabled || !state.record?.type) {
    return;
  }
  try {
    const r = await vocion.post('/objects', body);
    if (r.ok) {
      log('record.updated', { step, id: r.json?.object?.id ?? state.record.id, status: body.status });
    } else {
      log('record.rejected', { step, status: r.status, error: r.json?.error || r.json?.raw, note: r.status === 403 ? 'the token lacks the approve capability (role owner or pm)' : undefined });
    }
  } catch (e) {
    log('record.error', { step, error: String(e.message || e) });
  }
}

// ---------- terminal reports ----------

async function complete(runId, result, summary) {
  setPhase('complete');
  stopHeartbeat();
  // The transcript, the prompt and the rest of this run's logs (publishRunLogs, called once the
  // outcome is known) land here as pointers only, never bytes: see backlog 036.
  if (state.runLogs?.transcriptArtifactId) {
    result.transcriptArtifactId = state.runLogs.transcriptArtifactId;
  }
  if (state.runLogs?.promptArtifactId) {
    result.promptArtifactId = state.runLogs.promptArtifactId;
  }
  if (state.runLogs?.logLinks) {
    result.logLinks = state.runLogs.logLinks;
  }
  if (!vocion.enabled) {
    log('complete.local', { result }); return;
  }
  await heartbeat(); // flush pending usage and up to one batch of events before the terminal call
  const events = await drainEventsBeforeTerminal();
  const body = { workerId, result, counts: { ...state.counts, prsOpened: result.pr_url ? 1 : 0, filesChanged: result.files_changed?.length || 0, costPerAcceptedTaskCents: Math.round(state.costUsd * 100) }, summary };
  if (events.length) {
    body.events = events;
  }
  const r = await vocion.postFinal(`/worker-runs/${runId}/complete`, body);
  if (r.ok && events.length) {
    eventLog.ack(events, r.json?.eventsAccepted);
  }
  log('completed', { status: r.status, run_status: r.json?.run?.status, cents: r.json?.run?.cents, attempt: r.json?.run?.attempt });
  if (state.task) {
    await reportToRecord('completed', taskCompleted(state.task, result, { type: state.record?.type, runId, summary, costUsd: state.costUsd }));
  }
}
// The run ends `failed`, never `completed`, even when work was kept. Vocion's /fail stores error and
// failures only, so the kept branch and PR travel four ways: in the final heartbeat's progress
// (keptBranch, prUrl, the Factory log reads meta.progress), as a `kept-work` failure entry, at the
// end of the error text, and as `result` in the body for the day /fail records it.
async function fail(runId, error, failures = [], partial = {}) {
  const kept = state.kept;
  const keptResult = kept ? { status: 'failed', keptBranch: kept.branch, prUrl: kept.prUrl, kept_branch: kept.branch, pr_url: kept.prUrl, commit_sha: kept.commitSha, files_changed: kept.files, reason: kept.reason, continue: kept.continue, nextAttempt: kept.nextAttempt, cost_usd: round2(state.costUsd), task_id: partial.task_id } : null;
  const fullError = kept && kept.prUrl ? `${error}. Work kept on ${kept.branch}: ${kept.prUrl}` : error;
  if (kept) {
    failures = [...failures, { scope: 'kept-work', message: kept.prUrl ? `${kept.branch} ${kept.prUrl}. ${kept.continue}` : `could not keep ${kept.branch}: ${kept.error}` }];
  }
  setPhase('fail', fullError);
  if (kept) {
    state.note = fullError;
  }
  stopHeartbeat();
  if (!vocion.enabled || !runId) {
    log('fail.local', { error: fullError, failures, partial, result: keptResult }); log('failed', { run_status: 'failed', pr_url: kept?.prUrl, kept_branch: kept?.branch }); return;
  }
  if (state.lostLease) {
    log('fail.skipped', { note: 'lease lost; Vocion will not accept the report', pr_url: kept?.prUrl, kept_branch: kept?.branch }); return;
  }
  try {
    // One last heartbeat: flushes pending usage, up to one batch of events, and records
    // keptBranch/prUrl in progress.
    if (kept) {
      const batch = (!eventLog.isDisabled() && eventLog.hasPending()) ? eventLog.nextBatch() : [];
      const hbBody = { workerId, progress: { phase: 'fail', note: fullError.slice(0, 500), elapsed_s: Math.round((Date.now() - startedAt) / 1000), model: state.model || undefined, keptBranch: kept.branch, prUrl: kept.prUrl, continue: kept.continue }, counts: Object.keys(state.counts).length ? state.counts : undefined, usage: state.pendingUsage || undefined };
      if (batch.length) {
        hbBody.events = batch;
      }
      const r = await vocion.post(`/worker-runs/${runId}/heartbeat`, hbBody);
      if (r.ok) {
        state.pendingUsage = null; if (batch.length) {
          eventLog.ack(batch, r.json?.eventsAccepted);
        }
      } else if (batch.length && looksLikeEventsRejection(r.status, r.json)) {
        eventLog.disable(); log('events.disabled', { status: r.status, error: r.json?.error });
      }
    } else {
      await heartbeat();
    }
  } catch {}
  const events = await drainEventsBeforeTerminal();
  const body = {
    workerId,
    error: String(fullError).slice(0, 2000),
    failures: failures.map(f => ({ scope: f.scope || 'worker', message: String(f.message || f).slice(0, 1000) })),
    // A typed failure (partial.failure: { kind, ... }) rides `result.failure`, which Vocion stores,
    // so the factory's recovery reads the kind instead of matching the error's words.
    result: keptResult || partial.failure ? { ...(keptResult || {}), ...(partial.failure ? { failure: partial.failure } : {}) } : undefined,
  };
  if (events.length) {
    body.events = events;
  }
  // The same pointers complete() carries, so a failed run's page still opens what Claude did.
  if (state.runLogs?.transcriptArtifactId) {
    body.transcriptArtifactId = state.runLogs.transcriptArtifactId;
  }
  if (state.runLogs?.promptArtifactId) {
    body.promptArtifactId = state.runLogs.promptArtifactId;
  }
  if (state.runLogs?.logLinks) {
    body.logLinks = state.runLogs.logLinks;
  }
  const r = await vocion.postFinal(`/worker-runs/${runId}/fail`, body);
  if (r.ok && events.length) {
    eventLog.ack(events, r.json?.eventsAccepted);
  }
  log('failed', { status: r.status, run_status: r.json?.run?.status, pr_url: kept?.prUrl, kept_branch: kept?.branch, cost_usd: round2(state.costUsd) });
  // The record gets the failure even when the contract was refused (state.task is then the raw
  // input, which still names task_id and objective).
  const task = state.task || partial.task || null;
  if (task?.task_id) {
    await reportToRecord('failed', taskFailed(task, { type: state.record?.type, runId, error: fullError, failures, kept, checks: partial.checks || [], costUsd: state.costUsd, attempt: partial.attempt }));
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------- main ----------

async function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  log('boot', { mode: cfg.localTask || cfg.localTaskJson ? 'local' : (cfg.runId ? 'run' : 'poll'), vocion: vocion.enabled ? cfg.vocionUrl : null, agentSlug: cfg.agentSlug, max_budget_usd: cfg.maxBudgetUsd, wall_clock_minutes: cfg.wallClockMinutes, node: process.version, arch: process.arch, worker_version: WORKER_VERSION });
  for (const k of ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN']) {
    if (!env[k]) {
      log('warn', { note: `${k} is not set` });
    }
  }

  let run = null;
  let task;
  let runId;

  if (cfg.localTask || cfg.localTaskJson) {
    const raw = cfg.localTaskJson ? cfg.localTaskJson : (cfg.localTask === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(cfg.localTask, 'utf8'));
    runId = `local-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    state.runId = runId;
    task = { raw: JSON.parse(raw), synthesized: false };
    vocion.enabled = false;
  } else {
    if (!vocion.enabled) {
      log('exit', { note: 'VOCION_URL or VOCION_TOKEN missing and no LOCAL_TASK; nothing to do' }); return;
    }
    runId = cfg.runId || await pollForRun();
    if (!runId) {
      log('exit', { note: `no queued run${cfg.agentSlug ? ` for ${cfg.agentSlug}` : ''} within ${cfg.pollMaxSeconds}s` }); return;
    }
    state.runId = runId;
    run = await claimRun(runId);
    if (!run) {
      return;
    }
    startHeartbeat();
    const rec = run.input?.record;
    if (rec && typeof rec === 'object' && rec.id != null && rec.type) {
      state.record = { type: String(rec.type), id: rec.id }; log('record', state.record);
    }
    try {
      task = taskFromRun(run);
    } catch (e) {
      await fail(runId, `bad task input: ${e.message}`); return;
    }
    if (task.raw && typeof task.raw === 'object') {
      state.task = task.raw; await reportToRecord('claimed', taskClaimed(task.raw, { type: state.record?.type, runId, attempt: effectiveAttempt(run.attempt, task.raw.attempt), workerId }));
    }
    // The run's own limits tighten ours.
    if (run.capCents != null) {
      cfg.maxBudgetUsd = Math.min(cfg.maxBudgetUsd, Math.max(0.5, (run.capCents - (run.cents || 0)) / 100));
    }
    if (run.endsAt) {
      cfg.wallClockMinutes = Math.min(cfg.wallClockMinutes, Math.max(6, (new Date(run.endsAt).getTime() - Date.now()) / 60000));
    }
  }

  // Prepare starts with the contract. A malformed contract fails the run here, before the clone, with
  // every problem in the note; nothing is defaulted into a docs task.
  setPhase('prepare', 'validate the task contract');
  let applied;
  try {
    ({ task, applied } = validateTask(task.raw));
    state.task = task;
  } catch (e) {
    if (!(e instanceof ContractError)) {
      throw e;
    }
    log('contract.refused', { problems: e.errors, keys: Object.keys(task.raw || {}) });
    await fail(runId, `${e.message}. The contract must match the runner's contract schema (packages/runner/contract/schema.json: snake_case keys, non-empty acceptance_contract and allowed_paths, risk_class from the list, each required check a built-in (${BUILTIN_CHECKS.join('/')}) or one with a command in checks) and carry an approved plan when the plan rule requires one (packages/runner/src/plan.mjs). Nothing was cloned and no model was called.`, e.errors.map(m => ({ scope: 'contract', message: m })), { task: task.raw });
    return;
  }
  const baseKind = classifyBase(task.base_sha);
  log('plan', planLogLine(task));
  log('task', { task_id: task.task_id, product: task.product, repo: task.repo, base_sha: task.base_sha, resumedFrom: baseKind.resume ? baseKind.ref : undefined, risk_class: task.risk_class, allowed_paths: task.allowed_paths, required_checks: task.required_checks, services: task.environment?.services || [], model_policy: task.model_policy, token_budget_usd: task.token_budget_usd, wall_clock_minutes: task.wall_clock_minutes, attempt: effectiveAttempt(run?.attempt, task.attempt), defaults_applied: applied, objective: task.objective.slice(0, 200) });

  let prepared;
  try {
    prepared = prepareRepo(task, run);
  } catch (e) {
    await fail(runId, `prepare failed: ${e.message}`, [{ scope: 'git', message: e.message }], { task_id: task.task_id });
    return;
  }
  if (prepared.resumedFrom) {
    log('task.resumed', { task_id: task.task_id, resumedFrom: prepared.resumedFrom, attempt: prepared.attempt, branch: prepared.branch });
  }

  // Every allowed path against the tree just cloned, before services or a model call (run 411: a
  // plan named an app by the name it had before a rename, and Claude spent the run finding that
  // out). A path whose app, package or top directory is not there is told to the engineer.
  const pathsCheck = checkAllowedPaths(task.allowed_paths, {
    isDir: (rel) => {
      try {
        return fs.statSync(path.join(REPO_DIR, rel)).isDirectory();
      } catch {
        return false;
      }
    },
    listDir: (rel) => {
      try {
        return fs.readdirSync(path.join(REPO_DIR, rel));
      } catch {
        return [];
      }
    },
  });
  // The paths are scope, not a fence, so a stale one is a note for the engineer, not a refusal.
  if (!pathsCheck.ok) {
    const { failure } = pathsMissingFailure(pathsCheck);
    log('preflight.paths_missing', { missing: pathsCheck.missing, suggest: pathsCheck.suggest, roots: pathsCheck.roots });
    task.notes = [task.notes, `Stale plan paths: ${failure.reason}. Work against the tree as it is.`].filter(Boolean).join('\n\n');
  }

  try {
    await startServices(task);
  } catch (e) {
    await fail(runId, `services failed: ${e.message}`, [{ scope: 'services', message: e.message }], { task_id: task.task_id });
    return;
  }

  const claude = await runClaude(task, runId);
  const partial = { task_id: task.task_id, attempt: prepared.attempt };
  if (state.lostLease) {
    log('exit', { note: 'lease lost; leaving the working tree behind' }); return;
  }

  // Every stop short of a verified landing keeps whatever is inside allowed_paths, then fails.
  const stoppedEarly = classifyStop({ stopped: state.stopped, stopReason: state.stopReason, killReason: state.killReason, result: claude.result });
  if (stoppedEarly && (state.stopped || !claude.result || claude.result.is_error)) {
    let checks = null;
    // Checks still run on what is there, so the draft PR says how far the work got.
    if (claude.result && !state.stopped) {
      try {
        checks = verify(task);
      } catch (e) {
        log('verify.crashed', { error: e.message });
      }
    }
    await finalizeRunLogs(task, runId, claude, checks?.outputs);
    keepWork(task, runId, prepared, claude, checks, stoppedEarly);
    if (checks) {
      partial.checks = checks.checks;
    }
    if (state.stopped) {
      await fail(runId, `stopped by Vocion before the task finished (${state.stopReason})`, [{ scope: 'control', message: `stop signal on heartbeat (${state.stopReason})` }], partial); return;
    }
    if (!claude.result) {
      await fail(runId, `claude exited ${claude.code}${claude.signal ? ` (${claude.signal})` : ''} without a JSON result${state.killReason ? ` (${state.killReason})` : ''}`, [{ scope: 'claude', message: claude.stderrTail || claude.rawTail || 'no output' }], partial); return;
    }
    await fail(runId, `claude reported an error (${claude.result.subtype || 'error'})${state.kept ? '' : ' and left no changes'}`, [{ scope: 'claude', message: String(claude.result.result || '').slice(0, 1000) }], partial);
    return;
  }

  let verification;
  try {
    verification = verify(task);
  } catch (e) {
    await finalizeRunLogs(task, runId, claude, {}); await fail(runId, `verify crashed: ${e.message}`, [], partial); return;
  }
  state.counts.filesChanged = verification.files.length;
  if (!verification.ok) {
    log('verify.failed', { error: verification.error, files: verification.files, checks: verification.checks.map(c => `${c.name}=${c.status}`) });
    await finalizeRunLogs(task, runId, claude, verification.outputs);
    if (!verification.noChanges) {
      keepWork(task, runId, prepared, claude, verification, 'checks-failed');
    }
    // Claude changed nothing: its own report is the reason, carried whole for the next attempt.
    if (verification.noChanges) {
      await fail(runId, `verification failed: ${verification.error}`, [{ scope: 'claude', message: String(claude.result?.result || '').slice(0, 1500) }], { ...partial, checks: verification.checks });
      return;
    }
    await fail(runId, `verification failed: ${verification.error}`, verification.checks.filter(c => c.status === 'failed').map(c => ({ scope: `check:${c.name}`, message: c.tail })), { ...partial, checks: verification.checks });
    return;
  }
  log('verified', { files: verification.files, checks: verification.checks.map(c => `${c.name}=${c.status}`) });

  // QA evidence, between the checks and the landing. It cannot fail the run: whatever breaks is
  // named in the qa-report artifact and in qaCaptured on the task record, and the branch still
  // lands. A silent skip is the thing this replaces.
  let qa = normalizeQa(task.qa);
  let refusedFlows = [];
  if (qa && fs.existsSync(QA_FLOWS_FILE)) {
    const merged = mergeEngineerFlows(qa, fs.readFileSync(QA_FLOWS_FILE, 'utf8'));
    qa = merged.qa;
    refusedFlows = merged.refused;
    log('qa.engineer_flows', { added: merged.added, refused: merged.refused.slice(0, 8) });
  }
  // The flows as written, before the capture resolves a placeholder to a mock record: the live
  // check after the release (a team's live QA) replays them on production, where a
  // mock id means nothing and the placeholder is resolved against the live app instead.
  const qaFlows = qa ? recordableFlows(qa) : [];
  let evidence = null;
  if (qa && cfg.qaEnabled) {
    setPhase('qa', `${qa.flows.length} flow(s) on ${qa.surface}, before from ${productionBase(qa)}`);
    try {
      evidence = await captureEvidence({
        qa,
        taskId: task.task_id,
        runId,
        recordId: state.record?.id || null,
        repoDir: REPO_DIR,
        outDir: path.join(SCRATCH_DIR, 'qa'),
        aws: { bucket: cfg.qaBucket, region: cfg.qaRegion, presign: { accessKeyId: cfg.qaPresignKeyId, secretAccessKey: cfg.qaPresignSecret } },
        run: sh,
        log,
        post: vocion.enabled ? (p, body) => vocion.post(p, body) : null,
        // A shot stored in Vocion is evidence a person can open: its artifact page, not a
        // vocion:artifact:<id> reference the reviewer rightly refused to count (2026-09-26).
        artifactUrl: vocion.enabled ? id => `${cfg.vocionUrl}/dashboard/artifacts/${id}` : null,
        refusedFlows,
      });
      evidence.refusedFlows = refusedFlows;
      log('qa.captured', { captured: evidence.captured, shots: evidence.shots, rows: evidence.rows.length, failures: evidence.failures.map(f => `${f.scope}: ${f.message}`).slice(0, 6), elapsed_s: evidence.elapsedS, mb: round2(evidence.bytes / 1024 / 1024), video_s: evidence.videoSeconds, report_published: evidence.reportPublished });
    } catch (e) {
      log('qa.crashed', { error: String(e.message || e).slice(0, 400) });
      evidence = { captured: false, shots: 0, rows: [], evidence: [], failures: [{ scope: 'qa', message: String(e.message || e).slice(0, 400) }], markdown: '', summary: `the capture pass crashed: ${String(e.message || e).slice(0, 200)}`, elapsedS: 0, bytes: 0, videoSeconds: 0, reportPublished: false, refusedFlows };
    }
  } else if (qa) {
    log('qa.skipped', { note: 'QA_CAPTURE=0' });
  }

  let tests = { proofs: [], runLink: null, notRun: [], allSkipped: [] };
  try {
    tests = await provenByTests(state.record?.id || null, runId);
  } catch (e) {
    log('criteria.tests.crashed', { error: String(e.message || e).slice(0, 300) });
  }
  let landed;
  try {
    landed = land(task, runId, verification, claude, prepared, evidence, tests);
  } catch (e) {
    keepWork(task, runId, prepared, claude, verification, 'checks-failed');
    await finalizeRunLogs(task, runId, claude, verification.outputs);
    await fail(runId, `land failed: ${e.message}`, [{ scope: 'git', message: e.message }], { ...partial, checks: verification.checks });
    return;
  }
  state.counts.prsOpened = 1;
  await finalizeRunLogs(task, runId, claude, verification.outputs);

  const result = {
    status: 'completed',
    branch: prepared.branch,
    base_sha: prepared.baseSha,
    commit_sha: landed.commitSha,
    pr_url: landed.prUrl,
    files_changed: verification.files,
    checks: verification.checks,
    tests_attempted: verification.checks.filter(c => c.status !== 'skipped').length,
    tests_passed: verification.checks.filter(c => c.status === 'passed').length,
    verification_artifacts: verification.checks.map(c => ({ check: c.name, exit_code: c.exit_code, tail: c.tail })),
    // Said plainly on the result, not only in the artifact: a criterion with no named test that
    // ran, and a shot that is not evidence for its criterion.
    known_failures: [
      ...(tests.allSkipped || []).map(c => `named tests not run for "${c.criterion.slice(0, 160)}": every one was skipped (${c.reasons.join('; ').slice(0, 200)})`),
      ...(evidence?.rows || []).filter(r => r.not_evidence && r.side === 'after').map(r => `QA shot for "${r.flow}" (${r.viewport}) is not evidence: ${String(r.not_evidence).slice(0, 200)}`),
      ...refusedFlows.map(m => `QA flow refused: ${m.slice(0, 240)}`),
    ],
    assumptions: [],
    token_usage: { model: claude.model, cost_usd: round2(claude.costUsd), ...claude.usage, by_model: Object.fromEntries(Object.entries(claude.modelUsage).map(([m, u]) => [m, round2(u.costUSD)])) },
    elapsed_s: Math.round((Date.now() - startedAt) / 1000),
    task_id: task.task_id,
    risk_class: task.risk_class,
    attempt: prepared.attempt,
    resumedFrom: prepared.resumedFrom || undefined,
    services_started: state.services,
    qa_captured: evidence ? evidence.captured : null,
    qa_evidence: evidence ? evidence.evidence : [],
    qa_flows: qaFlows,
    qa_report: evidence ? evidence.markdown : '',
    qa_summary: evidence ? evidence.summary : (qa ? 'the capture pass did not run' : ''),
    worker: workerId,
    agent_report: String(claude.result.result || '').slice(0, 2000),
  };
  const summary = `Task ${task.task_id} (${task.risk_class}): changed ${verification.files.length} file(s)${verification.beyondPlan?.length ? ` (${verification.beyondPlan.length} beyond the plan)` : ''}, ${verification.checks.filter(c => c.status === 'passed').length}/${verification.checks.length} checks passed, opened ${landed.prUrl} from ${prepared.branch}. Model ${claude.model}, $${round2(claude.costUsd)}, ${claude.durationS}s in claude, ${result.elapsed_s}s total.${evidence ? ` QA evidence: ${evidence.summary}.` : ''}`;
  await complete(runId, result, summary);
  log('done', { pr_url: landed.prUrl, cost_usd: round2(state.costUsd), elapsed_s: result.elapsed_s });
}

main()
  .catch(async (e) => {
    log('crash', { error: String(e?.stack || e) });
    try {
      await fail(state.runId, `worker crashed: ${e?.message || e}`);
    } catch {}
  })
  .finally(() => {
    stopHeartbeat(); process.exitCode = 0;
  });
