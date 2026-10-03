// The task contract: one validator for the worker, the CLI and the tests. Plain Node 22, no dependencies.
//
// The shape is packages/runner/contract/schema.json (JSON Schema, additionalProperties false), the
// same file core's dispatch is tested against. This module
// walks that schema with the handful of keywords it uses, adds two rules the schema cannot express
// (a key with an uppercase letter is named as camelCase, a known alias gets its canonical spelling),
// and applies defaults only to the fields the schema marks optional. A contract that does not match
// is refused with every problem listed; nothing is silently downgraded.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRules } from './plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_CANDIDATES = [
  process.env.RUNNER_CONTRACT_SCHEMA,
  path.join(HERE, '..', 'contract', 'schema.json'), // src -> contract, in the repo and in the image alike
].filter(Boolean);

export const SCHEMA_PATH = SCHEMA_CANDIDATES.find(p => fs.existsSync(p));
if (!SCHEMA_PATH) {
  throw new Error(`contract schema not found; looked in ${SCHEMA_CANDIDATES.join(', ')}`);
}
export const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

export const REQUIRED_KEYS = schema.required;
export const KNOWN_KEYS = Object.keys(schema.properties);
export const OPTIONAL_KEYS = KNOWN_KEYS.filter(k => !REQUIRED_KEYS.includes(k));
export const RISK_CLASSES = schema.properties.risk_class.enum;
// The checks the runner knows how to run with no command: no-em-dashes reads the changed files,
// the other four are the package.json script of that name. Any other check name is a command the
// contract's `checks` carries (the repo record's), or the contract is refused.
export const BUILTIN_CHECKS = ['no-em-dashes', 'typecheck', 'test', 'lint', 'build'];
/** @deprecated the built-ins; a contract may name any check its `checks` gives a command for. */
export const KNOWN_CHECKS = BUILTIN_CHECKS;
// The QA block: which risk classes must carry one, the viewports it may name, the step verbs the
// worker can execute. All three are read from the schema so there is one source for them.
export const QA_REQUIRED_RISK_CLASSES = ['ui', 'marketing'];
export const QA_VIEWPORTS = schema.properties.qa.properties.flows.items.properties.viewports.items.enum;
export const QA_STEP_VERBS = Object.keys(schema.properties.qa.properties.flows.items.properties.steps.items.properties);

// Spellings seen from planners and people. Each maps to the canonical key so the refusal says what to write instead.
export const ALIASES = {
  id: 'task_id',
  architecture: 'plan',
  design: 'plan',
  plan_id: 'plan',
  implementation_plan: 'plan',
  planId: 'plan',
  taskId: 'task_id',
  taskTitle: 'title',
  task_title: 'title',
  allowedPaths: 'allowed_paths',
  paths: 'allowed_paths',
  riskClass: 'risk_class',
  risk: 'risk_class',
  acceptance: 'acceptance_contract',
  acceptanceContract: 'acceptance_contract',
  acceptance_criteria: 'acceptance_contract',
  checks: 'required_checks',
  requiredChecks: 'required_checks',
  requestId: 'request_id',
  baseSha: 'base_sha',
  base: 'base_sha',
  modelPolicy: 'model_policy',
  model: 'model_policy',
  tokenBudgetUsd: 'token_budget_usd',
  token_budget: 'token_budget_usd',
  budgetCents: 'token_budget_usd',
  budget_cents: 'token_budget_usd',
  wallClockMinutes: 'wall_clock_minutes',
  wall_clock_budget: 'wall_clock_minutes',
  wall_clock: 'wall_clock_minutes',
  screenshots: 'qa',
  qa_flows: 'qa',
  evidence: 'qa',
};

export class ContractError extends Error {
  constructor(errors) {
    super(`contract refused: ${errors.length} problem${errors.length === 1 ? '' : 's'}: ${errors.join('; ')}`);
    this.name = 'ContractError';
    this.errors = errors;
  }
}

