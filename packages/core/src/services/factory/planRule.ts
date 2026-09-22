/**
 * When work needs an architecture plan before it is built.
 *
 * The factory ran ask, triage, contract, approvals, runs, pull request, QA,
 * release, money. There was no design stage anywhere, so the first reviewable
 * thing about a feature was the code. This rule is the gate that sits between
 * triage and the contract: request, triage, plan, approval of the plan,
 * contract, run, pull request, QA, release.
 *
 * Every trigger reads a field the engineering task already carries. Nothing new
 * is asked of the planner except the plan itself.
 *
 * REQUIRED when any of these is true:
 *
 * 1. `riskClass` is auth, billing, schema, infra or promise. Irreversible,
 *    trust bearing, or an externally visible promise.
 * 2. The work spans more than one repository, or declares a cross-repo
 *    dependency.
 * 3. `allowedPaths` spans more than one package or app: an architectural
 *    boundary is being crossed.
 * 4. It adds or changes a public interface: an HTTP route, an object type
 *    schema, a database migration, or a published contract.
 * 5. More than one engineering task sits under the request, or the estimate is
 *    over the threshold. Both thresholds are configuration, not constants.
 *
 * OFFERED AND SKIPPABLE when `riskClass` is ui or logic and the work touches
 * more than one file. Skipping is allowed and must record a reason on the
 * record. An optional step with no recorded skip becomes a step nobody ever
 * takes, and six weeks later nobody can tell whether a plan was considered and
 * declined or simply forgotten.
 *
 * NOT REQUIRED otherwise: docs, marketing, deps, and single-surface ui or logic
 * changes. That is what is left when no trigger fires, not an exemption that
 * outranks them: a docs task that changes a database migration is a mislabelled
 * schema task, and the migration trigger is the one telling the truth.
 *
 * This is the same rule the worker enforces in `factory/worker/plan.mjs` in
 * Meta-CTO/squatch-core, which refuses a contract that needs a plan and carries
 * none before the repo is cloned. The two are kept in step deliberately: the
 * worker refuses, this one explains, and the wording of the triggers is shared
 * so a person reads the same sentence in the report and in the refusal.
 */

/** What the rule is allowed to look at. Every field is optional; a missing one simply does not fire its trigger. */
export type PlanSubject = {
  riskClass?: string | null;
  allowedPaths?: string[] | null;
  dependencies?: string[] | null;
  /** The repository the task lands in, as a slug or a clone URL. */
  repo?: string | null;
  /** Services the run declares, e.g. `postgres`. Named beside a migration, never a trigger alone. */
  services?: string[] | null;
  /** The estimate the planner declared, in dollars. The worker's own budget default is not an estimate. */
  estimateUsd?: number | null;
};

/** What one task cannot know about itself. A part left out does not fire its trigger, and is listed in `unknown`. */
export type PlanContext = {
  /** How many distinct engineering tasks sit under this request. */
  taskCount?: number | null;
  /** Every repository the request's tasks target. */
  repos?: string[] | null;
  thresholds?: Partial<PlanThresholds>;
};

export type PlanThresholds = {
  tasksPerRequest: number;
  estimateUsd: number;
  packageRoots: number;
};

/**
 * Why a plan was required. `recorded` is the one code this file never
 * produces: it is what a plan record's own `ruleTriggers` read back as, so a
 * verdict reached weeks ago keeps its wording instead of being recomputed
 * against whatever the rule says today.
 */
export type PlanTriggerCode = 'risk_class' | 'cross_repo' | 'package_span' | 'public_interface' | 'task_count' | 'estimate' | 'recorded';
export type PlanTrigger = { code: PlanTriggerCode; why: string };
export type PlanLevel = 'required' | 'offered' | 'not_required';

export type PlanDecision = {
  level: PlanLevel;
  /** Every trigger that fired, in the order of the rule. Empty unless the level is `required`. */
  triggers: PlanTrigger[];
  /** Why a plan is offered, when it is. Null otherwise. */
  offered: string | null;
  /** The parts of the rule that could not be checked, rather than guessed at. */
  unknown: string[];
  thresholds: PlanThresholds;
};

export const PLAN_REQUIRED_RISK_CLASSES = ['auth', 'billing', 'schema', 'infra', 'promise'] as const;
export const PLAN_OFFERED_RISK_CLASSES = ['ui', 'logic'] as const;
export const PLAN_EXEMPT_RISK_CLASSES = ['docs', 'marketing', 'deps'] as const;

export const PLAN_DEFAULT_THRESHOLDS: PlanThresholds = {
  tasksPerRequest: 1,
  estimateUsd: 10,
  packageRoots: 1,
};

/** Directories that hold a workspace member, and the ones that hold no architecture at all. */
const WORKSPACE_PARENTS = ['apps', 'packages', 'services', 'plugins'];
const NON_PACKAGE_ROOTS = ['docs', '.github', '.claude', 'scripts'];

