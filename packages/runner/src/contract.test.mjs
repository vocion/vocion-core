import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// node --test packages/runner/src/
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUILTIN_CHECKS, ContractError, criterionTests, interactionNamed, mergeEngineerFlows, normalizeContract, normalizeQa, QA_STEP_VERBS, RISK_CLASSES, validateContract } from './contract.mjs';
import { PLAN_REQUIRED_RISK_CLASSES } from './plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'contract', 'example-task.json'), 'utf8'));
const minimal = {
  task_id: 'T-0002',
  product: 'northwind-portal',
  repo: 'https://github.com/example/northwind-portal.git',
  base_sha: 'origin/main',
  objective: 'Fix the thing.',
  acceptance_contract: ['the thing is fixed'],
  allowed_paths: ['docs/**'],
  risk_class: 'docs',
  required_checks: ['no-em-dashes'],
};

describe('what the validator accepts', () => {
  it('accepts contract/example-task.json as is, with no defaults applied', () => {
    assert.deepEqual(validateContract(example), { ok: true, errors: [] });
    const { task, applied } = normalizeContract(example);
    assert.deepEqual(task, example);
    assert.deepEqual(applied, []);
  });

  it('accepts the minimal contract and fills only the optional fields, naming each default', () => {
    const { task, applied } = normalizeContract(minimal, { token_budget_usd: 12, wall_clock_minutes: 45 });
    assert.deepEqual(task.dependencies, []);
    assert.deepEqual(task.model_policy, {});
    assert.deepEqual(task.environment, { services: [] });
    assert.equal(task.attempt, 1);
    assert.equal(task.token_budget_usd, 12);
    assert.equal(task.wall_clock_minutes, 45);
    assert.deepEqual(applied.sort(), [
      'attempt=1 (schema)',
      'dependencies=[] (schema)',
      'environment={"services":[]} (schema)',
      'model_policy={} (schema)',
      'token_budget_usd=12 (worker)',
      'wall_clock_minutes=45 (worker)',
    ]);
    // Required fields are never defaulted: the input is not touched and the output carries the input's values.
    for (const k of ['allowed_paths', 'risk_class', 'acceptance_contract', 'required_checks']) {
      assert.deepEqual(task[k], minimal[k]);
    }
  });

  it('accepts an optional title and never defaults one', () => {
    const titled = { ...minimal, title: 'Show the product wordmark in every product email instead of a broken image' };
    assert.deepEqual(validateContract(titled), { ok: true, errors: [] });
    const { task, applied } = normalizeContract(titled);
    assert.equal(task.title, titled.title);
    assert.ok(!applied.some(a => a.startsWith('title=')));
    assert.ok(!('title' in normalizeContract(minimal).task));
    assert.deepEqual(validateContract({ ...minimal, title: '' }).errors, ['title must not be empty']);
    assert.deepEqual(validateContract({ ...minimal, title: 'x'.repeat(121) }).errors, ['title must be at most 120 characters']);
  });

  it('names title as the canonical spelling for a planner that sends taskTitle', () => {
    assert.deepEqual(validateContract({ ...minimal, taskTitle: 'Show the product wordmark' }).errors, ['taskTitle is camelCase; the contract uses snake_case (write title)']);
    assert.deepEqual(validateContract({ ...minimal, task_title: 'Show the product wordmark' }).errors, ['task_title is not a contract field (write title)']);
  });

  it('knows the risk classes and the checks the runner runs with no command', () => {
    assert.deepEqual(RISK_CLASSES, ['docs', 'marketing', 'deps', 'ui', 'logic', 'auth', 'billing', 'schema', 'infra', 'promise']);
    assert.deepEqual(BUILTIN_CHECKS, ['no-em-dashes', 'typecheck', 'test', 'lint', 'build']);
  });

  it('accepts a check the repo record gives a command, and the repository\'s own rules and owned files', () => {
    const custom = { ...minimal, required_checks: ['test', 'e2e-local'], checks: [{ name: 'e2e-local', command: 'npm run e2e -- --project local' }], human_owned: ['infra/secrets/**'], engineer_rules: ['Short declaratives.'] };
    assert.deepEqual(validateContract(custom), { ok: true, errors: [] });
    assert.deepEqual(validateContract({ ...custom, checks: [{ name: 'e2e-local' }] }).errors, ['checks[0].command is required']);
  });
});

