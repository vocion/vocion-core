// One eval: every selected case, `runs` times, on one engine. Each run is up to `maxAttempts`
// attempts; an attempt the QA proxy (the hidden tests) does not pass in full is sent back with the
// lines it missed, continuing from its kept branch, the way the factory's QA send-back does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contractFor, contractProblems, sendBackNotes } from './cases.mjs';
import { engine as engineFor } from './engines.mjs';
import { git, materializeFixture, publishFixture, tokenAuth, V2_BRANCH } from './fixture.mjs';
import { gradeCommit } from './grade.mjs';
import { scoreRun, summarize } from './score.mjs';

const LOCAL_REPO = 'https://fixture.invalid/northwind-library.git';

function fetchFromRemote(fixture, remote, ref, env) {
  git(fixture.dir, [...tokenAuth(env), 'fetch', '-q', remote, ref], { timeoutSeconds: 300, env: { GIT_TERMINAL_PROMPT: '0', GITHUB_TOKEN: env.GITHUB_TOKEN || '' } });
  return git(fixture.dir, ['rev-parse', 'FETCH_HEAD']);
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
    const result = await engine.attempt({ c, contract, fixture, baseSha: resumeFrom || baseSha, branch, image: options.runnerImage, env: options.env, timeoutMinutes: contract.wall_clock_minutes });
    const { log, ...kept } = result;
    const attempt = { attempt: n, ...kept, contract };
    if (log && options.logDir) {
      const file = path.join(options.logDir, `${c.id}-r${run}-a${n}.log`);
      fs.writeFileSync(file, log);
      attempt.logFile = file;
    }
    let sha = result.sha;
    if (sha && engine.needsRemote) {
      try {
        sha = fetchFromRemote(fixture, options.fixtureRepo, result.branch || sha, options.env || process.env);
      } catch (e) {
        attempt.status = 'infra';
        attempt.error = `could not fetch ${result.branch || sha}: ${String(e.message).slice(0, 300)}`;
        sha = null;
      }
    }
    if (sha) {
      attempt.grade = gradeCommit({ repo: fixture.dir, sha, baseSha, c });
    }
    attempts.push(attempt);
    const accepted = attempt.status === 'pr' && attempt.grade && attempt.grade.passed === attempt.grade.total;
    if (accepted || attempt.status === 'infra' || !(result.branch || sha)) {
      break;
    }
    resumeFrom = result.branch || sha;
    notes = attempt.grade ? sendBackNotes(c, attempt.grade.lines) : `The previous attempt stopped: ${attempt.error || 'no reason given'}. Continue from the kept branch.`;
  }
  return { case: c.id, split: c.split, complexity: c.complexity, risk_class: c.risk_class, run, attempts, score: scoreRun(attempts) };
}

/** The whole eval. Writes nothing; the caller writes the report. */
export async function runEval({ cases, engineId, runs = 1, maxAttempts = 3, fixtureRepo = '', runnerImage = '', modelPolicy = {}, logDir = '', env = process.env, onRun = () => {} }) {
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
  const results = [];
  const startedAt = new Date().toISOString();
  try {
    for (const c of cases) {
      for (let run = 1; run <= runs; run++) {
        const r = await runCase({ c, run, engine, fixture, options: { maxAttempts, fixtureRepo, runnerImage, modelPolicy, logDir, env } });
        results.push(r);
        onRun(r);
      }
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const bySplit = Object.fromEntries(['tuning', 'held-out'].map(s => [s, summarize(results.filter(r => r.split === s))]));
  const byComplexity = Object.fromEntries([1, 2, 3, 4].map(cx => [cx, summarize(results.filter(r => r.complexity === cx))]));
  return {
    engine: engineId,
    ran: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    fixture: { v1: fixture.refs.v1, v2: fixture.refs.v2, v2Branch: V2_BRANCH },
    options: { runs, maxAttempts, modelPolicy, fixtureRepo: fixtureRepo || null, runnerImage: runnerImage || null },
    summary: { all: summarize(results), bySplit, byComplexity },
    results,
  };
}
