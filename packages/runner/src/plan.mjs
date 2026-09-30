// When a task needs an architecture plan before the worker runs, and what counts as one.
//
// The plan is a gate, not an attachment. It sits between triage and the contract: request, triage,
// PLAN, approval of the plan, contract, run, pull request, QA, release. A contract that needs a plan
// and does not carry an approved one is refused at prepare, before the repo is cloned and before any
// model is called, the same way a camelCase key or a missing qa block is refused.
//
// Every trigger is read from fields the contract already carries: risk_class, allowed_paths,
// dependencies, environment, repo. Nothing new is asked of the planner except the plan itself.
//
// The rule, in one place so the factory page, the review queue and the worker all say the same thing:
//
//   REQUIRED when any of these is true
//     1. risk_class is auth, billing, schema, infra or promise. Irreversible, trust bearing, or an
//        externally visible promise.
//     2. The work spans more than one repository, or declares a cross-repo dependency.
//     3. allowed_paths spans more than one package or app. An architectural boundary is crossed.
//     4. It adds or changes a public interface: an HTTP route, an object type schema, a database
//        migration, or a published contract.
//     5. More than one engineering task sits under the same request, or the estimate exceeds the
//        threshold. Both thresholds are configurable; neither is hardcoded into the test.
//
//   OFFERED AND SKIPPABLE when risk_class is ui or logic and the work touches more than one file.
//     Skipping is allowed and must record a reason. An optional step with no recorded skip becomes a
//     step nobody ever takes, and six weeks later nobody can tell whether a plan was considered and
//     declined or simply forgotten.
//
//   NOT REQUIRED otherwise: docs, marketing, deps, and single-surface ui or logic changes.
//
// The required triggers are unconditional. The last line describes what is left when none of them
// fires, not an exemption that outranks them: a docs task that changes a database migration is a
// mislabelled schema task, and the migration trigger is the one telling the truth.

const DEFAULT_THRESHOLDS = {
  // More than this many distinct engineering tasks under one request requires a plan.
  tasks_per_request: 1,
  // A declared estimate above this many dollars requires a plan. Only an estimate the contract
  // states counts; the worker's own budget default is not an estimate of the work.
  estimate_usd: 10,
  // More than this many package roots in allowed_paths requires a plan.
  package_roots: 1,
};

export const PLAN_LEVELS = ['required', 'offered', 'not_required'];
export const PLAN_REQUIRED_RISK_CLASSES = ['auth', 'billing', 'schema', 'infra', 'promise'];
export const PLAN_OFFERED_RISK_CLASSES = ['ui', 'logic'];
export const PLAN_EXEMPT_RISK_CLASSES = ['docs', 'marketing', 'deps'];

/** The thresholds, with any set in the environment overriding the defaults. Never hardcoded at a call site. */
export function planThresholds(env = process.env, overrides = {}) {
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    tasks_per_request: num(overrides.tasks_per_request ?? env.RUNNER_PLAN_TASKS_PER_REQUEST, DEFAULT_THRESHOLDS.tasks_per_request),
    estimate_usd: num(overrides.estimate_usd ?? env.RUNNER_PLAN_ESTIMATE_USD, DEFAULT_THRESHOLDS.estimate_usd),
    package_roots: num(overrides.package_roots ?? env.RUNNER_PLAN_PACKAGE_ROOTS, DEFAULT_THRESHOLDS.package_roots),
  };
}

export { DEFAULT_THRESHOLDS as PLAN_DEFAULT_THRESHOLDS };

// Directories that hold a workspace member. apps/web and packages/core are package roots;
// factory and infra are their own areas. Prose is not an architectural boundary, so docs and the
// repo's own top level markdown never count towards the span.
const WORKSPACE_PARENTS = ['apps', 'packages', 'services', 'plugins'];
const NON_PACKAGE_ROOTS = ['docs', '.github', '.claude', 'scripts'];

