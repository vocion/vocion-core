import assert from 'node:assert/strict';
// node --test packages/runner/src/keep.test.mjs
import { describe, it } from 'node:test';
import { classifyBase, classifyStop, continueLine, criteriaAllSkipped, effectiveAttempt, evidenceSection, humanOwned, keepDecision, matchingTests, namedTestOutput, namedTestPassed, namedTestStatus, namedVerdict, numberTests, plainDashes, prTitle, refusedFlowsSection, runtimeDdlHits, skipReason, taskHeadline, testNamePattern, testResultsOf, testRunMarkdown, testsSection, testTemplate, verdictText, wipBranchName, wipCommitMessage, wipPrBody, wipPrTitle } from './keep.mjs';

const EM_DASH = String.fromCharCode(0x2014);
const task = {
  task_id: 'northwind-0005-rename',
  product: 'northwind-portal',
  repo: 'https://github.com/example/northwind-portal.git',
  base_sha: 'origin/main',
  objective: `Make the product name and primary domain configuration, then rename it at portal.northwind.example ${EM_DASH} without changing what serves today.`,
  request_id: 'northwind-rename-2026-09-20',
  acceptance_contract: ['npm run typecheck passes'],
  allowed_paths: ['packages/core/src/product.ts', 'docs/**'],
  risk_class: 'logic',
  required_checks: ['typecheck', 'test', 'no-em-dashes'],
  attempt: 1,
};
const allowed = f => f === 'packages/core/src/product.ts' || f.startsWith('docs/');

describe('when to keep', () => {
  it('keeps only the files inside allowed_paths and names the rest', () => {
    const d = keepDecision(['docs/DECISIONS.md', 'packages/core/src/product.ts', 'apps/acme-web/index.html'], allowed);
    assert.equal(d.keep, true);
    assert.deepEqual(d.kept, ['docs/DECISIONS.md', 'packages/core/src/product.ts']);
    assert.deepEqual(d.outside, ['apps/acme-web/index.html']);
  });

  it('keeps nothing when the tree is clean or every change is outside allowed_paths', () => {
    assert.equal(keepDecision([], allowed).keep, false);
    assert.equal(keepDecision(['apps/acme-web/index.html'], allowed).keep, false);
  });

  it('classifies the stop from what the worker knows', () => {
    assert.equal(classifyStop({ result: { is_error: false }, verificationOk: false }), 'checks-failed');
    assert.equal(classifyStop({ result: { is_error: true, subtype: 'error_max_budget_usd' } }), 'budget-stop');
    assert.equal(classifyStop({ result: null, killReason: 'wall clock: claude exceeded 2400s' }), 'wall-clock');
    assert.equal(classifyStop({ result: null }), 'claude-exit');
    assert.equal(classifyStop({ result: { is_error: true, subtype: 'error_during_execution' } }), 'claude-exit');
    assert.equal(classifyStop({ stopped: true, stopReason: 'budget-stop' }), 'budget-stop');
    assert.equal(classifyStop({ stopped: true, stopReason: 'wall-clock' }), 'wall-clock');
    assert.equal(classifyStop({ stopped: true }), 'stop');
    assert.equal(classifyStop({ result: { is_error: false }, verificationOk: true }), null);
  });
});