describe('what the validator refuses', () => {
  it('refuses the camelCase contract from worker run 340 and names every wrong key with its canonical spelling', () => {
    const run340 = {
      id: 'northwind-0005-rename',
      repo: 'https://github.com/example/northwind-portal.git',
      notes: 'Open a PR, do not merge or deploy.',
      checks: ['typecheck', 'test', 'e2e-local'],
      objective: 'Rename the product.',
      requestId: 'northwind-rename-2026-09-20',
      riskClass: 'feature',
      acceptance: ['npm run typecheck passes'],
      budgetCents: 1500,
      allowedPaths: ['packages/core/src/product.ts', 'docs/**'],
      decisionCost: 'medium',
    };
    const { ok, errors } = validateContract(run340);
    assert.equal(ok, false);
    for (const k of ['task_id', 'product', 'base_sha', 'acceptance_contract', 'allowed_paths', 'risk_class', 'required_checks']) {
      assert.ok(errors.includes(`${k} is required`), `expected "${k} is required" in ${JSON.stringify(errors)}`);
    }
    assert.ok(errors.includes('allowedPaths is camelCase; the contract uses snake_case (write allowed_paths)'));
    assert.ok(errors.includes('riskClass is camelCase; the contract uses snake_case (write risk_class)'));
    assert.ok(errors.includes('requestId is camelCase; the contract uses snake_case (write request_id)'));
    assert.ok(errors.includes('budgetCents is camelCase; the contract uses snake_case (write token_budget_usd)'));
    assert.ok(errors.includes('decisionCost is camelCase; the contract uses snake_case'));
    assert.ok(errors.includes('id is not a contract field (write task_id)'));
    // `checks` is the commands field now; a list of bare names is not it.
    assert.ok(errors.includes('checks[0] must be an object, got string "typecheck"'));
    assert.ok(errors.includes('acceptance is not a contract field (write acceptance_contract)'));
    assert.throws(() => normalizeContract(run340), e => e instanceof ContractError && e.errors.length === errors.length && /^contract refused: \d+ problems: /.test(e.message));
  });

  it('refuses any key with an uppercase letter even when the snake_case field is also present', () => {
    const { ok, errors } = validateContract({ ...minimal, allowedPaths: ['docs/**'] });
    assert.equal(ok, false);
    assert.deepEqual(errors, ['allowedPaths is camelCase; the contract uses snake_case (write allowed_paths)']);
  });

  it('refuses a missing or empty acceptance contract', () => {
    const { acceptance_contract, ...without } = minimal;
    assert.deepEqual(validateContract(without).errors, ['acceptance_contract is required']);
    assert.deepEqual(validateContract({ ...minimal, acceptance_contract: [] }).errors, ['acceptance_contract must have at least 1 item; got 0']);
    assert.deepEqual(validateContract({ ...minimal, acceptance_contract: 'one string' }).errors, ['acceptance_contract must be an array, got string "one string"']);
    assert.deepEqual(validateContract({ ...minimal, acceptance_contract: [''] }).errors, ['acceptance_contract[0] must not be empty']);
  });

  it('refuses a check with no command and no built-in, and an unknown risk class', () => {
    assert.deepEqual(validateContract({ ...minimal, required_checks: ['typecheck', 'e2e-local'] }).errors, [
      'required_checks names e2e-local, which is not one of no-em-dashes, typecheck, test, lint, build and has no command in checks: add { "name": "e2e-local", "command": "..." } to checks (the repo record\'s checks carry it)',
    ]);
    assert.deepEqual(validateContract({ ...minimal, risk_class: 'feature' }).errors, [
      'risk_class must be one of docs, marketing, deps, ui, logic, auth, billing, schema, infra, promise; got "feature"',
    ]);
  });

  it('refuses a service the runner cannot wait for, and accepts postgres by name or with its url and setup', () => {
    assert.deepEqual(validateContract({ ...minimal, environment: { services: ['redis'] } }).errors, [
      'environment.services[0] must be one of postgres; got "redis"',
    ]);
    assert.deepEqual(validateContract({ ...minimal, environment: { services: ['postgres'] } }), { ok: true, errors: [] });
    assert.deepEqual(validateContract({ ...minimal, environment: { services: [{ name: 'postgres', url: 'postgresql://runner:runner@localhost:5432/app', setup: ['npm run db:migrate'] }], setup: ['npm run generate'] } }), { ok: true, errors: [] });
    assert.deepEqual(validateContract({ ...minimal, environment: { services: [{ name: 'postgres', url: 'mysql://x' }] } }).errors, ['environment.services[0].url does not match ^postgres(ql)?://\\S+$; got "mysql://x"']);
  });

  it('accepts a wip branch, a sha or origin/main as base_sha and refuses whitespace', () => {
    for (const base of ['factory/northwind-0005-rename-wip-341', 'origin/factory/x-wip-1', 'c4cfed6', 'origin/main']) {
      assert.deepEqual(validateContract({ ...minimal, base_sha: base }), { ok: true, errors: [] }, base);
    }
    assert.equal(validateContract({ ...minimal, base_sha: 'origin/ main' }).errors.length, 1);
  });

  it('refuses unknown top-level keys, ssh repo URLs, empty allowed_paths and wrong types', () => {
    assert.deepEqual(validateContract({ ...minimal, wall_clock_budget: 20 }).errors, ['wall_clock_budget is not a contract field (write wall_clock_minutes)']);
    assert.deepEqual(validateContract({ ...minimal, colour: 'blue' }).errors, ['colour is not a contract field']);
    assert.equal(validateContract({ ...minimal, repo: 'git@github.com:example/northwind-portal.git' }).errors.length, 1);
    assert.deepEqual(validateContract({ ...minimal, allowed_paths: [] }).errors, ['allowed_paths must have at least 1 item; got 0']);
    assert.deepEqual(validateContract({ ...minimal, attempt: 0 }).errors, ['attempt must be at least 1; got 0']);
    assert.deepEqual(validateContract({ ...minimal, token_budget_usd: '3' }).errors, ['token_budget_usd must be a number, got string "3"']);
    assert.deepEqual(validateContract({ ...minimal, model_policy: { model: 'sonnet', temperature: 1 } }).errors, ['model_policy.temperature is not a contract field']);
    assert.deepEqual(validateContract(null).errors, ['contract must be a JSON object, got null']);
    assert.deepEqual(validateContract([minimal]).errors, ['contract must be a JSON object, got array']);
  });
});

