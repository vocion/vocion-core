import assert from 'node:assert/strict';
// node --test packages/runner/src/
import { describe, it } from 'node:test';
import { validateContract } from './contract.mjs';
import {
  packageRoot,
  packageRoots,
  PLAN_DEFAULT_THRESHOLDS,
  PLAN_OFFERED_RISK_CLASSES,
  PLAN_REQUIRED_RISK_CLASSES,
  planRequirement,
  planThresholds,
  publicInterfaces,
  touchesMoreThanOneFile,
} from './plan.mjs';

const base = {
  task_id: 'T-0100',
  product: 'northwind-portal',
  repo: 'https://github.com/example/northwind-portal.git',
  base_sha: 'origin/main',
  objective: 'Do the thing.',
  acceptance_contract: ['the thing is done'],
  allowed_paths: ['docs/NOTE.md'],
  risk_class: 'docs',
  required_checks: ['no-em-dashes'],
};
const approved = { plan_id: 'PLAN-0100', approved_by: 'chris', approved_at: '2026-09-21T10:00:00Z' };
const codes = (contract, context) => planRequirement(contract, context).triggers.map(t => t.code);

describe('what the rule leaves alone', () => {
  it('asks for no plan for docs, marketing or deps work on one surface', () => {
    for (const risk of ['docs', 'marketing', 'deps']) {
      const r = planRequirement({ ...base, risk_class: risk, allowed_paths: ['docs/NOTE.md'] });
      assert.equal(r.level, 'not_required', `${risk}: ${JSON.stringify(r.triggers)}`);
    }
  });

  it('asks for no plan for a single file ui or logic change', () => {
    for (const risk of PLAN_OFFERED_RISK_CLASSES) {
      const r = planRequirement({ ...base, risk_class: risk, allowed_paths: ['apps/acme-web/src/pages/Doc.tsx'] });
      assert.equal(r.level, 'not_required');
    }
  });

  it('does not count prose as an architectural boundary', () => {
    assert.deepEqual(packageRoots(['docs/DECISIONS.md', 'docs/**', 'README.md', '.github/workflows/CI.yml']), []);
    assert.equal(planRequirement({ ...base, allowed_paths: ['docs/A.md', 'docs/B.md', 'README.md'] }).level, 'not_required');
  });
});