const PUBLIC_INTERFACE_PATTERNS: Array<{ what: string; re: RegExp }> = [
  { what: 'an HTTP route', re: /(^|\/)(routes|controllers|handlers)(\/|\.|$)/ },
  { what: 'a database migration', re: /(^|\/)(migrations|prisma)(\/|$)/ },
  { what: 'an object type schema', re: /(^|\/)(object-types|object_types|objectTypes)(\/|$)|(^|\/)objects\/[^/]+\/type\.ya?ml$/ },
  { what: 'a published contract', re: /(^|\/)(contracts?|openapi|schema\.json)(\/|\.|$)|-CONTRACT\.md$|\.proto$/ },
];

/**
 * The package or app a glob belongs to, or null when it names none. Prose is
 * never a package: docs and top level files are not an architectural boundary.
 * @param glob - One entry from `allowedPaths`.
 */
export function packageRoot(glob: string): string | null {
  const clean = String(glob ?? '').replace(/^\.\//, '').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  const first = parts[0];
  if (!first || /[*?[\]]/.test(first)) {
    return null;
  }
  if (first.includes('.') && parts.length === 1) {
    return null;
  }
  if (NON_PACKAGE_ROOTS.includes(first)) {
    return null;
  }
  if (WORKSPACE_PARENTS.includes(first)) {
    const second = parts[1];
    return !second || /[*?[\]]/.test(second) ? null : `${first}/${second}`;
  }
  return first;
}

/**
 * Every distinct package root the paths name, first appearance first.
 * @param allowedPaths - The task's allowed paths.
 */
export function packageRoots(allowedPaths: string[] | null | undefined): string[] {
  const seen: string[] = [];
  for (const glob of allowedPaths ?? []) {
    const root = packageRoot(glob);
    if (root && !seen.includes(root)) {
      seen.push(root);
    }
  }
  return seen;
}

/**
 * Which public interfaces the paths reach, as plain phrases.
 * @param allowedPaths - The task's allowed paths.
 */
export function publicInterfaces(allowedPaths: string[] | null | undefined): string[] {
  const found: string[] = [];
  for (const glob of allowedPaths ?? []) {
    for (const p of PUBLIC_INTERFACE_PATTERNS) {
      if (p.re.test(String(glob ?? '')) && !found.includes(p.what)) {
        found.push(p.what);
      }
    }
  }
  return found;
}

/**
 * More than one allowed path, or one that is a glob or a directory rather than
 * a named file.
 * @param allowedPaths - The task's allowed paths.
 */
export function touchesMoreThanOneFile(allowedPaths: string[] | null | undefined): boolean {
  const paths = allowedPaths ?? [];
  if (paths.length > 1) {
    return true;
  }
  const one = paths[0];
  return one === undefined ? false : /[*?[\]]/.test(one) || one.endsWith('/');
}

/**
 * The last segment of a repository slug or clone URL, so `a/b.git` and `b` are
 * the same repository.
 * @param repo - A slug or a URL.
 */
function repoName(repo: string | null | undefined): string {
  return String(repo ?? '').replace(/\.git$/, '').split('/').filter(Boolean).slice(-1)[0] ?? '';
}

/**
 * A dependency written `<repo>:<task_id>` or `<repo>#<task_id>` names the side
 * it comes from. A bare id is a dependency inside this repository.
 * @param dep - The dependency id.
 */
function dependencyRepo(dep: string): string | null {
  const m = /^([^:#\s]+)[:#].+$/.exec(String(dep ?? ''));
  return m ? (m[1] ?? null) : null;
}

/**
 * The thresholds, with any override applied. Configuration, never a constant at
 * a call site.
 * @param overrides - Partial overrides, from a workspace setting or a caller.
 */
export function planThresholds(overrides: Partial<PlanThresholds> = {}): PlanThresholds {
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);
  return {
    tasksPerRequest: num(overrides.tasksPerRequest, PLAN_DEFAULT_THRESHOLDS.tasksPerRequest),
    estimateUsd: num(overrides.estimateUsd, PLAN_DEFAULT_THRESHOLDS.estimateUsd),
    packageRoots: num(overrides.packageRoots, PLAN_DEFAULT_THRESHOLDS.packageRoots),
  };
}

/**
 * Whether this work needs an architecture plan, and why.
 * @param subject - What the task carries.
 * @param context - What the task cannot know about itself.
 */
export function planRequirement(subject: PlanSubject, context: PlanContext = {}): PlanDecision {
  const thresholds = planThresholds(context.thresholds ?? {});
  const triggers: PlanTrigger[] = [];
  const unknown: string[] = [];
  const add = (code: PlanTriggerCode, why: string) => triggers.push({ code, why });

  const riskClass = subject.riskClass ?? null;
  if (riskClass && (PLAN_REQUIRED_RISK_CLASSES as readonly string[]).includes(riskClass)) {
    add('risk_class', `the risk class is ${riskClass}, which is irreversible, trust bearing or an externally visible promise`);
  }

  const own = repoName(subject.repo);
  if (context.repos === undefined || context.repos === null) {
    unknown.push('which repositories the request touches');
  } else {
    const repos = [...new Set(context.repos.map(repoName).filter(Boolean))];
    if (repos.length > 1) {
      add('cross_repo', `the request spans ${repos.length} repositories (${repos.join(', ')})`);
    }
  }
  const crossDeps = (subject.dependencies ?? []).filter((d) => {
    const from = dependencyRepo(d);
    return from !== null && repoName(from) !== own;
  });
  if (crossDeps.length > 0) {
    add('cross_repo', `${crossDeps.length} dependenc${crossDeps.length === 1 ? 'y comes' : 'ies come'} from another repository (${crossDeps.join(', ')})`);
  }

  const roots = packageRoots(subject.allowedPaths);
  if (roots.length > thresholds.packageRoots) {
    add('package_span', `the allowed paths span ${roots.length} packages (${roots.join(', ')}), so an architectural boundary is being crossed`);
  }

  const interfaces = publicInterfaces(subject.allowedPaths);
  if (interfaces.length > 0) {
    const withDb = interfaces.includes('a database migration') && (subject.services ?? []).includes('postgres')
      ? ', with a postgres service declared'
      : '';
    add('public_interface', `the allowed paths reach ${interfaces.join(' and ')}${withDb}`);
  }

  if (typeof context.taskCount === 'number') {
    if (context.taskCount > thresholds.tasksPerRequest) {
      add('task_count', `${context.taskCount} engineering tasks sit under this request, over the ${thresholds.tasksPerRequest} the rule allows without a plan`);
    }
  } else {
    unknown.push('how many tasks sit under this request');
  }
  const estimate = typeof subject.estimateUsd === 'number' ? subject.estimateUsd : null;
  if (estimate === null) {
    unknown.push('what the work was estimated at');
  } else if (estimate > thresholds.estimateUsd) {
    add('estimate', `the estimate is $${estimate}, over the $${thresholds.estimateUsd} threshold`);
  }

  if (triggers.length > 0) {
    return { level: 'required', triggers, offered: null, unknown, thresholds };
  }
  if (riskClass && (PLAN_OFFERED_RISK_CLASSES as readonly string[]).includes(riskClass) && touchesMoreThanOneFile(subject.allowedPaths)) {
    return {
      level: 'offered',
      triggers: [],
      offered: `the risk class is ${riskClass} and the work touches more than one file`,
      unknown,
      thresholds,
    };
  }
  return { level: 'not_required', triggers: [], offered: null, unknown, thresholds };
}

/**
 * The rule read off an `engineering_task` record's metadata, which spells the
 * contract's fields in camelCase.
 * @param meta - The task's metadata bag.
 * @param context - What the task cannot know about itself.
 */
export function planRequirementForTask(meta: Record<string, unknown>, context: PlanContext = {}): PlanDecision {
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const contract = (meta.contract && typeof meta.contract === 'object' ? meta.contract : {}) as Record<string, unknown>;
  const environment = (contract.environment && typeof contract.environment === 'object' ? contract.environment : {}) as Record<string, unknown>;
  const estimateCents = typeof meta.estimateCents === 'number' ? meta.estimateCents : null;
  const budget = typeof contract.token_budget_usd === 'number' ? contract.token_budget_usd : null;
  return planRequirement({
    riskClass: typeof meta.riskClass === 'string' ? meta.riskClass : null,
    allowedPaths: strings(meta.allowedPaths).length > 0 ? strings(meta.allowedPaths) : strings(contract.allowed_paths),
    dependencies: strings(meta.dependencies).length > 0 ? strings(meta.dependencies) : strings(contract.dependencies),
    repo: typeof meta.repoSlug === 'string' ? meta.repoSlug : typeof meta.repo === 'string' ? meta.repo : null,
    services: strings(environment.services),
    estimateUsd: budget ?? (estimateCents === null ? null : estimateCents / 100),
  }, context);
}

/** What a task records about the plan it was built against. */
export type PlanRecord = {
  /** The `architecture_plan` record, when one was written. */
  planId?: string | number | null;
  url?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  skipped?: boolean | null;
  skipReason?: string | null;
};

/**
 * The plan block off a task's metadata, in either spelling, or null when the
 * task says nothing about a plan at all. Nothing is inferred from silence: a
 * task with no plan block is a task that recorded no plan decision, which is a
 * different thing from a task that recorded a skip.
 * @param meta - The task's metadata bag.
 */
export function planRecordFromTask(meta: Record<string, unknown>): PlanRecord | null {
  const raw = (meta.plan && typeof meta.plan === 'object' && !Array.isArray(meta.plan) ? meta.plan : null) as Record<string, unknown> | null;
  if (!raw) {
    return null;
  }
  const s = (k: string, alt: string) => {
    const v = raw[k] ?? raw[alt];
    return typeof v === 'string' ? (v.trim() || null) : typeof v === 'number' ? String(v) : null;
  };
  return {
    planId: s('planId', 'plan_id'),
    url: s('url', 'href'),
    approvedBy: s('approvedBy', 'approved_by'),
    approvedAt: s('approvedAt', 'approved_at'),
    skipped: raw.skipped === true,
    skipReason: s('skipReason', 'skip_reason'),
  };
}