function typeOf(v) {
  if (v === null) {
    return 'null';
  }
  if (Array.isArray(v)) {
    return 'array';
  }
  if (typeof v === 'number') {
    return Number.isInteger(v) ? 'integer' : 'number';
  }
  return typeof v;
}
function matchesType(v, t) {
  const actual = typeOf(v);
  if (t === 'number') {
    return actual === 'number' || actual === 'integer';
  }
  return actual === t;
}
function show(v) {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

// Walks the schema keywords this repo's schema uses. Every finding is one plain sentence naming the key.
function check(node, value, where, errors) {
  if (node.anyOf) {
    // The first alternative the value matches wins; none matching reports the closest one's problems.
    const tries = node.anyOf.map((alt) => {
      const e = []; check(alt, value, where, e); return e;
    });
    if (tries.some(e => e.length === 0)) {
      return;
    }
    const typed = node.anyOf.findIndex(alt => !alt.type || matchesType(value, alt.type));
    errors.push(...tries[typed >= 0 ? typed : 0]);
    return;
  }
  if (node.type && !matchesType(value, node.type)) {
    errors.push(`${where} must be ${node.type === 'array' ? 'an array' : node.type === 'object' ? 'an object' : `a ${node.type}`}, got ${typeOf(value)} ${show(value)}`);
    return;
  }
  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${where} must be one of ${node.enum.join(', ')}; got ${show(value)}`);
    return;
  }
  if (typeof value === 'string') {
    if (node.minLength != null && value.length < node.minLength) {
      errors.push(`${where} must not be empty`);
    }
    if (node.maxLength != null && value.length > node.maxLength) {
      errors.push(`${where} must be at most ${node.maxLength} characters`);
    }
    if (node.pattern && !new RegExp(node.pattern).test(value)) {
      errors.push(`${where} does not match ${node.pattern}; got ${show(value)}`);
    }
  }
  if (typeof value === 'number') {
    if (node.minimum != null && value < node.minimum) {
      errors.push(`${where} must be at least ${node.minimum}; got ${value}`);
    }
    if (node.exclusiveMinimum != null && value <= node.exclusiveMinimum) {
      errors.push(`${where} must be greater than ${node.exclusiveMinimum}; got ${value}`);
    }
    if (node.maximum != null && value > node.maximum) {
      errors.push(`${where} must be at most ${node.maximum}; got ${value}`);
    }
  }
  if (Array.isArray(value)) {
    if (node.minItems != null && value.length < node.minItems) {
      errors.push(`${where} must have at least ${node.minItems} item${node.minItems === 1 ? '' : 's'}; got ${value.length}`);
    }
    if (node.items) {
      value.forEach((item, i) => check(node.items, item, `${where}[${i}]`, errors));
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = node.properties || {};
    for (const k of node.required || []) {
      if (!(k in value)) {
        errors.push(`${where === 'contract' ? '' : `${where}.`}${k} is required`);
      }
    }
    for (const [k, v] of Object.entries(value)) {
      const label = where === 'contract' ? k : `${where}.${k}`;
      if (k in props) {
        check(props[k], v, label, errors); continue;
      }
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        check(node.additionalProperties, v, label, errors); continue;
      }
      if (node.additionalProperties === false) {
        if (/[A-Z]/.test(k)) {
          errors.push(`${label} is camelCase; the contract uses snake_case${ALIASES[k] ? ` (write ${ALIASES[k]})` : ''}`);
        } else {
          errors.push(`${label} is not a contract field${ALIASES[k] ? ` (write ${ALIASES[k]})` : ''}`);
        }
      }
    }
  }
}

// Two QA rules JSON Schema cannot state, both of them refusals a person can act on.
//
// 1. A `ui` or `marketing` task must carry a `qa` block with at least one flow. Every feature that
//    changes something a person looks at carries before and after screenshots; a task that would
//    ship one without them is refused here, before the repo is cloned, naming what is missing.
// 2. A step names exactly one verb. `{}` says nothing and `{ click: ..., shoot: ... }` hides an
//    order the worker would have to guess.
function qaRules(raw, errors) {
  const qa = raw.qa;
  if (QA_REQUIRED_RISK_CLASSES.includes(raw.risk_class) && (qa === undefined || qa === null)) {
    errors.push(`qa is required when risk_class is ${raw.risk_class}: add qa.flows with at least one { name, path } so the worker can capture before and after screenshots (viewports default to ["desktop"], video defaults to false)`);
    return;
  }
  if (!qa || typeof qa !== 'object' || Array.isArray(qa)) {
    return;
  }
  if (QA_REQUIRED_RISK_CLASSES.includes(raw.risk_class) && !(Array.isArray(qa.flows) && qa.flows.length)) {
    errors.push(`qa.flows is required when risk_class is ${raw.risk_class} and must name at least one flow`);
  }
  if (!Array.isArray(qa.flows)) {
    return;
  }
  qa.flows.forEach((flow, i) => {
    if (!flow || typeof flow !== 'object' || !Array.isArray(flow.steps)) {
      return;
    }
    flow.steps.forEach((step, j) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) {
        return;
      }
      const verbs = Object.keys(step).filter(k => QA_STEP_VERBS.includes(k));
      const where = `qa.flows[${i}].steps[${j}]`;
      if (verbs.length === 0 && Object.keys(step).length === 0) {
        errors.push(`${where} is empty; a step names exactly one of ${QA_STEP_VERBS.join(', ')}`);
      }
      if (verbs.length > 1) {
        errors.push(`${where} names ${verbs.length} verbs (${verbs.join(', ')}); a step names exactly one, so write one step per action`);
      }
    });
  });
}

/**
 * A required check the runner can run: a built-in, or one the contract's `checks` gives a command.
 * A name with neither is refused with what to add, rather than skipped at verify.
 */
function checkRules(raw, errors) {
  const required = Array.isArray(raw.required_checks) ? raw.required_checks : [];
  const commands = new Set((Array.isArray(raw.checks) ? raw.checks : []).map(c => c?.name).filter(Boolean));
  for (const name of required) {
    if (typeof name !== 'string' || BUILTIN_CHECKS.includes(name) || commands.has(name)) {
      continue;
    }
    errors.push(`required_checks names ${name}, which is not one of ${BUILTIN_CHECKS.join(', ')} and has no command in checks: add { "name": "${name}", "command": "..." } to checks (the repo record's checks carry it)`);
  }
}

/**
 * Returns { ok, errors }. Never throws on a bad contract; throws only if the input is not an object
 * at all. `context` is passed straight to the plan rule (factory/worker/plan.mjs): it carries what a
 * single contract cannot know about itself, such as how many tasks sit under the request. Absent, the
 * triggers that need it do not fire rather than being guessed at.
 */
export function validateContract(raw, context = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [`contract must be a JSON object, got ${typeOf(raw)}`] };
  }
  check(schema, raw, 'contract', errors);
  checkRules(raw, errors);
  qaRules(raw, errors);
  planRules(raw, errors, context);
  return { ok: errors.length === 0, errors };
}