describe('when the rule requires a plan', () => {
  it('requires one for every irreversible, trust bearing or promise risk class, and names why', () => {
    for (const risk of PLAN_REQUIRED_RISK_CLASSES) {
      const r = planRequirement({ ...base, risk_class: risk });
      assert.equal(r.level, 'required', risk);
      assert.deepEqual(r.triggers.map(t => t.code), ['risk_class']);
      assert.match(r.triggers[0].why, new RegExp(`risk_class is ${risk}`));
    }
  });

  it('requires one when the request spans more than one repository', () => {
    const repos = ['https://github.com/example/northwind-portal.git', 'https://github.com/vocion/vocion-core.git'];
    assert.deepEqual(codes(base, { repos }), ['cross_repo']);
    assert.deepEqual(codes(base, { repos: [repos[0], 'https://github.com/example/northwind-portal'] }), []);
  });

  it('requires one when a dependency comes from another repository', () => {
    assert.deepEqual(codes({ ...base, dependencies: ['vocion-core:VC-12'] }), ['cross_repo']);
    assert.deepEqual(codes({ ...base, dependencies: ['northwind-portal#T-0099', 'T-0098'] }), []);
  });

  it('says it cannot see the other tasks rather than guessing', () => {
    const r = planRequirement(base);
    assert.deepEqual(r.unknown, ['repos', 'task_count', 'estimate']);
  });

  it('requires one when allowed_paths crosses a package boundary', () => {
    const spanning = { ...base, allowed_paths: ['apps/acme-web/src/**', 'apps/acme-api/src/**'] };
    assert.deepEqual(codes(spanning), ['package_span']);
    assert.match(planRequirement(spanning).triggers[0].why, /apps\/acme-web, apps\/acme-api/);
    assert.deepEqual(codes({ ...base, allowed_paths: ['apps/acme-web/src/**', 'apps/acme-web/tests/**'] }), []);
  });

  it('reads the package a glob belongs to, and says null when there is none', () => {
    assert.equal(packageRoot('apps/acme-web/src/**'), 'apps/acme-web');
    assert.equal(packageRoot('packages/core/src/services/notify.ts'), 'packages/core');
    assert.equal(packageRoot('factory/intake/lib.mjs'), 'factory');
    assert.equal(packageRoot('docs/DECISIONS.md'), null);
    assert.equal(packageRoot('apps/**'), null);
    assert.equal(packageRoot('README.md'), null);
  });

  it('requires one when the work reaches a public interface, and says which', () => {
    const cases = [
      ['packages/core/src/routes/orgs.ts', 'an HTTP route'],
      ['packages/core/prisma/**', 'a database migration'],
      ['plugins/software-factory/objects/request/type.yaml', 'an object type schema'],
      ['docs/PORTAL-API-CONTRACT.md', 'a published contract'],
    ];
    for (const [glob, what] of cases) {
      assert.deepEqual(publicInterfaces([glob]), [what], glob);
      assert.deepEqual(codes({ ...base, allowed_paths: [glob] }), ['public_interface'], glob);
    }
    assert.deepEqual(publicInterfaces(['apps/acme-web/src/pages/Doc.tsx']), []);
  });

  it('names the postgres service beside a migration, because the run reaches a live database', () => {
    const r = planRequirement({ ...base, allowed_paths: ['apps/acme-api/prisma/**'], environment: { image: 'vocion-runner', services: ['postgres'] } });
    assert.match(r.triggers[0].why, /with a postgres service declared/);
    // A declared service on its own is not a trigger: a docs task that needs a database to run tests
    // is still a docs task.
    assert.equal(planRequirement({ ...base, environment: { image: 'vocion-runner', services: ['postgres'] } }).level, 'not_required');
  });

  it('requires one when more than one engineering task sits under the request', () => {
    assert.deepEqual(codes(base, { task_count: 2 }), ['task_count']);
    assert.deepEqual(codes(base, { task_count: 1 }), []);
  });

  it('requires one when the estimate is over the threshold, and takes the threshold from the configuration', () => {
    assert.deepEqual(codes({ ...base, token_budget_usd: 10 }), []);
    assert.deepEqual(codes({ ...base, token_budget_usd: 10.5 }), ['estimate']);
    // Nothing is hardcoded: the same contract passes under a looser threshold and fails under a tighter one.
    assert.deepEqual(codes({ ...base, token_budget_usd: 10.5 }, { thresholds: { estimate_usd: 25 } }), []);
    assert.deepEqual(codes({ ...base, token_budget_usd: 4 }, { env: { RUNNER_PLAN_ESTIMATE_USD: '3' } }), ['estimate']);
    assert.deepEqual(codes(base, { task_count: 3, thresholds: { tasks_per_request: 5 } }), []);
    assert.deepEqual(codes({ ...base, allowed_paths: ['apps/a/src/**', 'apps/b/src/**'] }, { thresholds: { package_roots: 2 } }), []);
  });

  it('keeps the defaults in one place and reads every one of them from the environment', () => {
    assert.deepEqual(PLAN_DEFAULT_THRESHOLDS, { tasks_per_request: 1, estimate_usd: 10, package_roots: 1 });
    assert.deepEqual(planThresholds({}), PLAN_DEFAULT_THRESHOLDS);
    assert.deepEqual(planThresholds({ RUNNER_PLAN_TASKS_PER_REQUEST: '2', RUNNER_PLAN_ESTIMATE_USD: '30', RUNNER_PLAN_PACKAGE_ROOTS: '3' }), { tasks_per_request: 2, estimate_usd: 30, package_roots: 3 });
    assert.deepEqual(planThresholds({ RUNNER_PLAN_ESTIMATE_USD: 'not a number' }), PLAN_DEFAULT_THRESHOLDS);
  });

  it('lists every trigger that fired, not only the first', () => {
    const many = { ...base, risk_class: 'billing', allowed_paths: ['apps/acme-api/src/routes/**', 'packages/core/src/billing.ts'], token_budget_usd: 40 };
    assert.deepEqual(codes(many, { task_count: 4 }), ['risk_class', 'package_span', 'public_interface', 'task_count', 'estimate']);
  });
});

describe('when the rule offers a plan and lets it be skipped', () => {
  it('offers one for a ui or logic change that touches more than one file', () => {
    for (const risk of PLAN_OFFERED_RISK_CLASSES) {
      const r = planRequirement({ ...base, risk_class: risk, allowed_paths: ['apps/acme-web/src/**'] });
      assert.equal(r.level, 'offered', risk);
      assert.match(r.offered, new RegExp(`risk_class is ${risk}`));
    }
    assert.equal(planRequirement({ ...base, risk_class: 'ui', allowed_paths: ['apps/acme-web/src/a.tsx', 'apps/acme-web/src/b.tsx'] }).level, 'offered');
  });

  it('reads a glob or a directory as more than one file and a named file as one', () => {
    assert.equal(touchesMoreThanOneFile(['apps/acme-web/src/**']), true);
    assert.equal(touchesMoreThanOneFile(['apps/acme-web/src/']), true);
    assert.equal(touchesMoreThanOneFile(['a.ts', 'b.ts']), true);
    assert.equal(touchesMoreThanOneFile(['apps/acme-web/src/a.tsx']), false);
    assert.equal(touchesMoreThanOneFile([]), false);
  });

  it('never offers where it requires', () => {
    const r = planRequirement({ ...base, risk_class: 'logic', allowed_paths: ['apps/acme-web/src/**', 'apps/acme-api/src/**'] });
    assert.equal(r.level, 'required');
    assert.equal(r.offered, null);
  });
});

