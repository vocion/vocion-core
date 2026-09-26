/**
 * factory.dispatch_task — start the build.
 *
 * THE MISSING STEP (red team, 2026-09-26). The factory could write a request,
 * a plan and a contract, and put an "Approve build" card in front of a person,
 * and then nothing could start the work: every worker run the factory had ever
 * made was POSTed by hand to `/api/v1/worker-runs` with a token. The card had
 * no action behind it ("This recommendation named no action, so there is
 * nothing to approve"), so the one decision the whole page leads to was a
 * button that did nothing.
 *
 * One action, one decision: approving it approves the plan (when one is
 * named), turns the engineering_task record into the worker's contract, and
 * queues the run for the engineer seat that runs on the external worker.
 * Undo cancels a run no worker has claimed yet and puts the task and the plan
 * back — once a worker holds it, Stop on the run is the way out.
 */

import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';

export const DISPATCH_ACTION_ID = 'factory.dispatch_task';

/**
 * THE CONTRACT, carried on the card. On 2026-09-26 the PM said "I've written
 * the contract" and put a dispatch card up; no task existed — the write it
 * narrated never happened. When the card carries the contract itself, the
 * approval creates the task and starts it in one move, so there is no second
 * step to narrate and skip.
 */
const listish = z.union([z.array(z.string()), z.string()]).transform(v => (Array.isArray(v) ? v : v.split(/[,\n]/)).map(x => x.trim()).filter(Boolean));
const inlineContract = z.object({
  title: z.string().optional(),
  objective: z.string().optional(),
  acceptanceContract: listish.optional(),
  allowedPaths: listish.optional(),
  requiredChecks: listish.optional(),
  riskClass: z.string().optional(),
  repoSlug: z.string().optional(),
  baseSha: z.string().optional(),
  taskId: z.string().optional().describe('A readable id for the worker, e.g. send-0012.'),
  tokenBudget: z.coerce.number().positive().optional(),
  wallClockBudget: z.coerce.number().positive().optional(),
}).partial();

const dispatchInput = z.object({
  /** The engineering_task record whose contract the worker runs — or omit it and carry `contract`. */
  taskId: z.coerce.number().int().positive().optional(),
  /** The request the work answers; required with an inline `contract`. */
  requestId: z.coerce.number().int().positive().optional(),
  /** The contract itself, when no engineering_task record exists yet: approving creates it. */
  contract: inlineContract.optional(),
  /** The architecture_plan it was approved against, when the work needs one. */
  planId: z.coerce.number().int().positive().optional(),
  /** Why now, in a sentence a person can check. */
  reason: z.string().min(1).max(500).optional().default('Approved to build.'),
}).refine(v => v.taskId !== undefined || v.requestId !== undefined, { message: 'Name the engineering task (taskId), or the request (requestId) — the contract is filled from the request, its plan and the repo.' });

type Meta = Record<string, unknown>;
type Rec = { id: number; title: string; typeId: number; meta: Meta };

async function readRecord(orgId: string, id: number): Promise<(Rec & { typeSlug: string }) | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, typeId: businessObjectSchema.typeId, meta: businessObjectSchema.metadata, typeSlug: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return row ? { ...row, meta: (row.meta ?? {}) as Meta } : null;
}

async function writeMeta(orgId: string, id: number, set: Meta): Promise<void> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db
    .update(businessObjectSchema)
    .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

/**
 * The engineer seat: the workspace's agent that runs on the external worker.
 * @param orgId
 * @param preferred
 */
async function engineerSlug(orgId: string, preferred: unknown): Promise<string | null> {
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const { normalizeHarnessTarget } = await import('@/services/agents/harnessTarget');
  const rows = await db.select({ slug: agentSchema.slug, harness: agentSchema.harnessConfig, active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.orgId, orgId));
  const workers = rows.filter(r => r.active !== 'false' && normalizeHarnessTarget(((r.harness ?? {}) as { runsOn?: string; provider?: string }).runsOn ?? ((r.harness ?? {}) as { provider?: string }).provider) === 'external-worker').map(r => r.slug);
  if (typeof preferred === 'string' && workers.includes(preferred)) {
    return preferred;
  }
  return workers[0] ?? null;
}

