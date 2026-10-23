// One eval: every selected case, `runs` times, on one engine. Each run is up to `maxAttempts`
// attempts; an attempt the QA proxy (the hidden tests) does not pass in full is sent back with the
// lines it missed, continuing from its kept branch, the way the factory's QA send-back does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contractFor, contractProblems, sendBackNotes } from './cases.mjs';
import { engine as engineFor } from './engines.mjs';
import { DATAROOM_BRANCH, git, materializeFixture, publishFixture, tokenAuth, V2_BRANCH } from './fixture.mjs';
import { gradeCommit } from './grade.mjs';
import { scoreRun, summarize } from './score.mjs';

const LOCAL_REPO = 'https://fixture.invalid/northwind-library.git';

// Fetching and grading touch the one local fixture repository; runs in parallel take turns.
let gitTurn = Promise.resolve();
function exclusive(fn) {
  const next = gitTurn.then(fn, fn);
  gitTurn = next.then(() => {}, () => {});
  return next;
}

function fetchFromRemote(fixture, remote, ref, local, env) {
  git(fixture.dir, [...tokenAuth(env), 'fetch', '-q', remote, `+${ref}:${local}`], { timeoutSeconds: 300, env: { GIT_TERMINAL_PROMPT: '0', GITHUB_TOKEN: env.GITHUB_TOKEN || '' } });
  return git(fixture.dir, ['rev-parse', local]);
}

/** One run of one case. Returns its attempts (each with its contract and grade) and its score. */
export async function runCase({ c, run, engine, fixture, options }) {
  const attempts = [];
  const baseSha = fixture.refs[c.fixture_ref];
  let resumeFrom = null;
  let notes = '';
  for (let n = 1; n <= options.maxAttempts; n++) {
    const contract = contractFor(c, { repo: options.fixtureRepo || LOCAL_REPO, baseSha: resumeFrom || baseSha, attempt: n, run, notes, modelPolicy: options.modelPolicy });
    const problems = contractProblems(contract);
    if (problems.length) {
      attempts.push({ attempt: n, status: 'infra', error: `contract refused: ${problems.join('; ')}`, contract, elapsedS: 0, costUsd: 0 });
      break;
    }
    const branch = `eval/${c.id}/r${run}`;
    const attemptStartedAt = new Date().toISOString();
    const result = await engine.attempt({ c, contract, fixture, baseSha: resumeFrom || baseSha, branch, image: options.runnerImage, env: options.env, timeoutMinutes: contract.wall_clock_minutes });
    const { log, ...kept } = result;
    const attempt = { attempt: n, startedAt: attemptStartedAt, ...kept, contract };
    if (log && options.logDir) {
      const file = path.join(options.logDir, `${c.id}-r${run}-a${n}.log`);
      fs.writeFileSync(file, log);
      attempt.logFile = file;
    }
    await exclusive(() => {
      let sha = result.sha;
      if (sha && engine.needsRemote) {
        try {
          sha = fetchFromRemote(fixture, options.fixtureRepo, result.branch || sha, `refs/eval/${c.id}/r${run}/a${n}`, options.env || process.env);
        } catch (e) {
          attempt.status = 'infra';
          attempt.error = `could not fetch ${result.branch || sha}: ${String(e.message).slice(0, 300)}`;
          sha = null;
        }
      }
      if (sha) {
        attempt.grade = gradeCommit({ repo: fixture.dir, sha, baseSha, c, report: result.agentReport || '' });
      }
    });
    attempts.push(attempt);
    const accepted = attempt.status === 'pr' && attempt.grade && attempt.grade.passed === attempt.grade.total;
    if (accepted || attempt.status === 'infra' || !(result.branch || result.sha) || options.shouldStop?.()) {
      break;
    }
    resumeFrom = result.branch || result.sha;
    notes = attempt.grade ? sendBackNotes(c, attempt.grade.lines) : `The previous attempt stopped: ${attempt.error || 'no reason given'}. Continue from the kept branch.`;
  }
  return { case: c.id, tier: c.tier || 'core', split: c.split, complexity: c.complexity, risk_class: c.risk_class, run, attempts, score: scoreRun(attempts) };
}

/**
 * The whole eval. Writes nothing but `progressFile` (one JSON line per finished run, so an eval cut
 * short resumes with `done`, the runs already in it); the caller writes the report. Stops starting
 * new work, and stops the engine's running attempts, once `maxSpendUsd` is spent or
 * `maxInfraStreak` runs in a row fail for infrastructure.
 */