describe('what the worker refuses, before anything is cloned', () => {
  const ui = { ...base, risk_class: 'ui', allowed_paths: ['apps/acme-web/src/**'], qa: { flows: [{ name: 'doc', path: '/documents/1' }] } };

  it('refuses a contract that needs a plan and carries none, naming every trigger and what to do', () => {
    const { ok, errors } = validateContract({ ...base, risk_class: 'billing' });
    assert.equal(ok, false);
    const plan = errors.find(e => e.startsWith('plan is required'));
    assert.ok(plan, errors.join('; '));
    assert.match(plan, /risk_class is billing/);
    assert.match(plan, /plan\.approved_by/);
    assert.match(plan, /A required plan cannot be skipped/);
  });

  it('refuses a required plan that was skipped, however good the reason', () => {
    const { ok, errors } = validateContract({ ...base, risk_class: 'schema', plan: { skipped: true, skip_reason: 'it is a small one' } });
    assert.equal(ok, false);
    assert.ok(errors.some(e => /plan\.skipped is true but a plan is required/.test(e)), errors.join('; '));
  });

  it('accepts a required plan that names itself and its approver', () => {
    assert.deepEqual(validateContract({ ...base, risk_class: 'infra', plan: approved }), { ok: true, errors: [] });
    assert.deepEqual(validateContract({ ...base, risk_class: 'infra', plan: { url: 'https://agents.metacto.com/plans/12', approved_by: 'chris' } }), { ok: true, errors: [] });
  });

  it('refuses a plan nobody approved, and a plan that names no plan', () => {
    const unapproved = validateContract({ ...base, risk_class: 'auth', plan: { plan_id: 'PLAN-1' } });
    assert.ok(unapproved.errors.some(e => /plan\.approved_by is missing/.test(e)), unapproved.errors.join('; '));
    const nameless = validateContract({ ...base, risk_class: 'auth', plan: { approved_by: 'chris' } });
    assert.ok(nameless.errors.some(e => /plan names neither plan_id nor url/.test(e)), nameless.errors.join('; '));
  });

  it('accepts a skippable plan that was skipped with a reason', () => {
    assert.deepEqual(validateContract({ ...ui, plan: { skipped: true, skip_reason: 'one string on one page, the approach is the change' } }), { ok: true, errors: [] });
  });

  it('refuses a skip with no reason, so a skip can never be mistaken for a step nobody took', () => {
    const { ok, errors } = validateContract({ ...ui, plan: { skipped: true } });
    assert.equal(ok, false);
    assert.ok(errors.some(e => /plan\.skipped is true with no plan\.skip_reason/.test(e)), errors.join('; '));
  });

  it('accepts a skippable task that carries no plan block at all, and one that carries an approved plan', () => {
    assert.deepEqual(validateContract(ui), { ok: true, errors: [] });
    assert.deepEqual(validateContract({ ...ui, plan: approved }), { ok: true, errors: [] });
  });

  it('refuses a skip reason longer than the field allows and a plan field nobody knows', () => {
    const long = validateContract({ ...ui, plan: { skipped: true, skip_reason: 'x'.repeat(501) } });
    assert.ok(long.errors.some(e => /plan\.skip_reason must be at most 500 characters/.test(e)), long.errors.join('; '));
    const strange = validateContract({ ...ui, plan: { plan_id: 'P', approved_by: 'chris', planUrl: 'x' } });
    assert.ok(strange.errors.some(e => /plan\.planUrl is camelCase/.test(e)), strange.errors.join('; '));
  });

  it('names plan as the canonical spelling for the words people write instead', () => {
    for (const [wrong, note] of [['design', 'not a contract field'], ['architecture', 'not a contract field'], ['implementation_plan', 'not a contract field']]) {
      const { errors } = validateContract({ ...base, [wrong]: 'x' });
      assert.ok(errors.some(e => e.includes(`${wrong} is ${note} (write plan)`)), errors.join('; '));
    }
  });

  it('carries the context through from the caller, so the task count can refuse too', () => {
    assert.equal(validateContract(base).ok, true);
    const { ok, errors } = validateContract(base, { task_count: 3 });
    assert.equal(ok, false);
    assert.ok(errors.some(e => /3 engineering tasks sit under this request/.test(e)), errors.join('; '));
  });
});