describe('branch, commit and PR', () => {
  it('names the branch factory/<task_id>-wip-<run id>', () => {
    assert.equal(wipBranchName('northwind-0005-rename', 341), 'factory/northwind-0005-rename-wip-341');
    assert.equal(wipBranchName('T-0001 Local Smoke', 'local-20260920T1200'), 'factory/t-0001-local-smoke-wip-local-20260920t1200');
  });

  it('writes the commit subject the brief asks for, per reason, with no em dash', () => {
    const checks = wipCommitMessage({ task, reason: 'checks-failed', runId: 341, model: 'claude-opus-5' });
    assert.equal(checks.split('\n')[0], 'wip(northwind-0005-rename): checks failed, kept for review');
    assert.ok(checks.includes('Vocion-Worker-Run: 341'));
    assert.ok(checks.includes('Co-Authored-By: claude-opus-5 <noreply@anthropic.com>'));
    assert.equal(wipCommitMessage({ task, reason: 'budget-stop', runId: 1 }).split('\n')[0], 'wip(northwind-0005-rename): budget stop');
    assert.equal(wipCommitMessage({ task, reason: 'wall-clock', runId: 1 }).split('\n')[0], 'wip(northwind-0005-rename): wall-clock stop');
    assert.ok(!checks.includes(EM_DASH));
  });

  it('titles the PR WIP (checks failed): <headline, 60 at most> (run-<id>)', () => {
    const title = wipPrTitle({ task, reason: 'checks-failed', runId: 341 });
    assert.equal(title, 'WIP (checks failed): Make the product name and primary domain configuration, then (run-341)');
    assert.ok(title.length <= 100);
    assert.equal(wipPrTitle({ task: { objective: 'Fix it.' }, reason: 'budget-stop', runId: 7 }), 'WIP (budget stop): Fix it (run-7)');
    assert.equal(wipPrTitle({ objective: 'Fix it.', reason: 'budget-stop', runId: 7 }), 'WIP (budget stop): Fix it (run-7)');
  });

  it('prefers the task title over the objective for the WIP title too', () => {
    const titled = { ...task, title: 'Rename the portal across the product' };
    assert.equal(wipPrTitle({ task: titled, reason: 'stop', runId: 9 }), 'WIP (stopped): Rename the portal across the product (run-9)');
  });

  it('assembles a body with the contract, the check tails, the claude preview, the cost and the continue line', () => {
    const body = wipPrBody({
      task,
      runId: 341,
      reason: 'checks-failed',
      branch: 'factory/northwind-0005-rename-wip-341',
      attempt: 1,
      checks: [
        { name: 'typecheck', status: 'passed', exit_code: 0, duration_s: 41, tail: 'tsc ok' },
        { name: 'test', status: 'failed', exit_code: 1, duration_s: 88, tail: `FAIL tests/integration/og.test.ts\nCan't reach database server at localhost:55433` },
      ],
      verificationError: 'required checks failed: test',
      claude: { code: 0, model: 'claude-opus-5', durationS: 1001, result: { num_turns: 199, subtype: 'success', result: `Work is left in the working tree, uncommitted ${EM_DASH} see above.` } },
      costUsd: 11.86,
      kept: ['docs/DECISIONS.md'],
      outside: ['apps/acme-web/index.html'],
      workerId: 'fargate-x-8',
      baseSha: 'c4cfed6',
    });
    assert.ok(body.includes('"task_id": "northwind-0005-rename"'), 'contract');
    assert.ok(body.includes('| test | failed | 1 | 88s |'), 'check row');
    assert.ok(body.includes('Can\'t reach database server at localhost:55433'), 'check tail');
    assert.ok(body.includes('Work is left in the working tree, uncommitted'), 'claude preview');
    assert.ok(body.includes('cost $11.86'), 'cost');
    assert.ok(body.includes('Continue from this branch: pass `base_sha: factory/northwind-0005-rename-wip-341` and `attempt: 2` in the next contract'));
    assert.ok(body.includes('- `apps/acme-web/index.html`'), 'outside files listed');
    assert.ok(body.includes('Left behind (a person owns these, not committed), 1:'));
    assert.ok(!body.includes(EM_DASH), 'no em dash survives, even from the objective or the claude result');
  });

  it('writes the continue line with attempt n+1', () => {
    assert.equal(continueLine('factory/x-wip-9', 3), 'Continue from this branch: pass `base_sha: factory/x-wip-9` and `attempt: 4` in the next contract');
    assert.equal(continueLine('factory/x-wip-9', undefined), 'Continue from this branch: pass `base_sha: factory/x-wip-9` and `attempt: 2` in the next contract');
  });
});

describe('resuming from a branch', () => {
  it('reads base_sha as a sha, main, or a branch to resume from', () => {
    assert.deepEqual(classifyBase('c4cfed6'), { kind: 'sha', ref: 'c4cfed6', resume: false });
    assert.deepEqual(classifyBase('c4cfed6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e'), { kind: 'sha', ref: 'c4cfed6a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e', resume: false });
    assert.deepEqual(classifyBase('origin/main'), { kind: 'main', ref: 'main', resume: false });
    assert.deepEqual(classifyBase('main'), { kind: 'main', ref: 'main', resume: false });
    assert.deepEqual(classifyBase('factory/northwind-0005-rename-wip-341'), { kind: 'branch', ref: 'factory/northwind-0005-rename-wip-341', resume: true });
    assert.deepEqual(classifyBase('origin/feat/thing'), { kind: 'branch', ref: 'feat/thing', resume: true });
  });

  it('takes the larger of the run attempt and the contract attempt', () => {
    assert.equal(effectiveAttempt(1, 2), 2);
    assert.equal(effectiveAttempt(3, 1), 3);
    assert.equal(effectiveAttempt(undefined, undefined), 1);
  });
});