/**
 * The qa block with its nested defaults filled: surface, video, and per flow the viewports, the
 * sign_in flag, the before source and an empty step list. Returns null when the contract has none,
 * so the worker's capture pass is a no-op for a task that asks for no evidence.
 */
/**
 * The directory, relative to the repo root, where the repo's own tests save QA screenshots —
 * `qa.shots_dir` when the contract names one, else the schema default (`qa-shots`). Read from the
 * raw contract, not the normalized qa block, so it resolves even for a task with no `qa.flows`
 * (a repo test can still prove a line with no worker-shot flow defined).
 */
export function shotsDirFor(qa) {
  return (qa && typeof qa.shots_dir === 'string' && qa.shots_dir.trim()) || schema.properties.qa.properties.shots_dir.default;
}

export function normalizeQa(qa) {
  if (!qa || typeof qa !== 'object' || !Array.isArray(qa.flows)) {
    return null;
  }
  const f = schema.properties.qa.properties.flows.items.properties;
  return {
    surface: qa.surface || 'app',
    surfaces: qa.surfaces && typeof qa.surfaces === 'object' ? structuredClone(qa.surfaces) : {},
    before_url: qa.before_url || '',
    video: qa.video ?? schema.properties.qa.properties.video.default,
    shots_dir: qa.shots_dir || schema.properties.qa.properties.shots_dir.default,
    flows: qa.flows.map(flow => ({
      name: flow.name,
      path: flow.path,
      viewports: flow.viewports?.length ? [...flow.viewports] : [...f.viewports.default],
      sign_in: flow.sign_in ?? f.sign_in.default,
      before: flow.before ?? f.before.default,
      steps: Array.isArray(flow.steps) ? structuredClone(flow.steps) : [],
    })),
  };
}

/**
 * Validates, then fills the optional fields. `defaults` may carry the worker's own limits
 * (token_budget_usd, wall_clock_minutes) so the log says where a value came from.
 * Returns { task, applied } where applied lists "key=value (source)" for every default used.
 * Throws ContractError with every problem when the contract is refused.
 */
