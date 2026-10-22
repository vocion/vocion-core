#!/usr/bin/env node
// The factory eval (Phase 0 of the engine plan): walk asks as scored, repeatable cases.
//
//   node packages/runner/eval/run.mjs list
//   node packages/runner/eval/run.mjs check
//   node packages/runner/eval/run.mjs dry-run [--out <dir>]
//   node packages/runner/eval/run.mjs run [--engine claude-cli] [--split tuning|held-out|all]
//        [--cases c07,c13] [--runs 2] [--max-attempts 3] [--model <id>] [--effort high]
//        [--runner-image <image>] [--fixture-repo <https url>] [--out <dir>]
//
// See packages/runner/eval/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contractFor, contractProblems, EVAL_DIR, loadCases, selectCases } from './lib/cases.mjs';
import { engine } from './lib/engines.mjs';
import { materializeFixture } from './lib/fixture.mjs';
import { gradeCommit } from './lib/grade.mjs';
import { runEval } from './lib/harness.mjs';
import { scoreboard } from './lib/report.mjs';

const DEFAULT_MODEL = 'claude-opus-5-5'; // the engineering seat's pinned model (task-engineer.yaml)

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const opts = { command, engine: 'claude-cli', split: 'all', cases: [], runs: 1, maxAttempts: 3, model: DEFAULT_MODEL, effort: '', runnerImage: '', fixtureRepo: '', out: '' };
  for (let i = 0; i < rest.length; i++) {
    const [flag, inline] = rest[i].split('=');
    const value = () => inline ?? rest[++i];
    switch (flag) {
      case '--engine': opts.engine = value(); break;
      case '--split': opts.split = value(); break;
      case '--cases': opts.cases = value().split(',').map(s => s.trim()).filter(Boolean); break;
      case '--runs': opts.runs = Number(value()); break;
      case '--max-attempts': opts.maxAttempts = Number(value()); break;
      case '--model': opts.model = value(); break;
      case '--effort': opts.effort = value(); break;
      case '--runner-image': opts.runnerImage = value(); break;
      case '--fixture-repo': opts.fixtureRepo = value(); break;
      case '--out': opts.out = value(); break;
      default: throw new Error(`unknown flag ${flag}`);
    }
  }
  if (!['all', 'tuning', 'held-out'].includes(opts.split)) {
    throw new Error('--split is all, tuning or held-out');
  }
  if (!(opts.runs >= 1) || !(opts.maxAttempts >= 1)) {
    throw new Error('--runs and --max-attempts are at least 1');
  }
  return opts;
}

function outDir(opts, label) {
  const dir = opts.out || path.join(EVAL_DIR, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeReport(dir, name, report) {
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, `${name}.md`), scoreboard(report));
}

/**
 * Every case is well formed, its contract is one the runner accepts, its hidden tests fail on the
 * fixture it starts from and pass on its reference change. Returns the problems, empty when clean.
 */
