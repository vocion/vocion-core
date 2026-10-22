// Engines the eval can drive, behind one shape (the engine plan's seam, at eval scale):
//
//   preflight(options)  -> { ok, missing: [{ need, why }] }   what this machine lacks to run it
//   attempt(ctx)        -> { status: 'pr' | 'failed' | 'infra', sha, branch, prUrl, elapsedS,
//                            costUsd, usage, checks, error, log }
//
// claude-cli is today's engine: the runner image, which runs headless Claude Code under the guard
// hooks, given the contract exactly as dispatch sends it. oracle applies the case's reference
// change and noop changes nothing; both prove the harness and the graders without a model.
// openhands, codex and claude-sdk are named so a run asking for one says it is not built yet.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from './fixture.mjs';

const PLANNED = { 'openhands': 'Phase 3', 'codex': 'Phase 4', 'claude-sdk': 'the internal track' };

function which(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
}

/**
 * What the runner's JSON log lines say about one attempt: its outcome, the commit or kept branch,
 * the pull request, the checks and what it cost. Cost is the runner's own running total (every
 * engineer and repair pass's `total_cost_usd`), reported on `done` or on the failure's kept result
 * and otherwise on the last heartbeat; a pass killed before its result line is priced from tokens
 * by Vocion, not here, so a run with `claude.usage_from_stream` is marked cost-incomplete.
 */
export function parseRunnerLog(text) {
  const events = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) {
      continue;
    }
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  const out = { status: 'infra', sha: null, branch: null, prUrl: null, elapsedS: null, checks: [], error: '', model: null, tokenUsage: null, agentReport: '' };
  let finalCost = null;
  let heartbeatCost = null;
  let costComplete = true;
  for (const e of events) {
    switch (e.phase) {
      case 'task':
        out.model = e.model_policy?.model || out.model;
        break;
      case 'heartbeat':
        heartbeatCost = Number.isFinite(e.cost_usd) ? e.cost_usd : heartbeatCost;
        break;
      case 'claude.usage_from_stream':
        costComplete = false;
        break;
      case 'verified':
      case 'verify.failed':
        out.checks = e.checks || [];
        break;
      case 'pushed':
      case 'kept.pushed':
        out.branch = e.branch;
        out.sha = e.commit_sha;
        break;
      case 'pr.opened':
      case 'pr.existing':
        out.prUrl = e.pr_url || out.prUrl;
        break;
      case 'complete.local':
        out.status = 'pr';
        out.sha = e.result?.commit_sha || out.sha;
        out.prUrl = e.result?.pr_url || out.prUrl;
        out.elapsedS = e.result?.elapsed_s ?? out.elapsedS;
        out.tokenUsage = e.result?.token_usage || null;
        out.model = e.result?.token_usage?.model || out.model;
        out.checks = e.result?.checks || out.checks;
        out.agentReport = String(e.result?.agent_report || '').slice(0, 600);
        break;
      case 'fail.local':
        out.status = 'failed';
        out.error = String(e.error || '').slice(0, 600);
        out.branch = e.result?.kept_branch || out.branch;
        out.prUrl = e.result?.pr_url || out.prUrl;
        out.sha = e.result?.commit_sha || out.sha;
        finalCost = Number.isFinite(e.result?.cost_usd) ? e.result.cost_usd : finalCost;
        break;
      case 'contract.refused':
      case 'crash':
        out.status = 'infra';
        out.error = String(e.error || [].concat(e.problems || []).join('; ')).slice(0, 600);
        break;
      case 'done':
        finalCost = Number.isFinite(e.cost_usd) ? e.cost_usd : finalCost;
        out.elapsedS = e.elapsed_s ?? out.elapsedS;
        break;
      default:
    }
  }
  const costUsd = finalCost ?? heartbeatCost;
  return { ...out, costUsd, costComplete: costComplete && costUsd !== null, events: events.length };
}