describe('the headline a commit subject and a PR title are built from', () => {
  it('prefers the task title over the objective', () => {
    assert.equal(
      taskHeadline({ title: 'Rename the portal across the product', objective: 'Make the product name configuration. Then rename it.' }),
      'Rename the portal across the product',
    );
  });

  it('falls back to the first sentence of the objective when there is no title', () => {
    assert.equal(taskHeadline({ objective: 'Add a share action. It opens a dialog. It copies a link.' }), 'Add a share action');
    assert.equal(taskHeadline({ objective: 'Add a share action\nIt opens a dialog' }), 'Add a share action');
    assert.equal(taskHeadline({ title: '   ', objective: 'Add a share action.' }), 'Add a share action');
  });

  it('strips a trailing period, collapses whitespace and drops em dashes', () => {
    assert.equal(taskHeadline({ title: '  Send   the   invite  email.  ' }), 'Send the invite email');
    assert.equal(taskHeadline({ title: `Send the invite email ${EM_DASH} twice` }), 'Send the invite email , twice');
    assert.equal(taskHeadline({}), '');
    assert.equal(taskHeadline({ objective: '' }), '');
  });

  it('cuts a long headline at a word boundary, never mid-word and never with an ellipsis', () => {
    const head = taskHeadline({ title: 'Allow a person to email a document link to recipients from the document page' }, { max: 40 });
    assert.equal(head, 'Allow a person to email a document link');
    assert.ok(head.length <= 40);
    assert.ok(!head.endsWith('...'));
    assert.ok(!head.includes('  '));
    assert.equal(taskHeadline({ title: 'Supercalifragilisticexpialidocious' }, { max: 10 }), 'Supercalif');
  });

  it('titles the PR from the task title, not the objective (northwind-0008-email-wordmark)', () => {
    const wordmark = {
      task_id: 'northwind-0008-email-wordmark',
      risk_class: 'marketing',
      title: 'Show the product wordmark in every product email instead of a broken image',
      objective: 'Ship the email wordmark the invite email already points at. Every product email renders a broken image where the wordmark should be.',
    };
    assert.equal(
      prTitle({ task: wordmark }),
      'marketing: Show the product wordmark in every product email instead of a broken image (northwind-0008-email-wordmark)',
    );
    const untitled = { ...wordmark, title: undefined };
    assert.equal(prTitle({ task: untitled }), 'marketing: Ship the email wordmark the invite email already points at (northwind-0008-email-wordmark)');
  });

  it('keeps the task id on the end and stays inside 120 characters', () => {
    const long = { task_id: 'northwind-0008-email-wordmark', risk_class: 'logic', title: 'Show the product wordmark in every product email instead of a broken image that nobody at all can read' };
    const t = prTitle({ task: long });
    assert.ok(t.length <= 120, t);
    assert.ok(t.endsWith(' (northwind-0008-email-wordmark)'), t);
    assert.ok(t.startsWith('logic: Show the product wordmark'), t);
  });
});

describe('plainDashes', () => {
  it('turns the em dash a quoted reviewer note carries into a plain dash', () => {
    const em = String.fromCharCode(0x2014);
    assert.equal(plainDashes(`unproven ${em} re-run the capture`), 'unproven  -  re-run the capture');
    assert.equal(plainDashes('nothing to change'), 'nothing to change');
    assert.equal(plainDashes(undefined), '');
  });
});