const str = (m: Meta, k: string): string | null => (typeof m[k] === 'string' && (m[k] as string).trim() !== '' ? (m[k] as string).trim() : null);
const list = (m: Meta, k: string): string[] => (Array.isArray(m[k])
  ? (m[k] as unknown[]).map(v => (typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as Meta).statement === 'string' ? (v as Meta).statement as string : ''))).filter(Boolean)
  : []);

/**
 * What the contract is missing, in the words the worker would refuse it with.
 * @param meta
 */
export function contractGaps(meta: Meta): string[] {
  const gaps: string[] = [];
  if (!str(meta, 'objective')) {
    gaps.push('objective');
  }
  if (list(meta, 'acceptanceContract').length === 0) {
    gaps.push('acceptanceContract');
  }
  if (list(meta, 'allowedPaths').length === 0) {
    gaps.push('allowedPaths');
  }
  if (list(meta, 'requiredChecks').length === 0) {
    gaps.push('requiredChecks');
  }
  if (!str(meta, 'riskClass')) {
    gaps.push('riskClass');
  }
  if (!str(meta, 'repo') && !str(meta, 'repoSlug')) {
    gaps.push('repo');
  }
  return gaps;
}

/**
 * The engineering_task record as the worker's contract (snake_case, the
 * squatch factory schema). Pure, so the mapping is tested without a database.
 * @param task
 * @param task.id
 * @param task.title
 * @param task.meta
 * @param opts
 * @param opts.product
 * @param opts.plan
 * @param opts.plan.id
 * @param opts.plan.approach
 * @param opts.plan.approvedBy
 * @param opts.plan.approvedAt
 */
export function contractFromTask(task: { id: number; title: string; meta: Meta }, opts: { product: string | null; plan?: { id: number; approach: string | null; approvedBy: string; approvedAt: string } }): Record<string, unknown> {
  const m = task.meta;
  const repoSlug = str(m, 'repoSlug');
  const repo = str(m, 'repo') ?? (repoSlug ? `https://github.com/${repoSlug}.git` : null);
  const product = str(m, 'productSlug') ?? opts.product ?? 'product';
  const out: Record<string, unknown> = {
    task_id: str(m, 'taskId') ?? `${product}-t${task.id}`,
    product,
    repo,
    base_sha: str(m, 'baseSha') ?? 'origin/main',
    objective: str(m, 'objective'),
    title: task.title,
    acceptance_contract: list(m, 'acceptanceContract'),
    allowed_paths: list(m, 'allowedPaths'),
    risk_class: str(m, 'riskClass'),
    required_checks: list(m, 'requiredChecks'),
    attempt: typeof m.attempt === 'number' ? m.attempt : 1,
  };
  if (m.requestId !== undefined && m.requestId !== null) {
    out.request_id = String(m.requestId);
  }
  if (Array.isArray(m.dependencies)) {
    out.dependencies = m.dependencies;
  }
  if (m.modelPolicy && typeof m.modelPolicy === 'object') {
    out.model_policy = m.modelPolicy;
  }
  if (m.environment && typeof m.environment === 'object') {
    out.environment = m.environment;
  }
  if (m.qa && typeof m.qa === 'object') {
    out.qa = m.qa;
  }
  if (typeof m.tokenBudget === 'number') {
    out.token_budget_usd = m.tokenBudget;
  }
  if (typeof m.wallClockBudget === 'number') {
    out.wall_clock_minutes = m.wallClockBudget;
  }
  if (opts.plan) {
    out.plan = {
      plan_id: String(opts.plan.id),
      approved_by: opts.plan.approvedBy,
      approved_at: opts.plan.approvedAt,
      ...(opts.plan.approach ? { summary: opts.plan.approach.slice(0, 2000) } : {}),
    };
  } else if (m.plan && typeof m.plan === 'object') {
    out.plan = m.plan;
  }
  return out;
}

const WORKER_RISK = ['schema', 'billing', 'auth', 'logic', 'ui', 'deps', 'marketing', 'docs'] as const;

/**
 * A plan component's leading path: "apps/send-web — …" → apps/send-web/**, a file stays a file.
 * @param components
 */
