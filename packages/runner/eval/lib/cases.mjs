// The eval cases: one directory per case under eval/cases, each with case.json (the ask as the
// engineering seat receives it, plus its grade and split), grader.test.mjs (the hidden acceptance
// tests, one per acceptance line, titled A1..An) and reference.patch (a change that passes them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '../../src/contract.mjs';

export const EVAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = path.join(EVAL_DIR, 'cases');
export const SPLITS = ['tuning', 'held-out'];
export const FIXTURE_REFS = ['v1', 'v2'];

// What a case gets by complexity: the runner's budget and wall clock (the factory sizes neither by
// complexity yet; walk 20 lost 40 minutes to one number for every task).
export const BUDGET_USD = { 1: 3, 2: 4, 3: 8, 4: 12 };
export const WALL_CLOCK_MINUTES = { 1: 20, 2: 25, 3: 40, 4: 45 };

// The fixture's files a person owns: its own instructions and scripts, and CI.
export const HUMAN_OWNED = ['CLAUDE.md', 'package.json', '.github/**'];

// A preview surface for the ui cases, which the contract requires to carry a qa block. The eval
// runs with QA capture off; the block is here so the contract is the one the factory would send.
const QA_SURFACE = {
  live_url: 'https://library.northwind.example',
  build: { command: 'npm run build', dist: 'dist', port: 5274 },
  list_routes: ['/'],
};

const REQUIRED = ['id', 'split', 'complexity', 'risk_class', 'origin', 'fixture_ref', 'title', 'objective', 'acceptance', 'allowed_paths', 'plan_summary'];

/** Problems with one case's metadata, as plain sentences. Empty when it is well formed. */
export function caseProblems(c, dir) {
  const out = [];
  for (const k of REQUIRED) {
    if (c[k] === undefined) {
      out.push(`${c.id || dir}: ${k} is missing`);
    }
  }
  if (c.id && path.basename(dir) !== c.id) {
    out.push(`${c.id}: the directory is named ${path.basename(dir)}`);
  }
  if (!SPLITS.includes(c.split)) {
    out.push(`${c.id}: split must be one of ${SPLITS.join(', ')}`);
  }
  if (![1, 2, 3, 4].includes(c.complexity)) {
    out.push(`${c.id}: complexity must be 1 to 4`);
  }
  if (!FIXTURE_REFS.includes(c.fixture_ref)) {
    out.push(`${c.id}: fixture_ref must be one of ${FIXTURE_REFS.join(', ')}`);
  }
  if (!Array.isArray(c.acceptance) || !c.acceptance.length) {
    out.push(`${c.id}: acceptance must list at least one line`);
  }
  return out;
}

/** Every case, sorted by id. Throws with every problem named when one is malformed. */
export function loadCases(dir = CASES_DIR) {
  const cases = [];
  const problems = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const caseDir = path.join(dir, name);
    if (!fs.statSync(caseDir).isDirectory()) {
      continue;
    }
    const c = JSON.parse(fs.readFileSync(path.join(caseDir, 'case.json'), 'utf8'));
    problems.push(...caseProblems(c, caseDir));
    for (const f of ['grader.test.mjs', 'reference.patch']) {
      if (!fs.existsSync(path.join(caseDir, f))) {
        problems.push(`${c.id}: ${f} is missing`);
      }
    }
    cases.push({ ...c, dir: caseDir, grader: path.join(caseDir, 'grader.test.mjs'), reference: path.join(caseDir, 'reference.patch') });
  }
  const ids = cases.map(c => c.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    problems.push(`${id}: two cases share the id`);
  }
  if (problems.length) {
    throw new Error(`eval cases refused: ${problems.join('; ')}`);
  }
  return cases;
}

/** The cases a run asks for: a split ('tuning', 'held-out' or 'all') and an optional id list. */
export function selectCases(cases, { split = 'all', ids = [] } = {}) {
  const named = id => c => c.id === id || c.id.startsWith(`${id}-`);
  const unknown = ids.filter(id => !cases.some(named(id)));
  if (unknown.length) {
    throw new Error(`no case ${unknown.join(', ')}`);
  }
  return cases.filter(c => (split === 'all' || c.split === split) && (!ids.length || ids.some(id => named(id)(c))));
}

/**
 * The task contract the runner receives for one attempt of one case, the same shape factory
 * dispatch sends (packages/runner/contract/schema.json). `baseSha` is the fixture commit for the
 * first attempt and the previous attempt's branch for a retry, which the runner reads as a resume.
 */
export function contractFor(c, { repo, baseSha, attempt = 1, run = 1, notes = '', modelPolicy = {} }) {
  const contract = {
    task_id: `eval-${c.id}-r${run}`,
    product: 'northwind-library',
    repo,
    base_sha: baseSha,
    title: c.title,
    objective: `${c.objective}\n\nWork in this repository as its CLAUDE.md describes, and add tests for every rule you add.`,
    acceptance_contract: c.acceptance,
    allowed_paths: c.allowed_paths,
    risk_class: c.risk_class,
    required_checks: ['test', 'no-em-dashes'],
    checks: [{ name: 'test', command: 'npm test' }],
    plan: { plan_id: `eval-plan-${c.id}`, summary: c.plan_summary, approved_by: 'factory eval (a fixed plan per case)' },
    model_policy: modelPolicy,
    token_budget_usd: BUDGET_USD[c.complexity],
    wall_clock_minutes: WALL_CLOCK_MINUTES[c.complexity],
    attempt,
    human_owned: HUMAN_OWNED,
  };
  if (notes) {
    contract.notes = notes;
  }
  if (c.risk_class === 'ui' || c.risk_class === 'marketing') {
    contract.qa = { surface: 'web', surfaces: { web: QA_SURFACE }, flows: [{ name: 'library', path: '/' }] };
  }
  return contract;
}

/** validateContract from the runner, so a case the runner would refuse is caught here first. */
export function contractProblems(contract) {
  return validateContract(contract).errors;
}

/** What QA sends back when lines were not met: the next attempt's notes. */
export function sendBackNotes(c, lines) {
  const failed = lines.filter(l => !l.passed).map(l => `- ${c.acceptance[l.index]}`);
  return failed.length ? `QA sent the previous attempt back. These lines were not met:\n${failed.join('\n')}\nContinue from the kept branch; keep what already works.` : '';
}