describe('the qa block', () => {
  const ui = { ...minimal, risk_class: 'ui', allowed_paths: ['apps/acme-web/**'] };

  it('refuses a ui task with no qa block and says what to add', () => {
    const { ok, errors } = validateContract(ui);
    assert.equal(ok, false);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^qa is required when risk_class is ui: add qa\.flows/);
  });

  it('refuses a marketing task with no qa block too, and no other risk class', () => {
    assert.equal(validateContract({ ...minimal, risk_class: 'marketing' }).ok, false);
    // The five risk classes that always need a plan carry one here, so this test says only what it
    // means to say: no risk class but ui and marketing needs a qa block.
    const approved = { plan_id: 'PLAN-1', approved_by: 'chris' };
    for (const risk of RISK_CLASSES.filter(r => !['ui', 'marketing'].includes(r))) {
      const task = { ...minimal, risk_class: risk, ...(PLAN_REQUIRED_RISK_CLASSES.includes(risk) ? { plan: approved } : {}) };
      const { ok, errors } = validateContract(task);
      assert.equal(ok, true, `${risk} should not need a qa block: ${errors.join('; ')}`);
    }
  });

  it('refuses a ui task whose qa block names no flow', () => {
    const { errors } = validateContract({ ...ui, qa: { flows: [] } });
    assert.ok(errors.some(e => /qa\.flows must have at least 1 item/.test(e)), errors.join('; '));
    const empty = validateContract({ ...ui, qa: { video: true } });
    assert.ok(empty.errors.some(e => /qa\.flows is required when risk_class is ui/.test(e)), empty.errors.join('; '));
  });

  it('accepts a flow with only a name and a path', () => {
    assert.deepEqual(validateContract({ ...ui, qa: { flows: [{ name: 'document page', path: '/documents/1' }] } }), { ok: true, errors: [] });
  });

  it('names every wrong thing in a flow at once', () => {
    const { errors } = validateContract({ ...ui, qa: { surface: 'App Web', flows: [{ name: 'x', path: 'documents/1', viewports: ['tablet'], before: 'staging', steps: [{ tap: 'Share' }] }] } });
    assert.ok(errors.some(e => /qa\.surface does not match/.test(e)), errors.join('; '));
    assert.ok(errors.some(e => /qa\.flows\[0\]\.path does not match/.test(e)), errors.join('; '));
    assert.ok(errors.some(e => /qa\.flows\[0\]\.viewports\[0\] must be one of desktop, phone/.test(e)), errors.join('; '));
    assert.ok(errors.some(e => /qa\.flows\[0\]\.before must be one of production, none/.test(e)), errors.join('; '));
    assert.ok(errors.some(e => /qa\.flows\[0\]\.steps\[0\]\.tap is not a contract field/.test(e)), errors.join('; '));
  });

  it('knows the six step verbs and refuses a step that names two of them or none', () => {
    assert.deepEqual(QA_STEP_VERBS, ['click', 'fill', 'wait_for', 'shoot', 'upload', 'offline', 'goto', 'remember', 'pause', 'expect_response']);
    const two = validateContract({ ...ui, qa: { flows: [{ name: 'x', path: '/x', steps: [{ click: 'Share', shoot: 'after' }] }] } });
    assert.ok(two.errors.some(e => /steps\[0\] names 2 verbs \(click, shoot\); a step names exactly one/.test(e)), two.errors.join('; '));
    const none = validateContract({ ...ui, qa: { flows: [{ name: 'x', path: '/x', steps: [{}] }] } });
    assert.ok(none.errors.some(e => /steps\[0\] is empty/.test(e)), none.errors.join('; '));
  });

  it('accepts every verb spelled right, and refuses a fill without a value', () => {
    const steps = [{ wait_for: 'main' }, { click: 'Share' }, { fill: { selector: '#to', value: 'a@b.com' } }, { shoot: 'the composer open' }];
    assert.equal(validateContract({ ...ui, qa: { flows: [{ name: 'x', path: '/x', steps }] } }).ok, true);
    const bad = validateContract({ ...ui, qa: { flows: [{ name: 'x', path: '/x', steps: [{ fill: { selector: '#to' } }] }] } });
    assert.ok(bad.errors.some(e => /steps\[0\]\.fill\.value is required/.test(e)), bad.errors.join('; '));
  });

  it('accepts a surface the dispatch filled from the repo record, and refuses a build with no command', () => {
    const surfaces = { app: { live_url: 'https://app.northwind.example', build: { command: 'npm run build -w @northwind/web', dist: 'apps/web/dist', port: 5274, spa_fallback: true, env: { VITE_API_URL: 'https://api.northwind.example' }, signed_in_env: { VITE_MOCK_API: '1' } }, list_routes: ['/library'], error_text: ['Nothing at this address'], preview_note: 'The mock data is apps/web/src/mock.' } };
    assert.deepEqual(validateContract({ ...ui, qa: { surface: 'app', surfaces, flows: [{ name: 'x', path: '/x' }] } }), { ok: true, errors: [] });
    const bad = validateContract({ ...ui, qa: { surface: 'app', surfaces: { app: { live_url: 'http://insecure.example', build: { dist: 'd' } } }, flows: [{ name: 'x', path: '/x' }] } });
    assert.ok(bad.errors.some(e => /qa\.surfaces\.app\.live_url does not match/.test(e)), bad.errors.join('; '));
    assert.ok(bad.errors.some(e => /qa\.surfaces\.app\.build\.command is required/.test(e)), bad.errors.join('; '));
  });

  it('fills the nested defaults and leaves what the contract said alone', () => {
    const qa = normalizeQa({ flows: [{ name: 'document page', path: '/documents/1' }, { name: 'new page', path: '/new', viewports: ['phone'], before: 'none', sign_in: true }] });
    assert.equal(qa.surface, 'app');
    assert.deepEqual(qa.surfaces, {});
    assert.equal(qa.video, false);
    assert.deepEqual(qa.flows[0], { name: 'document page', path: '/documents/1', viewports: ['desktop'], sign_in: false, before: 'production', steps: [] });
    assert.deepEqual(qa.flows[1].viewports, ['phone']);
    assert.equal(qa.flows[1].before, 'none');
    assert.equal(qa.flows[1].sign_in, true);
  });

  it('normalizeQa returns null when there is nothing to capture', () => {
    assert.equal(normalizeQa(undefined), null);
    assert.equal(normalizeQa({}), null);
  });

  it('names qa as the canonical spelling for the shapes people write instead', () => {
    const { errors } = validateContract({ ...minimal, screenshots: [] });
    assert.ok(errors.some(e => /screenshots is not a contract field \(write qa\)/.test(e)), errors.join('; '));
  });
});