describe('evidenceSection', () => {
  it('lists every shot with its link, and says which were not captured and why', () => {
    const lines = evidenceSection([
      { role: 'qa-screenshot', flow: 'Library', viewport: 'desktop', side: 'before', url: '', caption: 'Library · desktop · before: Production needs a signed in session, no before captured' },
      { role: 'qa-screenshot', flow: 'No match offers Clear', viewport: 'desktop', side: 'after', url: 'https://files.example/a.png' },
      { role: 'qa-report', url: 'https://files.example/r.md' },
    ]);
    assert.deepEqual(lines.slice(4), [
      '- **Library** (desktop, before): not captured (Production needs a signed in session, no before captured)',
      '- **No match offers Clear** (desktop, after): https://files.example/a.png',
      '',
    ]);
    assert.deepEqual(evidenceSection([]), []);
  });
});

describe('evidenceSection with artifact pages', () => {
  it('links each stored shot by its short artifact page, and falls back to the raw url', () => {
    const lines = evidenceSection([
      { role: 'qa-screenshot', flow: 'Empty state', viewport: 'desktop', side: 'after', url: 'https://files.example/long-presigned.png', artifactId: 733 },
      { role: 'qa-screenshot', flow: 'Chips', viewport: 'desktop', side: 'after', url: 'https://files.example/b.png' },
    ], id => `https://agents.example/dashboard/artifacts/${id}`);
    assert.deepEqual(lines.slice(4, 6), [
      '- **Empty state** (desktop, after): https://agents.example/dashboard/artifacts/733',
      '- **Chips** (desktop, after): https://files.example/b.png',
    ]);
  });
});

it('the pull request lists each named test, linked at the head commit', () => {
  const lines = testsSection([{ criterion: 'Scope holds', file: 'a/b.test.ts', name: 'keeps it out' }], rel => `https://github.com/o/r/blob/abc/${rel}`);
  assert.equal(lines[0], '### Tests that prove criteria');
  assert.ok(lines.includes('- **Scope holds**: [a/b.test.ts](https://github.com/o/r/blob/abc/a/b.test.ts) › it(\'keeps it out\')'));
  assert.deepEqual(testsSection([]), []);
});