/** The runner image, given the contract: one attempt, its log on stdout (packages/runner/src/runner.mjs). */
const claudeCli = {
  id: 'claude-cli',
  needsRemote: true,
  preflight({ image = process.env.EVAL_RUNNER_IMAGE, fixtureRepo = process.env.EVAL_FIXTURE_REPO, env = process.env } = {}) {
    const missing = [];
    if (!which('docker')) {
      missing.push({ need: 'docker', why: 'the runner runs in its image: the guard hooks live at /opt/vocion-runner/hooks and claude-settings.json points there' });
    }
    if (!image) {
      missing.push({ need: 'EVAL_RUNNER_IMAGE (or --runner-image)', why: 'the runner image to test, for example ghcr.io/vocion/vocion-runner:sha-<core sha>' });
    } else if (which('docker')) {
      // Reaching the daemon and finding the image here, so a run never stops on its first attempt.
      const r = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8' });
      if (r.status !== 0) {
        const why = String(r.stderr || r.error?.message || '').trim().split('\n')[0];
        missing.push({ need: `the image ${image}, through a Docker daemon this user can reach`, why: why || 'docker image inspect failed; pull or build it first' });
      }
    }
    if (!env.ANTHROPIC_API_KEY) {
      missing.push({ need: 'ANTHROPIC_API_KEY', why: 'the runner strips AWS credentials from the engineer\'s environment, so today\'s engine reaches the model with an Anthropic key, not Bedrock' });
    }
    if (!env.GITHUB_TOKEN) {
      missing.push({ need: 'GITHUB_TOKEN', why: 'the runner pushes a factory/* branch and opens a pull request on the fixture repository' });
    }
    if (!fixtureRepo || !/^https:\/\//.test(fixtureRepo)) {
      missing.push({ need: 'EVAL_FIXTURE_REPO (or --fixture-repo), an https URL', why: 'a sandbox GitHub repository the fixture is published to; the contract accepts only https clone URLs' });
    }
    return { ok: missing.length === 0, missing };
  },
  attempt({ contract, image = process.env.EVAL_RUNNER_IMAGE, env = process.env, timeoutMinutes }) {
    const started = Date.now();
    const pass = ['ANTHROPIC_API_KEY', 'GITHUB_TOKEN'];
    // The contract's budget and clock, and the runner's own caps set to the same, so neither is
    // cut short by a default. QA capture is off: the hidden tests are the QA seat here.
    const caps = [`MAX_BUDGET_USD=${contract.token_budget_usd}`, `WALL_CLOCK_MINUTES=${contract.wall_clock_minutes}`, 'QA_CAPTURE=0'];
    const args = ['run', '--rm', '-e', 'LOCAL_TASK_JSON', ...caps.flatMap(k => ['-e', k]), ...pass.flatMap(k => ['-e', k]), image];
    return new Promise((resolve) => {
      const child = spawn('docker', args, { env: { ...env, LOCAL_TASK_JSON: JSON.stringify(contract) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      child.stdout.on('data', (d) => {
        log += d;
      });
      child.stderr.on('data', (d) => {
        log += d;
      });
      const timer = setTimeout(() => child.kill('SIGTERM'), ((timeoutMinutes || 60) + 10) * 60000);
      child.on('close', () => {
        clearTimeout(timer);
        const parsed = parseRunnerLog(log);
        resolve({ ...parsed, elapsedS: parsed.elapsedS ?? Math.round((Date.now() - started) / 1000), log });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ status: 'infra', error: String(e.message || e), elapsedS: 0, costUsd: null, log });
      });
    });
  },
};

/** Applies the case's reference change on a branch of the local fixture: a known-good engine. */
const oracle = {
  id: 'oracle',
  needsRemote: false,
  preflight: () => ({ ok: true, missing: [] }),
  attempt({ c, fixture, baseSha, branch }) {
    const started = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `eval-oracle-${c.id}-`));
    fs.rmSync(dir, { recursive: true, force: true });
    git(fixture.dir, ['worktree', 'add', '-q', '-B', branch, dir, baseSha]);
    try {
      git(dir, ['apply', '--whitespace=nowarn', c.reference]);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', `${c.risk_class}: ${c.title}`]);
      return { status: 'pr', sha: git(dir, ['rev-parse', 'HEAD']), branch, prUrl: null, elapsedS: Math.round((Date.now() - started) / 1000), costUsd: 0, checks: [] };
    } catch (e) {
      return { status: 'failed', error: String(e.stderr || e.message).slice(0, 400), elapsedS: Math.round((Date.now() - started) / 1000), costUsd: 0 };
    } finally {
      git(fixture.dir, ['worktree', 'remove', '--force', dir]);
    }
  },
};

/** Changes nothing and says so, the way the runner fails "no changes". */
const noop = {
  id: 'noop',
  needsRemote: false,
  preflight: () => ({ ok: true, missing: [] }),
  attempt: () => ({ status: 'failed', error: 'the engineer produced no changes', elapsedS: 0, costUsd: 0 }),
};

const ENGINES = { 'claude-cli': claudeCli, oracle, noop };

export const ENGINE_IDS = [...Object.keys(ENGINES), ...Object.keys(PLANNED)];

export function engine(id) {
  if (ENGINES[id]) {
    return ENGINES[id];
  }
  if (PLANNED[id]) {
    throw new Error(`engine ${id} is not built yet (${PLANNED[id]} of the engine plan); available: ${Object.keys(ENGINES).join(', ')}`);
  }
  throw new Error(`unknown engine ${id}; one of ${ENGINE_IDS.join(', ')}`);
}