describe('mergeEngineerFlows', () => {
  const qa = normalizeQa({ surface: 'app', flows: [{ name: 'library', path: '/', sign_in: true }] });

  it('adds one shot per visible criterion, signed in like the contract, with no before', () => {
    const file = JSON.stringify({ flows: [
      { name: 'typing narrows the list', path: '/', steps: [{ fill: { selector: 'input[type=search]', value: 'kes' } }, { shoot: 'narrowed' }] },
      { name: 'empty result offers Clear', path: '/?q=zzz', viewports: ['phone', 'tablet'], steps: [{ wait_for: 'Clear' }] },
    ] });
    const r = mergeEngineerFlows(qa, file);
    assert.deepEqual(r.added, ['typing narrows the list', 'empty result offers Clear']);
    assert.deepEqual(r.refused, []);
    assert.deepEqual(r.qa.flows.map(f => f.name), ['library', 'typing narrows the list', 'empty result offers Clear']);
    assert.deepEqual([r.qa.flows[2].viewports, r.qa.flows[2].sign_in, r.qa.flows[2].before], [['phone'], true, 'none']);
  });

  it('refuses what the contract vocabulary refuses, and keeps the contract flows whatever happens', () => {
    const r = mergeEngineerFlows(qa, JSON.stringify({ flows: [
      { name: 'library', path: '/' },
      { name: 'bad path', path: 'library' },
      { name: 'two verbs', path: '/', steps: [{ click: 'a', fill: { selector: 'b', value: 'c' } }] },
      { name: 'unknown verb', path: '/', steps: [{ evaluate: 'document.body' }] },
    ] }));
    assert.deepEqual(r.added, []);
    assert.equal(r.refused.length, 4);
    assert.deepEqual(r.qa.flows.map(f => f.name), ['library']);
    assert.match(mergeEngineerFlows(qa, 'not json').refused[0], /not JSON/);
  });

  // Runs 409 and 410: "it opens a dialog", "auto-remind toggle" were shot at rest.
  it('refuses a flow whose criterion names an interaction and has no step that acts, with the reason', () => {
    const r = mergeEngineerFlows(qa, JSON.stringify({ flows: [
      { name: 'Remind dialog', criterion: 'A Not opened row has Remind; it opens a dialog with an optional note.', path: '/documents/doc_q3', steps: [{ wait_for: 'Sent to' }, { shoot: 'the dialog' }] },
      { name: 'Auto-remind toggle, off then on', path: '/documents/doc_q3' },
      { name: 'Sent to shows Opened and Not opened', path: '/documents/doc_q3', steps: [{ wait_for: 'Not opened' }] },
    ] }));
    assert.deepEqual(r.added, ['Sent to shows Opened and Not opened']);
    assert.equal(r.refused.length, 2);
    assert.match(r.refused[0], /flows\[0\] \(Remind dialog\): the criterion names an interaction \("opens a"\) but the flow has no step that acts \(click, fill, upload, offline\)/);
    assert.match(r.refused[1], /\("toggle"\)/);
  });

  it('keeps an interactive flow that reaches its state, and carries its criterion to the evidence', () => {
    const r = mergeEngineerFlows(qa, JSON.stringify({ flows: [
      { name: 'Remind dialog', criterion: 'it opens a dialog with an optional note', path: '/documents/doc_q3', steps: [{ click: 'text=Remind' }, { wait_for: '[role=dialog]' }, { shoot: 'the dialog open' }] },
    ] }));
    assert.deepEqual(r.refused, []);
    assert.equal(r.qa.flows[1].criterion, 'it opens a dialog with an optional note');
  });

  it('reads a static criterion as static: "Opened" and a count of opens are not an interaction', () => {
    assert.equal(interactionNamed({ name: 'Sent to shows each address as Opened (with count and last time) or Not opened.' }), '');
    assert.equal(interactionNamed({ name: 'shows how many opens' }), '');
    assert.equal(interactionNamed({ name: 'the row appears after sending' }), 'appears after');
    assert.equal(interactionNamed({ name: 'x', criterion: 'Clicking Share shows the composer' }), 'Clicking');
  });
});