export function pathsFromComponents(components: string[]): string[] {
  const out = new Set<string>();
  for (const c of components) {
    const head = c.split(/\s+[\u2014-]\s+|\s\(/)[0]?.trim() ?? '';
    if (!/^[\w.@-]+\/[\w./@*-]+$/.test(head)) {
      continue;
    }
    out.add(/\.[a-z0-9]+$/i.test(head) || head.endsWith('*') ? head : `${head.replace(/\/$/, '')}/**`);
  }
  return [...out];
}

/**
 * The riskiest class the repo's defaults assign to any of the paths.
 * @param paths
 * @param defaults
 */
export function riskFromPaths(paths: string[], defaults: Record<string, string>): string | null {
  const hits = paths.flatMap(p => Object.entries(defaults).filter(([glob]) => p.startsWith(glob.replace(/\*+$/, '').replace(/\/$/, ''))).map(([, risk]) => risk));
  return WORKER_RISK.find(r => hits.includes(r)) ?? null;
}

/**
 * THE CONTRACT FROM THE RECORDS. A card needs only the request (and its plan):
 * the objective and acceptance come from the request, the repo and paths from
 * the plan, the checks and the risk from the repo record. Whatever the card
 * did carry wins. Pure, so it is tested without a database.
 * @param input
 * @param input.given
 * @param input.request
 * @param input.plan
 * @param input.repo
 */
export function deriveContract(input: { given: Meta; request: Meta & { title?: string } | null; plan: Meta | null; repo: Meta | null }): Meta {
  const g = input.given;
  const r = input.request ?? {};
  const p = input.plan ?? {};
  const repo = input.repo ?? {};
  const acceptance = list(g, 'acceptanceContract').length > 0 ? list(g, 'acceptanceContract') : list(r, 'acceptance');
  const paths = list(g, 'allowedPaths').length > 0 ? list(g, 'allowedPaths') : pathsFromComponents(list(p, 'components'));
  const checks = list(g, 'requiredChecks').length > 0
    ? list(g, 'requiredChecks')
    : (Array.isArray(repo.checks) ? (repo.checks as Array<{ name?: string }>).map(c => c.name ?? '').filter(Boolean) : []);
  const givenRisk = str(g, 'riskClass');
  const risk = givenRisk && (WORKER_RISK as readonly string[]).includes(givenRisk)
    ? givenRisk
    : riskFromPaths(paths, (repo.riskDefaults ?? {}) as Record<string, string>) ?? 'logic';
  const repoSlug = str(g, 'repoSlug') ?? (Array.isArray(p.repoSlugs) ? String((p.repoSlugs as unknown[])[0] ?? '') || null : null) ?? str(repo, 'title');
  const objective = str(g, 'objective') ?? [str(r, 'outcome'), str(p, 'approach')].filter(Boolean).join(' ');
  return {
    ...g,
    title: str(g, 'title') ?? (typeof r.title === 'string' ? r.title : null),
    objective: objective || null,
    acceptanceContract: acceptance,
    allowedPaths: paths,
    requiredChecks: checks,
    riskClass: risk,
    repoSlug,
  };
}

async function readRepo(orgId: string, slug: string | null): Promise<Meta | null> {
  if (!slug) {
    return null;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ title: businessObjectSchema.title, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, 'repo'), eq(businessObjectSchema.title, slug)))
    .limit(1);
  return rows[0] ? { ...(rows[0].meta as Meta), title: rows[0].title } : null;
}

async function loadAll(ctx: ActionContext, input: z.infer<typeof dispatchInput>) {
  const stored = input.taskId ? await readRecord(ctx.orgId, input.taskId) : null;
  const plan = input.planId ? await readRecord(ctx.orgId, input.planId) : null;
  const requestId = stored ? Number(stored.meta.requestId) : Number(input.requestId);
  const request = Number.isFinite(requestId) ? await readRecord(ctx.orgId, requestId) : null;
  let task = stored;
  if (!stored && request) {
    const planRepo = plan && Array.isArray(plan.meta.repoSlugs) ? String((plan.meta.repoSlugs as unknown[])[0] ?? '') : null;
    const repo = await readRepo(ctx.orgId, str((input.contract ?? {}) as Meta, 'repoSlug') ?? planRepo);
    const meta = deriveContract({ given: (input.contract ?? {}) as Meta, request: { ...request.meta, title: request.title }, plan: plan?.meta ?? null, repo });
    task = { id: 0, title: String(meta.title ?? request.title), typeId: 0, typeSlug: 'engineering_task', meta: { ...meta, requestId: request.id } };
  }
  return { task, plan, request };
}