export function normalizeContract(raw, defaults = {}, context = {}) {
  const { ok, errors } = validateContract(raw, context);
  if (!ok) {
    throw new ContractError(errors);
  }
  const task = structuredClone(raw);
  const applied = [];
  for (const key of OPTIONAL_KEYS) {
    if (key in task) {
      continue;
    }
    if (key in defaults && defaults[key] !== undefined) {
      task[key] = structuredClone(defaults[key]);
      applied.push(`${key}=${JSON.stringify(task[key])} (worker)`);
    } else if ('default' in schema.properties[key]) {
      task[key] = structuredClone(schema.properties[key].default);
      applied.push(`${key}=${JSON.stringify(task[key])} (schema)`);
    }
  }
  return { task, applied };
}

/**
 * The engineer's own flows, one per criterion a person can see, merged into the contract's qa.
 *
 * WHY (2026-09-26, request 131): the contract derived one flow, the page path, so the capture took
 * one picture of the page at rest. Six criteria were about states (typing narrows the list, the
 * count reads N of M, a chip filters, the URL keeps state, an empty result offers Clear), and QA
 * rightly proved none of them: one picture cannot show five states. The engineer who built the
 * change knows how to reach each state, so it writes the steps; the worker validates them with the
 * contract's own vocabulary and shoots them. QA still judges every shot against its criterion.
 *
 * `file` is JSON: { "flows": [{ "name", "criterion"?, "path", "steps": [...], "viewports"? }] }.
 * Refused flows are named with the reason and never shot; the contract's own flows always stay. A
 * flow whose criterion names an interaction (INTERACTION_RE) and has no acting step is refused.
 * The engineer can run the same check before it finishes:
 *   node /opt/vocion-runner/src/contract.mjs check-flows /workspace/scratch/qa-flows.json
 * Returns { qa, added, refused }.
 */
export const ENGINEER_FLOW_LIMITS = { flows: 8, steps: 12 };

/**
 * Words that say a criterion is a state a person reaches by doing something: a dialog that opens,
 * a toggle turned on, a row that shows after a send. Prod evidence (2026-09-29, runs 409 and 410): criteria that
 * opened a dialog, turned a toggle on and showed a row after a send were each shot as the page at
 * rest, and QA rightly proved none of them.
 */
export const INTERACTION_RE = /\b(opens? (?:a|an|the)|click(?:s|ed|ing)?|press(?:es|ed)?|tap(?:s|ped)?|toggles?|toggled|switch(?:es|ed)? (?:it )?(?:on|off)|turn(?:s|ed)? (?:it )?(?:on|off)|dialog|modal|popover|drawer|expands?|collapses?|typing|drag(?:s|ged)?|hover(?:s|ed)?|(?:shows?|appears?|updates?) after|after (?:clicking|typing|sending|saving|toggling|turning|choosing|selecting|submitting))\b/i;

/** The verbs that change a page; wait_for and shoot only look at it. */
export const ACTING_VERBS = ['click', 'fill', 'upload', 'offline'];

/**
 * The interaction a flow's criterion names, when it names one: the matched words, or ''.
 * Read from `criterion` when the engineer gave it (the acceptance line as written), else the name.
 */
export function interactionNamed(flow) {
  const text = `${typeof flow?.criterion === 'string' ? flow.criterion : ''} ${typeof flow?.name === 'string' ? flow.name : ''}`;
  const m = INTERACTION_RE.exec(text);
  return m ? m[0] : '';
}

