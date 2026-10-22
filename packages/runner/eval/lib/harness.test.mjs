// End to end without a model: the fixture, the graders and the attempt loop, with the oracle, noop
// and a scripted engine that needs a send-back. `run.mjs check` proves every case the same way.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { parseArgs } from '../run.mjs';
import { loadCases, selectCases } from './cases.mjs';
import { engine } from './engines.mjs';
import { git, materializeFixture } from './fixture.mjs';
import { runCase, runEval } from './harness.mjs';
import { scoreboard } from './report.mjs';

const cases = loadCases();
let tmp;
let fixture;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-harness-test-'));
  fixture = materializeFixture(path.join(tmp, 'fixture'));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('the fixture is deterministic: the same commits every time', () => {
  const again = materializeFixture(path.join(tmp, 'again'));
  assert.deepEqual(again.refs, fixture.refs);
});

test('oracle passes and noop fails a case from each fixture and risk class', async () => {
  const picked = selectCases(cases, { ids: ['c26', 'c29', 'c13', 'c21'] });
  const good = await runEval({ cases: picked, engineId: 'oracle' });
  assert.equal(good.summary.all.accepted, 4);
  assert.equal(good.summary.all.medianScore, 100);
  assert.equal(good.summary.bySplit['held-out'].runs, 3);
  const none = await runEval({ cases: picked, engineId: 'noop' });
  assert.equal(none.summary.all.accepted, 0);
  assert.equal(none.results[0].attempts.length, 1, 'nothing kept, so nothing to send back');
  const board = scoreboard(good);
  assert.match(board, /\| c29-document-access \| held-out \| 2 \| auth \| 1 \| \*\*100\*\*/);
});

test('a partial first attempt is sent back with its failed lines and resumed from its branch', async () => {
  const c = selectCases(cases, { ids: ['c29'] })[0];
  const seen = [];
  const oracle = engine('oracle');
  const scripted = {
    id: 'scripted',
    needsRemote: false,
    attempt(ctx) {
      seen.push(ctx.contract);
      if (ctx.contract.attempt === 1) {
        const sha = git(fixture.dir, ['rev-parse', fixture.refs.v1]);
        git(fixture.dir, ['branch', '-f', 'scripted/c29', sha]);
        return { status: 'pr', sha, branch: 'scripted/c29', elapsedS: 300, costUsd: 1 };
      }
      return { ...oracle.attempt({ ...ctx, baseSha: fixture.refs.v1 }), elapsedS: 300, costUsd: 1 };
    },
  };
  const r = await runCase({ c, run: 1, engine: scripted, fixture, options: { maxAttempts: 3 } });
  assert.equal(r.attempts.length, 2, JSON.stringify(r.attempts.map(a => ({ s: a.status, e: a.error, g: a.grade && [a.grade.passed, a.grade.suiteTail] }))));
  assert.equal(seen[1].base_sha, 'scripted/c29');
  assert.equal(seen[1].attempt, 2);
  assert.match(seen[1].notes, /These lines were not met/);
  assert.ok(seen[1].notes.includes(c.acceptance[0]));
  assert.equal(r.score.acceptedOn, 2);
  assert.equal(r.score.points.attempts, 12);
  assert.equal(r.score.points.honest, 10, 'said ready on attempt 1 with one line of four missing');
  assert.equal(r.score.timeToPrS, 600);
});

test('an engine that cannot run here reports what it needs instead of running', async () => {
  const r = await runEval({ cases: cases.slice(0, 1), engineId: 'claude-cli', env: {} });
  assert.equal(r.ran, false);
  assert.ok(r.missing.some(m => m.need === 'ANTHROPIC_API_KEY'));
  assert.match(scoreboard(r), /did not run/);
});

test('the command line', () => {
  const o = parseArgs(['run', '--split', 'held-out', '--cases=c07,c13', '--runs', '2']);
  assert.equal(o.engine, 'claude-cli');
  assert.equal(o.model, 'claude-opus-5-5');
  assert.deepEqual(o.cases, ['c07', 'c13']);
  assert.equal(o.runs, 2);
  assert.throws(() => parseArgs(['run', '--split', 'train']), /--split/);
  assert.throws(() => parseArgs(['run', '--wat']), /unknown flag/);
});