export const factoryDispatchAction: Action<typeof dispatchInput> = {
  id: DISPATCH_ACTION_ID,
  name: 'Start the build',
  description: 'Approve an engineering task (and its architecture plan, when named) and send it to the engineer that runs on the external worker. Takes the engineering_task record id, OR carries the contract itself (contract + requestId) and creates the task on approval; the contract must carry an objective, acceptance, allowed paths, required checks, a risk class and a repo. Spends money on a model: a person approves it. Undo cancels the run while no worker has claimed it.',
  inputSchema: dispatchInput,
  grant: 'factory_write',
  external: true,
  dedupKeyFor: input => `${DISPATCH_ACTION_ID}:${input.taskId ?? `request-${input.requestId}`}`,
  async precheck(ctx, input) {
    const { externalWorkersEnabled } = await import('@/services/WorkerRunService');
    if (!externalWorkersEnabled()) {
      return 'External workers are not enabled on this deployment (VOCION_EXTERNAL_WORKERS=1), so nothing can take the build.';
    }
    const { task, plan } = await loadAll(ctx, input);
    if (!task || task.typeSlug !== 'engineering_task') {
      return `No engineering task #${input.taskId} in this workspace. Carry the contract on this action (contract + requestId) or name a task that exists.`;
    }
    if (!input.taskId && input.requestId) {
      const req = await readRecord(ctx.orgId, input.requestId);
      if (!req || req.typeSlug !== 'request') {
        return `No request #${input.requestId} in this workspace.`;
      }
    }
    const gaps = contractGaps(task.meta);
    if (gaps.length > 0) {
      return `Engineering task #${task.id} is not ready to build: it has no ${gaps.join(', ')}. Fill them on the task, then start it.`;
    }
    if (input.planId && (!plan || plan.typeSlug !== 'architecture_plan')) {
      return `No architecture plan #${input.planId} in this workspace.`;
    }
    if (plan && task.meta.requestId !== undefined && String(plan.meta.requestId) !== String(task.meta.requestId)) {
      return `Plan #${plan.id} is for request #${String(plan.meta.requestId)}, not #${String(task.meta.requestId)}.`;
    }
    if (!(await engineerSlug(ctx.orgId, task.meta.agentSlug))) {
      return 'No agent in this workspace runs on the external worker, so nobody can take the build.';
    }
    return undefined;
  },
  async reviewCard(ctx, input): Promise<ReviewCard> {
    const { task, plan, request } = await loadAll(ctx, input);
    const m = task?.meta ?? {};
    const budget = typeof m.tokenBudget === 'number' ? `$${m.tokenBudget}` : 'the worker default';
    return {
      title: `Start the build: ${request?.title ?? task?.title ?? `task #${input.taskId}`}`,
      system: 'Factory',
      summary: input.reason,
      fields: [
        ...(request ? [{ label: 'Request', value: `#${request.id} ${request.title}`, href: `/dashboard/p/feature/${request.id}` }] : []),
        ...(plan ? [{ label: 'Plan', value: `#${plan.id} ${plan.title}` }] : []),
        { label: 'Task', value: input.taskId ? `#${input.taskId} ${task?.title ?? ''}`.trim() : `${task?.title ?? ''} (new)` },
        { label: 'Change', value: str(m, 'objective') ?? '' },
        { label: 'Paths', value: list(m, 'allowedPaths').join(', ') },
        { label: 'Checks', value: list(m, 'requiredChecks').join(', ') },
        { label: 'Repo', value: str(m, 'repoSlug') ?? str(m, 'repo') ?? 'not named' },
        { label: 'Budget', value: budget },
        { label: 'Done when', value: `${list(m, 'acceptanceContract').length} criteria` },
      ],
      nextAction: plan ? 'Approving approves the plan and starts the engineer on the task. Undo works until a worker picks it up.' : 'Approving starts the engineer on the task. Undo works until a worker picks it up.',
      verbs: { approve: 'Start build', reject: 'Not yet' },
    };
  },
  async execute(ctx, input) {
    const { createWorkerRun } = await import('@/services/WorkerRunService');
    const loaded = await loadAll(ctx, input);
    const { plan, request } = loaded;
    let task = loaded.task;
    if (!task) {
      throw new Error(`No engineering task #${input.taskId}.`);
    }
    let createdTaskId: number | null = null;
    if (!input.taskId) {
      const { createBusinessObject } = await import('@/services/BusinessObjectService');
      const { title, ...rest } = task.meta as Meta & { title?: string };
      const created = await createBusinessObject({ typeSlug: 'engineering_task', title: String(title ?? task.title), status: 'active', metadata: { ...rest, requestId: input.requestId, productSlug: request ? str(request.meta, 'product') : undefined, status: 'ready' } } as never, ctx.orgId, ctx.reviewedBy ?? ctx.invokedBy ?? 'system');
      createdTaskId = (created as { id: number }).id;
      task = { ...task, id: createdTaskId };
    }
    const gaps = contractGaps(task.meta);
    if (gaps.length > 0) {
      throw new Error(`Engineering task #${task.id} has no ${gaps.join(', ')}.`);
    }
    const agentSlug = await engineerSlug(ctx.orgId, task.meta.agentSlug);
    if (!agentSlug) {
      throw new Error('No agent in this workspace runs on the external worker.');
    }
    const approvedBy = ctx.reviewedBy ?? ctx.invokedBy ?? 'a person';
    const approvedAt = new Date().toISOString();
    const previousPlan = plan ? { status: plan.meta.status ?? null, approvedBy: plan.meta.approvedBy ?? null, approvedAt: plan.meta.approvedAt ?? null } : null;
    if (plan) {
      await writeMeta(ctx.orgId, plan.id, { status: 'approved', approvedBy, approvedAt });
    }
    const contract = contractFromTask(task, {
      product: request ? str(request.meta, 'product') : null,
      plan: plan ? { id: plan.id, approach: str(plan.meta, 'approach'), approvedBy, approvedAt } : undefined,
    });
    const capCents = typeof task.meta.tokenBudget === 'number' ? Math.round(task.meta.tokenBudget * 100) : null;
    const run = await createWorkerRun({ orgId: ctx.orgId, agentSlug, input: { task: contract, record: { id: task.id, type: 'engineering_task' } }, capCents, createdBy: approvedBy });
    const previousTask = { status: task.meta.status ?? null, workerRunId: task.meta.workerRunId ?? null };
    await writeMeta(ctx.orgId, task.id, { status: 'dispatched', workerRunId: run.id, ...(plan ? { planId: plan.id } : {}) });
    if (request) {
      // The card was the decision: the acceptance is frozen as the contract
      // and the recommendation is approved, in the same action.
      await writeMeta(ctx.orgId, request.id, {
        state: 'building',
        recommendationState: 'approved',
        decidedAt: approvedAt,
        ...(request.meta.acceptanceFrozenAt ? {} : { acceptanceFrozenAt: approvedAt }),
      });
    }
    return { workerRunId: run.id, agentSlug, taskId: task.id, createdTaskId, planId: plan?.id ?? null, requestId: request?.id ?? null, previousTask, previousPlan, previousRequestState: request ? (request.meta.state ?? null) : null, previousRequest: request ? { recommendationState: request.meta.recommendationState ?? null, decidedAt: request.meta.decidedAt ?? null, acceptanceFrozenAt: request.meta.acceptanceFrozenAt ?? null } : null };
  },
  async undo(ctx, _input, result) {
    const { cancelWorkerRun, getWorkerRun } = await import('@/services/WorkerRunService');
    const runId = Number(result.workerRunId);
    const run = await getWorkerRun(ctx.orgId, runId);
    if (run && run.status !== 'queued') {
      throw new Error(`Worker run #${runId} is already ${run.status}; stop it from the run instead.`);
    }
    if (run) {
      await cancelWorkerRun(ctx.orgId, runId);
    }
    const pt = (result.previousTask ?? {}) as Meta;
    // A task this dispatch created goes back to ready with the run cleared;
    // it stays on the record as the contract a person approved.
    await writeMeta(ctx.orgId, Number(result.taskId), { status: result.createdTaskId ? 'ready' : (pt.status ?? 'ready'), workerRunId: pt.workerRunId ?? null });
    if (result.planId && result.previousPlan) {
      const pp = result.previousPlan as Meta;
      await writeMeta(ctx.orgId, Number(result.planId), { status: pp.status ?? 'proposed', approvedBy: pp.approvedBy ?? null, approvedAt: pp.approvedAt ?? null });
    }
    if (result.requestId && result.previousRequestState !== undefined) {
      await writeMeta(ctx.orgId, Number(result.requestId), { state: result.previousRequestState, ...((result.previousRequest ?? {}) as Meta) });
    }
    return { cancelledRun: runId };
  },
};