export async function runEval({ cases, engineId, runs = 1, maxAttempts = 3, fixtureRepo = '', runnerImage = '', modelPolicy = {}, logDir = '', env = process.env, onRun = () => {}, concurrency = 1, maxSpendUsd = Infinity, maxInfraStreak = Infinity, progressFile = '', done = [] }) {
  const engine = engineFor(engineId);
  const pre = engine.preflight({ image: runnerImage || undefined, fixtureRepo: fixtureRepo || undefined, env });
  if (!pre.ok) {
    return { engine: engineId, ran: false, missing: pre.missing };
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-eval-'));
  const fixture = materializeFixture(path.join(work, 'fixture'));
  if (engine.needsRemote) {
    publishFixture(fixture, fixtureRepo, env);
  }
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const results = [...done];
  const finished = new Set(done.map(r => `${r.case}#${r.run}`));
  const queue = cases.flatMap(c => Array.from({ length: runs }, (_, i) => ({ c, run: i + 1 }))).filter(j => !finished.has(`${j.c.id}#${j.run}`));
  const startedAt = new Date().toISOString();
  let spent = results.reduce((s, r) => s + (r.score.costUsd || 0), 0);
  let infraStreak = 0;
  let stopped = null;
  const shouldStop = () => Boolean(stopped);
  const options = { maxAttempts, fixtureRepo, runnerImage, modelPolicy, logDir, env, shouldStop };
  const worker = async () => {
    while (queue.length && !stopped) {
      const { c, run } = queue.shift();
      const r = await runCase({ c, run, engine, fixture, options });
      if (stopped && !r.attempts.some(a => a.grade)) {
        continue; // cut off by the stop, not a result
      }
      results.push(r);
      if (progressFile) {
        fs.appendFileSync(progressFile, `${JSON.stringify(r)}\n`);
      }
      spent += r.score.costUsd || 0;
      infraStreak = r.score.infra && !r.attempts.some(a => a.grade) ? infraStreak + 1 : 0;
      onRun(r, { spentUsd: Math.round(spent * 100) / 100 });
      if (!stopped && spent >= maxSpendUsd) {
        stopped = `spend reached $${Math.round(spent * 100) / 100} (cap $${maxSpendUsd})`;
      }
      if (!stopped && infraStreak >= maxInfraStreak) {
        stopped = `${infraStreak} runs in a row failed for infrastructure`;
      }
      if (stopped) {
        engine.stop?.();
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return reportFor({ engineId, results, cases, stopped, startedAt, fixture: fixture.refs, options: { runs, maxAttempts, modelPolicy, concurrency, fixtureRepo: fixtureRepo || null, runnerImage: runnerImage || null } });
}

/** The report over a set of finished runs: from a live eval, or rebuilt from its progress file. */
export function reportFor({ engineId, results, cases, stopped = null, startedAt, finishedAt = new Date().toISOString(), fixture, options }) {
  const order = new Map(cases.map((c, i) => [c.id, i]));
  results.sort((a, b) => (order.get(a.case) ?? 0) - (order.get(b.case) ?? 0) || a.run - b.run);
  const bySplit = Object.fromEntries(['tuning', 'held-out'].map(s => [s, summarize(results.filter(r => r.split === s))]));
  const tiers = [...new Set(results.map(r => r.tier || 'core'))];
  const byTier = Object.fromEntries(tiers.map(t => [t, {
    all: summarize(results.filter(r => (r.tier || 'core') === t)),
    bySplit: Object.fromEntries(['tuning', 'held-out'].map(s => [s, summarize(results.filter(r => (r.tier || 'core') === t && r.split === s))])),
  }]));
  const byComplexity = Object.fromEntries([1, 2, 3, 4, 5].map(cx => [cx, summarize(results.filter(r => r.complexity === cx))]));
  return {
    engine: engineId,
    ran: true,
    stopped,
    startedAt,
    finishedAt,
    fixture: { v1: fixture.v1, v2: fixture.v2, v2Branch: V2_BRANCH, ...(fixture.dataroom ? { dataroom: fixture.dataroom, dataroomBranch: DATAROOM_BRANCH } : {}) },
    options,
    summary: { all: summarize(results), bySplit, byComplexity, byTier },
    results,
  };
}