it('a criterion no screenshot can show keeps its named test only when the branch has it', () => {
  const files = { 'apps/acme-api/test/search.test.ts': 'it(\'keeps a teammate kept-back document out of results\', ...)' };
  const read = rel => files[rel] ?? null;
  const doc = JSON.stringify({ tests: [
    { criterion: 'Search respects the library scope', file: 'apps/acme-api/test/search.test.ts', name: 'keeps a teammate kept-back document out of results' },
    { criterion: 'The free plan cap holds', file: 'apps/acme-api/test/cap.test.ts', name: 'caps at 25' },
    { criterion: 'URL state', file: 'apps/acme-api/test/search.test.ts', name: 'writes q into the URL' },
    { criterion: 'Escapes', file: '../etc/passwd.test.ts', name: 'x' },
  ] });
  const { proofs, refused } = criterionTests(doc, read);
  assert.deepEqual(proofs, [{ criterion: 'Search respects the library scope', file: 'apps/acme-api/test/search.test.ts', name: 'keeps a teammate kept-back document out of results' }]);
  assert.equal(refused.length, 3);
  assert.match(refused[0], /not in the branch/);
  assert.match(refused[1], /has no test named/);
  assert.match(refused[2], /not a test file inside the repo/);
  assert.deepEqual(criterionTests('nope', read).proofs, []);
});