it('the pull request links the stored run of the named tests, and the run shows each output', () => {
  const lines = testsSection([{ criterion: 'Scope holds', file: 'a/b.test.ts', name: 'keeps it out', passed: true }], null, 'https://v.example/dashboard/artifacts/9');
  assert.match(lines[2], /The output of every run: https:\/\/v\.example\/dashboard\/artifacts\/9/);
  assert.ok(lines.includes('- **Scope holds**: a/b.test.ts › it(\'keeps it out\') passed'));
  const md = testRunMarkdown([{ criterion: 'Scope holds', file: 'a/b.test.ts', name: 'keeps it out', passed: true, command: 'cd apps/api && npx vitest run b.test.ts', output: '✓ keeps it out 12ms' }], 384);
  assert.match(md, /^# Named tests, run 384/);
  assert.match(md, /## Passed: Scope holds/);
  assert.match(md, /✓ keeps it out/);
});

it('a named test passed only when its own line is marked passed, never when skipped (#126 attempt 195)', () => {
  const ran = ' ✓ tests/a.test.ts > lifecycle > aborts within 24 hours 4ms\n ↓ tests/a.test.ts > other';
  const skipped = ' ↓ tests/a.test.ts > lifecycle > aborts within 24 hours\n ✓ tests/a.test.ts > other 2ms';
  assert.equal(namedTestPassed(ran, 'aborts within 24 hours', 0), true);
  assert.equal(namedTestPassed(skipped, 'aborts within 24 hours', 0), false);
  assert.equal(namedTestPassed(ran, 'aborts within 24 hours', 1), false);
});

it('a change may not create tables in application code; migrations and tests may (request #124)', () => {
  const files = { 'packages/core/src/services/alerts.ts': 'await prisma.$executeRawUnsafe(`\n  CREATE TABLE IF NOT EXISTS "view_alerts" (', 'packages/core/prisma/migrations/2026_alerts/migration.sql': 'CREATE TABLE "view_alerts" ();', 'packages/core/tests/unit/alerts.test.ts': 'DROP TABLE x', 'README.md': 'CREATE TABLE in prose' };
  const read = f => files[f] ?? null;
  assert.deepEqual(runtimeDdlHits(Object.keys(files), read), ['packages/core/src/services/alerts.ts:2']);
  assert.deepEqual(runtimeDdlHits(['packages/core/src/services/other.ts'], () => 'const x = 1;'), []);
});

// #130 runs 409 and 410 (2026-09-29): every named test passed on its own line, but -t prints the
// file's other eight tests as "↓", and QA read those as the named tests being skipped.
describe('a named test run by itself', () => {
  const out410 = [
    ' RUN  v3.2.7 /workspace/repo/packages/core',
    ' ↓ tests/integration/item-remind.test.ts > who opened it > shows an address as opened with a count, and one that has not as not opened',
    'stdout | tests/integration/item-remind.test.ts > reminding > never reminds someone who has opened it',
    'prisma:error',
    ' ✓ tests/integration/item-remind.test.ts > reminding > never reminds someone who has opened it 167ms',
    ' ↓ tests/integration/item-remind.test.ts > reminding > allows one reminder a day and three per send',
    '      Tests  1 passed | 8 skipped (9)',
  ].join('\n');

  it('reads the verdict from its own line, not from the siblings -t filtered out', () => {
    assert.deepEqual(namedTestStatus(out410, 'never reminds someone who has opened it', 0).status, 'passed');
    assert.equal(namedTestStatus(out410, 'allows one reminder a day and three per send', 0).status, 'skipped');
    assert.equal(namedTestStatus(out410, 'no such test', 0).status, 'not-found');
    assert.equal(namedTestStatus(' × a.test.ts > fails loud 3ms', 'fails loud', 1).status, 'failed');
    assert.equal(namedTestStatus(' ✓ a > adds two more 1ms\n ↓ a > adds two', 'adds two', 0).status, 'skipped');
  });

  it('leaves the filtered siblings out of the stored output and says how many there were', () => {
    const shown = namedTestOutput(out410, 'never reminds someone who has opened it');
    assert.doesNotMatch(shown, /↓/);
    assert.match(shown, /✓ .*never reminds someone who has opened it/);
    assert.match(shown, /\(2 other tests in this file filtered out by -t, not run here\)/);
  });

  it('keeps the named test\'s own skipped line, which is the one that matters', () => {
    const out = ' ↓ a.test.ts > needs a db > reads the row back\n ↓ a.test.ts > plain > adds two';
    assert.match(namedTestOutput(out, 'reads the row back'), /↓ a\.test\.ts > needs a db > reads the row back/);
  });

  it('escapes the name for -t, which vitest reads as a regular expression', () => {
    assert.equal(testNamePattern('says Can\'t tell (anonymous)?'), 'says Can\'t tell \\(anonymous\\)\\?');
    assert.ok(new RegExp(testNamePattern('a+b (c)')).test('x > a+b (c)'));
  });
});

describe('a skipped named test is reported not run, with the reason', () => {
  const source = [
    'import { describe, it } from \'vitest\';',
    'const db = process.env.INTEGRATION_DB;',
    'describe.skipIf(!db)(\'needs a db\', () => {',
    '  it(\'reads the row back\', () => {});',
    '});',
    'describe(\'plain\', () => {',
    '  it.skip(\'skipped on purpose\', () => {});',
    '  it.todo(\'writes later\');',
    '  it.skipIf(!process.env.STRIPE_KEY)(\'charges the card\', () => {});',
    '  it(\'adds two\', () => {});',
    '});',
  ].join('\n');

  it('names the enclosing describe.skipIf and the variable it reads, and whether it was set', () => {
    assert.equal(skipReason(source, 'reads the row back', {}), 'describe.skipIf(!db): INTEGRATION_DB is not set in the test\'s environment');
    assert.equal(skipReason(source, 'reads the row back', { INTEGRATION_DB: 'postgres://x' }), 'describe.skipIf(!db): INTEGRATION_DB is set');
  });

  it('names its own skip, todo and skipIf', () => {
    assert.equal(skipReason(source, 'skipped on purpose'), 'it.skip in the file');
    assert.equal(skipReason(source, 'writes later'), 'it.todo: not written yet');
    assert.equal(skipReason(source, 'charges the card', {}), 'it.skipIf(!process.env.STRIPE_KEY): STRIPE_KEY is not set in the test\'s environment');
    assert.equal(skipReason(source, 'adds two'), '');
  });

  it('writes "Not run: skipped (<reason>)", never passed, and fails loudly when a criterion has nothing that ran', () => {
    const runs = [
      { criterion: 'Reads it back', file: 'a.test.ts', name: 'reads the row back', passed: false, status: 'skipped', reason: 'describe.skipIf(!db): INTEGRATION_DB is not set', command: 'npx vitest', output: ' ↓ a.test.ts > needs a db > reads the row back' },
      { criterion: 'Adds', file: 'a.test.ts', name: 'adds two', passed: true, status: 'passed', command: 'npx vitest', output: ' ✓ a.test.ts > plain > adds two 1ms' },
    ];
    const md = testRunMarkdown(runs, 410);
    assert.match(md, /## Not run: skipped \(describe\.skipIf\(!db\): INTEGRATION_DB is not set\): Reads it back/);
    assert.match(md, /## Criteria with no named test that ran/);
    assert.match(md, /- \*\*Reads it back\*\*: every named test was skipped/);
    assert.match(md, /## Passed: Adds/);
    assert.deepEqual(criteriaAllSkipped(runs).map(c => c.criterion), ['Reads it back']);
    const lines = testsSection(runs.filter(r => r.passed), null, null, runs.filter(r => !r.passed));
    assert.ok(lines.some(l => l.includes('it(\'reads the row back\') not run: skipped (describe.skipIf(!db): INTEGRATION_DB is not set)')), lines.join('\n'));
    assert.ok(!lines.some(l => l.includes('reads the row back\') passed')));
  });

  it('keeps a criterion off the loud list when one of its named tests ran', () => {
    assert.deepEqual(criteriaAllSkipped([{ criterion: 'c', status: 'skipped' }, { criterion: 'c', status: 'passed' }]), []);
  });
});

it('the pull request names every refused flow with its reason', () => {
  assert.deepEqual(refusedFlowsSection([]), []);
  const lines = refusedFlowsSection(['flows[0] (Remind dialog): the criterion names an interaction']);
  assert.equal(lines[0], '### Flows the worker refused');
  assert.ok(lines.includes('- flows[0] (Remind dialog): the criterion names an interaction'));
});

it('the evidence section marks a duplicate or failed-step shot NOT EVIDENCE', () => {
  const lines = evidenceSection([{ role: 'qa-screenshot', flow: 'Remind dialog', viewport: 'desktop', side: 'after', url: 'https://x/1.png', not_evidence: 'duplicate of document page', duplicate_of: 'document page' }]);
  assert.ok(lines.some(l => l.includes('**Remind dialog** (desktop, after): https://x/1.png - NOT EVIDENCE for its criterion (duplicate of document page)')), lines.join('\n'));
});

describe('the plan\'s paths are scope, not a fence (2026-09-30)', () => {
  it('lets the engineer change any file in the repository but a person\'s', () => {
    // Run 423: the theme column lives in packages/core; the plan only opened apps/**.
    for (const f of ['packages/core/prisma/core.prisma', 'packages/core/src/routes/account.ts', 'apps/acme-web/src/lib/theme.ts', 'docs/x.md']) {
      assert.equal(humanOwned(f), false, f);
    }
    for (const f of ['.env', 'apps/acme-api/.env.production', 'deploy.pem', '.git/config', '.github/workflows/ci.yml']) {
      assert.equal(humanOwned(f), true, f);
    }
    // The repository's own list (the contract's human_owned, from the repo record) adds to it.
    for (const f of ['infra/secrets/prod.json', 'tools/factory/hooks/guard.sh']) {
      assert.equal(humanOwned(f, ['infra/secrets/**', 'tools/factory/hooks/']), true, f);
    }
    assert.equal(humanOwned('infra/main.tf', ['infra/secrets/**']), false);
  });

  it('keeps every change but a person\'s files', () => {
    const d = keepDecision(['packages/core/src/services/theme.ts', '.github/workflows/ci.yml'], f => !humanOwned(f));
    assert.deepEqual(d.kept, ['packages/core/src/services/theme.ts']);
    assert.deepEqual(d.outside, ['.github/workflows/ci.yml']);
  });
});

// Walk 10 (2026-10-02, FE-381 task 383): three parametric names ("... ($document at $width px)")
// were run with -t, matched none of the expanded tests, the file read "39 skipped", and QA sent
// the attempt back. A name is now matched against the tests that actually ran.
describe('a named test is matched against the tests that ran (vitest JSON)', () => {
  const report = { testResults: [
    { name: '/workspace/repo/apps/web/tests/lib/header.test.ts', assertionResults: [
      { ancestorTitles: ['the header'], title: 'no stray dot (\'doc_q3\' at 375 px)', status: 'passed' },
      { ancestorTitles: ['the header'], title: 'no stray dot (\'doc_a\' at 1280 px)', status: 'passed' },
      { ancestorTitles: ['the header'], title: 'adds 1 and 2', status: 'passed' },
      { ancestorTitles: ['the header'], title: 'plain one', status: 'passed' },
      { ancestorTitles: ['the header'], title: 'skipped one', status: 'pending' },
      { ancestorTitles: ['the header'], title: 'breaks', status: 'failed' },
    ] },
  ] };
  const tests = numberTests(testResultsOf(report, '/workspace/repo'));
  const file = 'apps/web/tests/lib/header.test.ts';

  it('reads every test with its repo-relative file, full name, status and an id', () => {
    assert.deepEqual(tests[0], { id: 't1', file, title: 'no stray dot (\'doc_q3\' at 375 px)', name: 'the header > no stray dot (\'doc_q3\' at 375 px)', status: 'passed' });
    assert.equal(tests[4].status, 'skipped');
    assert.equal(tests.length, 6);
  });

  it('matches a parametric name to each of its cases, and a plain name to itself or its full name', () => {
    assert.deepEqual(matchingTests('no stray dot ($document at $width px)', file, tests).map(t => t.id), ['t1', 't2']);
    assert.deepEqual(matchingTests('adds %i and %i', file, tests).map(t => t.id), ['t3']);
    assert.deepEqual(matchingTests('plain one', file, tests).map(t => t.id), ['t4']);
    assert.deepEqual(matchingTests('the header > plain one', file, tests).map(t => t.id), ['t4']);
    assert.deepEqual(matchingTests('plain one', 'apps/web/tests/other.test.ts', tests), []);
    assert.equal(testTemplate('plain one'), null);
    assert.equal(testTemplate('costs 100%% of $total').test('costs 100% of 12'), true);
  });

  it('one verdict per name: failed, passed, skipped, or no test matched', () => {
    assert.equal(namedVerdict(matchingTests('no stray dot ($document at $width px)', file, tests)), 'passed');
    assert.equal(namedVerdict(matchingTests('breaks', file, tests)), 'failed');
    assert.equal(namedVerdict(matchingTests('skipped one', file, tests)), 'skipped');
    assert.equal(namedVerdict(matchingTests('a name nobody wrote', file, tests)), 'not-found');
  });

  it('the stored run says "No test matched", never skipped, and lists every test that ran with its id', () => {
    const matched = matchingTests('no stray dot ($document at $width px)', file, tests);
    const runs = [
      { criterion: 'No stray dot', file, name: 'no stray dot ($document at $width px)', passed: true, status: 'passed', matched, command: 'cd apps/web && npx vitest run tests/lib/header.test.ts', output: ' ✓ tests/lib/header.test.ts > the header > no stray dot (\'doc_q3\' at 375 px) 1ms\n ✓ tests/lib/header.test.ts > the header > plain one 1ms\n      Tests  4 passed | 1 skipped | 1 failed (6)' },
      { criterion: 'Header order', file, name: 'a name nobody wrote', passed: false, status: 'not-found', matched: [], command: 'x', output: '' },
    ];
    const md = testRunMarkdown(runs, 483, tests);
    assert.match(md, /## Passed: No stray dot/);
    assert.match(md, /Matched 2 tests that ran:\n\n- `t1` ✓ passed: the header > no stray dot \('doc_q3' at 375 px\)\n- `t2`/);
    assert.match(md, /## No test matched: Header order/);
    assert.doesNotMatch(md, /skipped: Header order|Not run.*Header order/);
    assert.match(md, /## Every test that ran\n\nCite a test by its id/);
    assert.match(md, /- `t6` × failed: the header > breaks/);
    // The excerpt is the matched tests' own lines and the totals, not the file's every line.
    assert.doesNotMatch(md.split('## No test matched')[0], /plain one 1ms/);
    assert.equal(verdictText(runs[1]), 'no test matched: the name is none of the tests that ran in its file');
  });
});