/** The package or app a glob belongs to, or null when the glob names no package. */
export function packageRoot(glob) {
  const clean = String(glob || '').replace(/^\.\//, '').replace(/^\/+/, '');
  if (!clean) {
    return null;
  }
  const parts = clean.split('/').filter(Boolean);
  const first = parts[0];
  if (!first || /[*?[\]]/.test(first)) {
    return null;
  }
  if (first.includes('.') && parts.length === 1) {
    return null;
  } // a single top level file
  if (NON_PACKAGE_ROOTS.includes(first)) {
    return null;
  }
  if (WORKSPACE_PARENTS.includes(first)) {
    const second = parts[1];
    if (!second || /[*?[\]]/.test(second)) {
      return null;
    }
    return `${first}/${second}`;
  }
  return first;
}

/** Every distinct package root allowed_paths names, in the order they first appear. */
export function packageRoots(allowedPaths) {
  const seen = [];
  for (const glob of allowedPaths || []) {
    const root = packageRoot(glob);
    if (root && !seen.includes(root)) {
      seen.push(root);
    }
  }
  return seen;
}

// A public interface is anything outside the change that other code, other people or another system
// already depends on. Each pattern names what it found so the refusal can be read without the regex.
const PUBLIC_INTERFACE_PATTERNS = [
  { what: 'an HTTP route', re: /(^|\/)(routes|controllers|handlers)(\/|\.|$)/ },
  { what: 'a database migration', re: /(^|\/)(migrations|prisma)(\/|$)/ },
  // A Vocion object type is objects/<slug>/type.yaml in a workspace or a plugin; other codebases
  // spell the directory out.
  { what: 'an object type schema', re: /(^|\/)(object-types|object_types|objectTypes)(\/|$)|(^|\/)objects\/[^/]+\/type\.ya?ml$/ },
  { what: 'a published contract', re: /(^|\/)(contracts?|openapi|schema\.json)(\/|\.|$)|-CONTRACT\.md$|\.proto$/ },
];

/** What public interfaces allowed_paths reaches, as plain phrases. Empty when it reaches none. */
export function publicInterfaces(allowedPaths) {
  const found = [];
  for (const glob of allowedPaths || []) {
    const clean = String(glob || '');
    for (const p of PUBLIC_INTERFACE_PATTERNS) {
      if (p.re.test(clean) && !found.includes(p.what)) {
        found.push(p.what);
      }
    }
  }
  return found;
}

// A dependency written as `<repo or product>:<task_id>` or `<repo or product>#<task_id>` names the
// side it comes from. A bare task id is read as a dependency inside this repo.
function dependencyRepo(dep) {
  const m = /^([^:#\s]+)[:#].+$/.exec(String(dep || ''));
  return m ? m[1] : null;
}

function repoName(repo) {
  return String(repo || '').replace(/\.git$/, '').split('/').filter(Boolean).slice(-1)[0] || '';
}

/**
 * Whether this contract needs an architecture plan.
 *
 * `context` carries what a single contract cannot know about itself, and every part of it is
 * optional. When it is absent the trigger that depends on it simply does not fire, and the result
 * says so in `unknown` rather than guessing:
 *   - `task_count`: how many distinct engineering tasks sit under this request.
 *   - `repos`: every repository the request's tasks target.
 *   - `thresholds`: overrides for the configured thresholds.
 *   - `env`: the environment the thresholds are read from.
 *
 * Returns { level, triggers, offered, unknown, thresholds }. `triggers` is a list of
 * { code, why } in the order of the rule, so a page can list them and a refusal can name them.
 */
export function planRequirement(contract, context = {}) {
  const c = contract && typeof contract === 'object' ? contract : {};
  const thresholds = planThresholds(context.env || process.env, context.thresholds || {});
  const triggers = [];
  const unknown = [];
  const add = (code, why) => triggers.push({ code, why });

  // 1. The risk class itself.
  if (PLAN_REQUIRED_RISK_CLASSES.includes(c.risk_class)) {
    add('risk_class', `risk_class is ${c.risk_class}, which is irreversible, trust bearing or an externally visible promise`);
  }

  // 2. More than one repository, or a cross-repo dependency.
  const own = repoName(c.repo);
  const requestRepos = Array.isArray(context.repos) ? [...new Set(context.repos.map(repoName).filter(Boolean))] : null;
  if (requestRepos === null) {
    unknown.push('repos');
  } else if (requestRepos.length > 1) {
    add('cross_repo', `the request spans ${requestRepos.length} repositories (${requestRepos.join(', ')})`);
  }
  const crossDeps = (Array.isArray(c.dependencies) ? c.dependencies : [])
    .filter((d) => {
      const from = dependencyRepo(d);
      return from && repoName(from) !== own;
    });
  if (crossDeps.length) {
    add('cross_repo', `${crossDeps.length} dependenc${crossDeps.length === 1 ? 'y comes' : 'ies come'} from another repository (${crossDeps.join(', ')})`);
  }

  // 3. An architectural boundary is crossed.
  const roots = packageRoots(c.allowed_paths);
  if (roots.length > thresholds.package_roots) {
    add('package_span', `allowed_paths spans ${roots.length} packages (${roots.join(', ')}), over the ${thresholds.package_roots} the rule allows without a plan`);
  }

  // 4. A public interface is added or changed. A declared postgres service is named beside a
  //    migration because it says the run reaches a live database, not only the files.
  const interfaces = publicInterfaces(c.allowed_paths);
  if (interfaces.length) {
    const services = (c.environment?.services || []).map(x => (typeof x === 'string' ? x : x?.name));
    const withDb = interfaces.includes('a database migration') && services.includes('postgres') ? ', with a postgres service declared' : '';
    add('public_interface', `allowed_paths reaches ${interfaces.join(' and ')}${withDb}`);
  }

  // 5. More than one task under the request, or an estimate over the threshold.
  if (typeof context.task_count === 'number') {
    if (context.task_count > thresholds.tasks_per_request) {
      add('task_count', `${context.task_count} engineering tasks sit under this request, over the ${thresholds.tasks_per_request} the rule allows without a plan`);
    }
  } else {
    unknown.push('task_count');
  }
  const estimate = typeof c.token_budget_usd === 'number' ? c.token_budget_usd : null;
  if (estimate === null) {
    unknown.push('estimate');
  } else if (estimate > thresholds.estimate_usd) {
    add('estimate', `the estimate is $${estimate}, over the $${thresholds.estimate_usd} threshold`);
  }

  if (triggers.length) {
    return { level: 'required', triggers, offered: null, unknown, thresholds };
  }

  // Offered and skippable: a ui or logic change that touches more than one file.
  if (PLAN_OFFERED_RISK_CLASSES.includes(c.risk_class) && touchesMoreThanOneFile(c.allowed_paths)) {
    return {
      level: 'offered',
      triggers: [],
      offered: `risk_class is ${c.risk_class} and the work may touch more than one file`,
      unknown,
      thresholds,
    };
  }
  return { level: 'not_required', triggers: [], offered: null, unknown, thresholds };
}

/** More than one allowed path, or one path that is a directory or a glob rather than a single file. */
export function touchesMoreThanOneFile(allowedPaths) {
  const paths = Array.isArray(allowedPaths) ? allowedPaths : [];
  if (paths.length > 1) {
    return true;
  }
  if (paths.length === 0) {
    return false;
  }
  const one = String(paths[0]);
  return /[*?[\]]/.test(one) || one.endsWith('/');
}

/** Whether a plan block says a plan exists at all, as opposed to saying one was skipped. */
export function planIsPresent(plan) {
  return Boolean(plan && typeof plan === 'object' && !Array.isArray(plan) && plan.skipped !== true && (plan.plan_id || plan.url));
}

/** Whether a plan block records a deliberate skip with a reason. */
export function planIsSkipped(plan) {
  return Boolean(plan && typeof plan === 'object' && !Array.isArray(plan) && plan.skipped === true);
}

/**
 * The refusals a required plan implies, as plain sentences. Pushed onto the same error list the rest
 * of the contract uses, so one refusal names everything wrong at once.
 */
export function planRules(raw, errors, context = {}) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const plan = c.plan;
  const decision = planRequirement(c, context);
  const named = decision.triggers.map(t => t.why).join('; ');

  if (decision.level === 'required') {
    if (plan === undefined || plan === null) {
      errors.push(`plan is required: ${named}. Write the plan, have it approved in Review, and put plan.plan_id (or plan.url) and plan.approved_by on the contract. A required plan cannot be skipped.`);
      return;
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      return;
    } // the schema walk already said so
    if (plan.skipped === true) {
      errors.push(`plan.skipped is true but a plan is required: ${named}. Skipping is only open to a ui or logic change that no required trigger reaches.`);
    }
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return;
  }

  // These two hold at every level. A skip with no reason is the failure mode the rule exists to stop,
  // and a plan on a contract is an approved plan or it is not a gate.
  if (plan.skipped === true && !plan.skip_reason) {
    errors.push('plan.skipped is true with no plan.skip_reason: record why the plan was declined, so a reader six weeks from now can tell a considered skip from a forgotten one');
  }
  if (plan.skipped !== true) {
    if (!plan.plan_id && !plan.url) {
      errors.push('plan names neither plan_id nor url: a plan block says which plan was reviewed, or sets skipped with a reason');
    }
    if (!plan.approved_by) {
      errors.push('plan.approved_by is missing: a plan reaches the contract only after a person approves it in Review');
    }
  }
}