export function checkCases(cases) {
  const problems = [];
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-eval-check-')), 'fixture');
  const fixture = materializeFixture(dir);
  try {
    for (const c of cases) {
      const errors = contractProblems(contractFor(c, { repo: 'https://github.com/example/northwind-library.git', baseSha: fixture.refs[c.fixture_ref] }));
      problems.push(...errors.map(e => `${c.id}: the runner would refuse its contract: ${e}`));
      const base = fixture.refs[c.fixture_ref];
      const before = gradeCommit({ repo: fixture.dir, sha: base, baseSha: base, c });
      if (before.passed === before.total) {
        problems.push(`${c.id}: every hidden test already passes on the fixture, so the case proves nothing`);
      }
      const ref = engine('oracle').attempt({ c, fixture, baseSha: base, branch: `check/${c.id}` });
      if (ref.status !== 'pr') {
        problems.push(`${c.id}: the reference change does not apply: ${ref.error}`);
        continue;
      }
      const after = gradeCommit({ repo: fixture.dir, sha: ref.sha, baseSha: base, c });
      if (after.passed !== after.total || !after.suitePassed) {
        problems.push(`${c.id}: the reference change passes ${after.passed} of ${after.total} lines${after.suitePassed ? '' : ' and breaks the fixture suite'}`);
      }
    }
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
  return problems;
}

function describe(cases) {
  const by = (k, v) => cases.filter(c => c[k] === v).length;
  return [
    `${cases.length} cases: ${by('split', 'tuning')} tuning, ${by('split', 'held-out')} held out`,
    `complexity: ${[1, 2, 3, 4].map(cx => `Cx ${cx} ${by('complexity', cx)}`).join(', ')}`,
    `risk: ${[...new Set(cases.map(c => c.risk_class))].sort().map(r => `${r} ${by('risk_class', r)}`).join(', ')}`,
  ].join('\n');
}

async function main(argv) {
  const opts = parseArgs(argv);
  const all = loadCases();
  const cases = selectCases(all, { split: opts.split, ids: opts.cases });
  const modelPolicy = { model: opts.model, ...(opts.effort ? { effort: opts.effort } : {}) };

  if (opts.command === 'list') {
    console.log(describe(cases));
    for (const c of cases) {
      console.log(`${c.id.padEnd(28)} ${c.split.padEnd(9)} Cx ${c.complexity} ${c.risk_class.padEnd(7)} ${c.fixture_ref} walk ${c.origin.walk} (${c.origin.kind}) ${c.title}`);
    }
    return 0;
  }
  if (opts.command === 'check') {
    const problems = checkCases(cases);
    console.log(problems.length ? problems.join('\n') : `${describe(cases)}\nall cases check: contracts accepted, hidden tests fail on the fixture and pass on the reference`);
    return problems.length ? 1 : 0;
  }
  if (opts.command === 'dry-run') {
    const dir = outDir(opts, 'dry-run');
    const problems = checkCases(cases);
    for (const id of ['oracle', 'noop']) {
      const report = await runEval({ cases, engineId: id, runs: 1, maxAttempts: opts.maxAttempts });
      report.label = 'dry run, no model';
      writeReport(dir, id, report);
      console.log(`${id}: accepted ${report.summary.all.accepted}/${report.summary.all.runs}, median score ${report.summary.all.medianScore}`);
    }
    const pre = engine(opts.engine).preflight({ image: opts.runnerImage || undefined, fixtureRepo: opts.fixtureRepo || undefined });
    const blocked = { engine: opts.engine, ran: false, missing: pre.missing };
    writeReport(dir, `${opts.engine}-preflight`, pre.ok ? { ...blocked, missing: [{ need: 'nothing', why: `ready: run \`run --engine ${opts.engine}\`` }] } : blocked);
    console.log(pre.ok ? `${opts.engine}: ready to run` : `${opts.engine}: cannot run here:\n${pre.missing.map(m => `  - ${m.need}: ${m.why}`).join('\n')}`);
    console.log(problems.length ? `case problems:\n${problems.join('\n')}` : 'cases check clean');
    console.log(`reports in ${dir}`);
    return problems.length ? 1 : 0;
  }
  if (opts.command === 'run') {
    const dir = outDir(opts, opts.engine);
    const report = await runEval({
      cases,
      engineId: opts.engine,
      runs: opts.runs,
      maxAttempts: opts.maxAttempts,
      fixtureRepo: opts.fixtureRepo || process.env.EVAL_FIXTURE_REPO || '',
      runnerImage: opts.runnerImage || process.env.EVAL_RUNNER_IMAGE || '',
      modelPolicy,
      logDir: path.join(dir, 'logs'),
      onRun: r => console.log(`${r.case} r${r.run}: ${r.score.total} (${r.score.accepted ? `accepted on ${r.score.acceptedOn}` : 'not accepted'}, ${r.score.linesPassed}/${r.score.linesTotal ?? '?'} lines)`),
    });
    writeReport(dir, opts.engine, report);
    console.log(report.ran ? `accepted ${report.summary.all.accepted}/${report.summary.all.runs}, median score ${report.summary.all.medianScore}` : `cannot run here:\n${report.missing.map(m => `  - ${m.need}: ${m.why}`).join('\n')}`);
    console.log(`reports in ${dir}`);
    return report.ran ? 0 : 2;
  }
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  return opts.command === 'help' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }, (e) => {
    console.error(String(e.message || e));
    process.exitCode = 1;
  });
}