export function mergeEngineerFlows(qa, file) {
  if (!qa) {
    return { qa, added: [], refused: [] };
  }
  let doc;
  try {
    doc = JSON.parse(file);
  } catch (e) {
    return { qa, added: [], refused: [`qa-flows.json is not JSON: ${String(e.message || e).slice(0, 120)}`] };
  }
  const flows = Array.isArray(doc?.flows) ? doc.flows : [];
  const refused = [];
  const added = [];
  const signIn = qa.flows.some(f => f.sign_in);
  const taken = new Set(qa.flows.map(f => f.name));
  for (const [i, flow] of flows.entries()) {
    const where = `flows[${i}]`;
    if (added.length >= ENGINEER_FLOW_LIMITS.flows) {
      refused.push(`${where}: over the limit of ${ENGINEER_FLOW_LIMITS.flows} flows`); continue;
    }
    if (!flow || typeof flow !== 'object') {
      refused.push(`${where}: not an object`); continue;
    }
    const name = typeof flow.name === 'string' ? flow.name.trim().slice(0, 60) : '';
    if (!name || taken.has(name)) {
      refused.push(`${where}: needs a unique name`); continue;
    }
    if (typeof flow.path !== 'string' || !/^\/\S*$/.test(flow.path)) {
      refused.push(`${where} (${name}): path must start with a slash`); continue;
    }
    const steps = Array.isArray(flow.steps) ? flow.steps : [];
    if (steps.length > ENGINEER_FLOW_LIMITS.steps) {
      refused.push(`${where} (${name}): over ${ENGINEER_FLOW_LIMITS.steps} steps`); continue;
    }
    const bad = steps.findIndex(st => !st || typeof st !== 'object' || Array.isArray(st) || Object.keys(st).length !== 1 || !QA_STEP_VERBS.includes(Object.keys(st)[0]));
    if (bad >= 0) {
      refused.push(`${where} (${name}): step ${bad} must name exactly one of ${QA_STEP_VERBS.join(', ')}`); continue;
    }
    // A criterion reached by doing something needs the steps that do it. Without them the shot is
    // the page at rest, which proves nothing about the dialog or the toggle, and QA refuses it.
    const interaction = interactionNamed(flow);
    if (interaction && !steps.some(st => ACTING_VERBS.includes(Object.keys(st)[0]))) {
      refused.push(`${where} (${name}): the criterion names an interaction ("${interaction}") but the flow has no step that acts (${ACTING_VERBS.join(', ')}); a picture of the page at rest cannot show it, so add the steps that reach the state, then shoot`);
      continue;
    }
    const viewports = Array.isArray(flow.viewports) ? flow.viewports.filter(v => v === 'desktop' || v === 'phone') : [];
    const criterion = typeof flow.criterion === 'string' ? flow.criterion.trim().slice(0, 300) : '';
    taken.add(name);
    added.push({ name, path: flow.path, viewports: viewports.length ? viewports : ['desktop'], sign_in: flow.sign_in ?? signIn, before: 'none', steps: structuredClone(steps), ...(criterion ? { criterion } : {}) });
  }
  return { qa: { ...qa, flows: [...qa.flows, ...added] }, added: added.map(f => f.name), refused };
}

/**
 * A criterion no screenshot can show (a query scope, a URL, a plan limit) is proven by a named
 * test (2026-09-27: on #131 QA left four of eight such criteria unproven, because the engineer's
 * report named tests QA never reads). The engineer lists them in criteria-tests.json:
 *   { "tests": [ { "criterion": "...", "file": "apps/api/test/x.test.ts", "name": "keeps a teammate's kept-back document out" } ] }
 * Each is kept only when the file is in the branch and contains the test's name; the suite ran in
 * the checks, so a named test there passed.
 * @param file - The JSON the engineer wrote.
 * @param readRepoFile - (relPath) => contents, or null when the branch has no such file.
 */
export function criterionTests(file, readRepoFile) {
  let doc;
  try {
    doc = JSON.parse(file);
  } catch (e) {
    return { proofs: [], refused: [`criteria-tests.json is not JSON: ${String(e.message || e).slice(0, 120)}`] };
  }
  const proofs = [];
  const refused = [];
  for (const t of (Array.isArray(doc?.tests) ? doc.tests : []).slice(0, 12)) {
    const criterion = String(t?.criterion || '').trim();
    const rel = String(t?.file || '').trim().replace(/^\.\//, '');
    const name = String(t?.name || '').trim();
    if (!criterion || !rel || !name) {
      refused.push(`${criterion || rel || 'an entry'}: needs criterion, file and name`); continue;
    }
    if (rel.startsWith('/') || rel.split('/').includes('..') || !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel)) {
      refused.push(`${rel}: not a test file inside the repo`); continue;
    }
    const content = readRepoFile(rel);
    if (content === null) {
      refused.push(`${rel}: not in the branch`); continue;
    }
    if (!content.includes(name)) {
      refused.push(`${rel}: has no test named "${name.slice(0, 80)}"`); continue;
    }
    proofs.push({ criterion, file: rel, name });
  }
  return { proofs, refused };
}

// `node contract.mjs check-flows <qa-flows.json>`: the engineer's own look at what the worker will
// refuse, run inside the session, so a refusal is fixed before the run ends rather than read in QA.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2] === 'check-flows') {
  const file = process.argv[3];
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (text === null) {
    console.log(`no flows file at ${file || '(none given)'}`); process.exit(1);
  }
  const r = mergeEngineerFlows({ surface: 'app', flows: [] }, text);
  for (const n of r.added) {
    console.log(`ok: ${n}`);
  }
  for (const m of r.refused) {
    console.log(`refused: ${m}`);
  }
  process.exit(r.refused.length ? 1 : 0);
}
