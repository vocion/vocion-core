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
import { REOPENABLE_REQUEST_STATES } from '@/libs/factory/requestStates';
import { factoryTypes } from '@/libs/factory/types';

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
  /**
   * The attempt QA sent back, when this build is the factory's own retry of
   * it. A retry is its own trust key (`factory.dispatch_task.retry`), so it
   * can run done-for-you while a first build stays the owner's tap; and an
   * attempt that was itself a retry is never retried again.
   */
  autoRetryOf: z.coerce.number().int().positive().optional(),
  /**
   * What the person pressing Build wants this attempt to do differently, in
   * their words (Chris, 2026-09-28: "can be triggered from the UI with prompt
   * from user"), or what the factory carries into a recovery (the failing
   * checks' output). It rides the objective, where the engineer reads.
   */
  note: z.string().trim().min(1).max(4000).optional(),
  /**
   * WHO STARTED IT, when it was not a person (backlog 038). `request` — the
   * intake started a fix a person asked for in chat; `recovery` — the factory
   * sent a failed run again; `plan` — an approved plan dispatched its build.
   * Each is its own trust key (`factory.dispatch_task.from_request`,
   * `.recovery`, `.from_plan`), so a workspace decides each separately, and
   * each counts toward the automatic-attempt limit (`services/factory/recovery.ts`).
   */
  trigger: z.enum(['request', 'recovery', 'plan']).optional(),
  /** The failed run a recovery answers — its own dedup key, one recovery per failure. */
  recoveryOfRun: z.coerce.number().int().positive().optional(),
  /** What that run's failure was (`classifyFailure`), kept on the task. */
  recoveryClass: z.string().max(40).optional(),
  /** The worker's own "plan is required" sentence: plan first, whatever the rule reads. */
  planFirst: z.string().max(1000).optional(),
  /**
   * QA SENT IT BACK TO PLANNING (Chris, 2026-09-29: "does our flow handle a QA
   * send back to plan?"): why the approved plan cannot be built as written. The
   * plan is superseded and planned again with this as the brief, before any run.
   */
  replan: z.string().trim().min(1).max(1500).optional(),
}).refine(v => v.taskId !== undefined || v.requestId !== undefined, { message: 'Name the engineering task (taskId), or the request (requestId) — the contract is filled from the request, its plan and the repo.' });

type Meta = Record<string, unknown>;
type Rec = { id: number; title: string; typeId: number; meta: Meta; status?: string | null };

/** A record with its type's slug, as the factory reads one. */
export type FactoryRecord = Rec & { typeSlug: string };

/**
 * One record, scoped to the org.
 * @param orgId - Tenant.
 * @param id - The object id.
 */
export async function readRecord(orgId: string, id: number): Promise<FactoryRecord | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, typeId: businessObjectSchema.typeId, status: businessObjectSchema.status, meta: businessObjectSchema.metadata, typeSlug: businessObjectTypeSchema.slug })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return row ? { ...row, meta: (row.meta ?? {}) as Meta } : null;
}

/**
 * Whether a plan record is approved: its own status says so, or it names who approved it.
 * @param meta - The plan's metadata.
 */
export function planIsApproved(meta: Meta): boolean {
  if (meta.status === 'rejected' || meta.status === 'superseded') {
    return false;
  }
  return meta.status === 'approved' || (typeof meta.approvedBy === 'string' && meta.approvedBy.trim() !== '');
}

/**
 * Merge fields onto a record's metadata.
 * @param orgId - Tenant.
 * @param id - The object id.
 * @param set - The fields.
 */
export async function writeMeta(orgId: string, id: number, set: Meta): Promise<void> {
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

/**
 * THE SEAT'S MODEL IS THE RUN'S MODEL (2026-09-29): `send-engineer` pinned
 * `claude-opus-5`, and nothing carried it to the worker — every one of 60
 * runs used the worker's `DEFAULT_MODEL` (Sonnet). The worker reads only
 * `model_policy` on the contract, so the engineer seat's `harness.model`
 * (and `harness.effort`, when it is one the worker takes) goes there.
 * @param orgId - The workspace.
 * @param slug - The engineer seat that will claim the run.
 * @returns The policy, or null when the seat names no model.
 */
export async function seatModelPolicy(orgId: string, slug: string): Promise<{ model: string; effort?: string } | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const [row] = await db.select({ harness: agentSchema.harnessConfig }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))).limit(1);
  const h = (row?.harness ?? {}) as { model?: unknown; effort?: unknown };
  const model = typeof h.model === 'string' && h.model.trim() ? h.model.trim() : null;
  if (!model) {
    return null;
  }
  const effort = typeof h.effort === 'string' && ['low', 'medium', 'high', 'max'].includes(h.effort) ? h.effort : undefined;
  return { model, ...(effort ? { effort } : {}) };
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
  const qa = (meta.qa ?? {}) as Meta;
  if (str(meta, 'riskClass') === 'ui' && !(Array.isArray(qa.flows) && qa.flows.length > 0)) {
    gaps.push('qa.flows (a ui change is screenshotted before and after)');
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
 * @param opts.modelPolicy - The engineer seat's model (`seatModelPolicy`), used when the task names none.
 * @param opts.plan.id
 * @param opts.plan.approach
 * @param opts.plan.approvedBy
 * @param opts.plan.approvedAt
 */
export function contractFromTask(task: { id: number; title: string; meta: Meta }, opts: { product: string | null; plan?: { id: number; approach: string | null; approvedBy: string; approvedAt: string }; modelPolicy?: { model: string; effort?: string } | null }): Record<string, unknown> {
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
  // A task's own policy wins; otherwise the engineer seat's (`seatModelPolicy`).
  if (m.modelPolicy && typeof m.modelPolicy === 'object') {
    out.model_policy = m.modelPolicy;
  } else if (opts.modelPolicy) {
    out.model_policy = opts.modelPolicy;
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

// Highest first: the contract's class is the riskiest path it touches. infra
// and promise were missing, so a diff into packages/infra/** was filed as
// logic and QA refused to approve it at that class (#126 attempt 195).
const WORKER_RISK = ['promise', 'infra', 'schema', 'billing', 'auth', 'logic', 'ui', 'deps', 'marketing', 'docs'] as const;

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
 * The higher of two risk classes, in the worker's order (promise highest).
 * An unknown class ranks below every known one.
 * @param a - One class.
 * @param b - The other, or null.
 */
export function higherRisk(a: string, b: string | null): string {
  if (!b) {
    return a;
  }
  const rank = (x: string) => {
    const i = (WORKER_RISK as readonly string[]).indexOf(x);
    return i === -1 ? WORKER_RISK.length : i;
  };
  return rank(b) < rank(a) ? b : a;
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
 * @param input.previous
 * @param input.resume - The attempt this one continues from ({@link pickResumeBase}): its branch is the base, its verdict the brief.
 * @param input.note - What the person pressing Build (or the factory's recovery) asks of this attempt.
 * @param input.reported - What the person sent in the chat the request was filed from (`reported.reportedLinks`).
 */
export function deriveContract(input: { given: Meta; request: Meta & { title?: string } | null; plan: Meta | null; repo: Meta | null; previous?: { id: number; meta: Meta } | null; resume?: { id: number; meta: Meta } | null; note?: string; reported?: ReadonlyArray<{ title: string; url: string; file: string | null }> }): Meta {
  const g = input.given;
  const r = input.request ?? {};
  const p = input.plan ?? {};
  const repo = input.repo ?? {};
  // THE PLAN'S RISKS ARE PART OF DONE (iteration 3, 2026-09-26: the plan named
  // a per-link rate limit as the mitigation for abuse; the acceptance did not,
  // and the build shipped without it). The first two risks become checkable
  // lines, so a mitigation cannot be skipped silently.
  const riskLines = list(p, 'risks').slice(0, 2).map(x => `The plan's risk is handled: ${x}`);
  const acceptance = list(g, 'acceptanceContract').length > 0 ? list(g, 'acceptanceContract') : [...list(r, 'acceptance'), ...riskLines];
  // ONLY WHAT IS REAL wins over the records (red team, 2026-09-26: a card
  // carried "send-web: header, RequestDialog.tsx" as a path and "All six
  // acceptance criteria pass" as a check). A path is a path; a check is one
  // the repo defines. Anything else falls back to what the records say.
  const isPath = (x: string) => /^[\w.@-]+(?:\/[\w.@*-]+)+\/?$/.test(x);
  const repoChecks = Array.isArray(repo.checks) ? (repo.checks as Array<{ name?: string }>).map(c => c.name ?? '').filter(Boolean) : [];
  const givenPaths = list(g, 'allowedPaths').filter(isPath);
  // A REQUEST WITH NO PLAN STILL BUILDS. #201 (a P1 access bug, filed with
  // its acceptance and the file at fault) skipped planning, and Build answered
  // "task #0 has no allowedPaths, requiredChecks, repo" (2026-09-28). With no
  // plan, the repo record says which paths a product's change may touch.
  // Keyed `<product>.<surface>` first, then `<product>`: #201 is an api-only
  // bug (surface data), and a contract spanning api and web needs a plan the
  // request never had, so the worker refused it (run 401, 2026-09-28).
  const byProduct = (repo.productPaths ?? {}) as Record<string, string[]>;
  const productPaths = byProduct[`${String(r.product ?? '')}.${String(r.surface ?? '')}`] ?? byProduct[String(r.product ?? '')] ?? [];
  const componentPaths = pathsFromComponents(list(p, 'components'));
  const planPaths = givenPaths.length > 0 ? givenPaths : componentPaths.length > 0 ? componentPaths : productPaths.filter(isPath);
  // A GENERATED FILE BRINGS ITS SOURCE. #124's plan named
  // apps/send-api/prisma/schema/core.prisma, which is rebuilt from
  // packages/core/prisma/** on every check; with the source out of bounds the
  // engineer created its tables at runtime instead (2026-09-28). The repo
  // record names what is generated from what (`generatedFrom`).
  // A value may name several companions: the source, and where the change's
  // migrations go (#124: the migration dir sat beside the generated schema and
  // was out of bounds, so the engineer stopped rather than create tables at runtime).
  const generatedFrom = (repo.generatedFrom ?? {}) as Record<string, string | string[]>;
  const sources = planPaths.flatMap(x => Object.entries(generatedFrom).filter(([glob]) => x.startsWith(glob.replace(/\*+$/, '').replace(/\/$/, ''))).flatMap(([, source]) => (Array.isArray(source) ? source : [source])));
  // …AND A SOURCE BRINGS WHAT IS GENERATED FROM IT (#130 run 418, 2026-09-29:
  // the plan named packages/core/prisma/**, the engineer changed it and
  // regenerated, and the rewritten apps/stamp-api/prisma/schema/core.prisma
  // was "outside allowed_paths" — a correct change refused, $11.35 in). A
  // generated file changes whenever its source does, so it is always in bounds.
  const prefix = (glob: string) => glob.replace(/\*+$/, '').replace(/\/$/, '');
  const generated = Object.entries(generatedFrom)
    .filter(([, source]) => (Array.isArray(source) ? source : [source]).some(src => planPaths.some(x => x.startsWith(prefix(src)) || prefix(src).startsWith(prefix(x)))))
    .map(([glob]) => glob);
  const basePaths = [...new Set([...planPaths, ...sources, ...generated])];
  // EVERY PACKAGE TOUCHED MAY BE TESTED (QA on PR #36, 2026-09-26: "the control
  // the plan mandates is an integration test, and the contract's allowed paths
  // make writing one impossible"). Each app or package root a path lives in
  // brings its tests directory with it.
  const roots = new Set(basePaths.map(x => /^((?:apps|packages|services)\/[\w.-]+)\//.exec(x)?.[1]).filter((x): x is string => Boolean(x)));
  // A UI APP OPENS ITS SOURCE. #126's plan named apps/send-web/src/lib/upload.ts
  // and nothing that renders: the criterion "Losing signal shows No signal ·
  // N% kept · retrying" could not be built inside the paths, four attempts ran,
  // and none said so (2026-09-28). An app the repo marks ui, touched by named
  // files only, brings its src/** — a visible criterion needs its component.
  const riskMap = (repo.riskDefaults ?? {}) as Record<string, string>;
  const uiSrc = [...roots].filter(r => riskMap[`${r}/**`] === 'ui' && !basePaths.includes(`${r}/**`) && !basePaths.includes(`${r}/src/**`)).map(r => `${r}/src/**`);
  // A CHANGE A PERSON CAN SEE GETS ITS UI APP. #214 (a Download CSV button) had
  // a plan naming the api and the marketing site but not the web app, so no
  // attempt could build the button and QA refused the visible criteria three
  // times (runs 405–407, 2026-09-28). A ui or flow request whose paths reach no
  // ui app gets its product's ui app (the repo's productPaths + riskDefaults).
  const uiRoot = (x: string) => /^((?:apps|packages|services)\/[\w.-]+)/.exec(x)?.[1] ?? null;
  const isUiRoot = (root: string | null): root is string => root !== null && riskMap[`${root}/**`] === 'ui';
  const touchesUi = [...basePaths, ...uiSrc].some(x => isUiRoot(uiRoot(x)));
  const productGlobs = ((repo.productPaths ?? {}) as Record<string, string[]>)[String(r.product ?? '')] ?? [];
  const uiApps = ['ui', 'flow'].includes(String(r.surface ?? '')) && !touchesUi
    ? [...new Set(productGlobs.map(uiRoot).filter(isUiRoot))]
    : [];
  for (const root of uiApps) {
    roots.add(root);
  }
  const paths = [...new Set([...basePaths, ...uiSrc, ...uiApps.map(root => `${root}/src/**`), ...[...roots].map(r => `${r}/tests/**`)])];
  const givenChecks = list(g, 'requiredChecks').filter(c => repoChecks.length === 0 ? /^[\w:.-]+$/.test(c) : repoChecks.includes(c));
  const checks = givenChecks.length > 0 ? givenChecks : repoChecks;
  const givenRisk = str(g, 'riskClass');
  const risk = givenRisk && (WORKER_RISK as readonly string[]).includes(givenRisk)
    ? givenRisk
    : riskFromPaths(paths, (repo.riskDefaults ?? {}) as Record<string, string>) ?? 'logic';
  // AN OWNER IN THE SLUG (#130 run 416, 2026-09-29: plan #136 named its repo
  // "squatch-core", and the worker cloned https://github.com/squatch-core.git).
  // A bare name is qualified from the repo record's title (owner/name).
  const planRepo = Array.isArray(p.repoSlugs) ? String((p.repoSlugs as unknown[])[0] ?? '') || null : null;
  const repoTitle = str(repo, 'title');
  const qualified = (s: string | null) => (s && !s.includes('/') && repoTitle?.includes('/') && repoTitle.split('/').pop() === s ? repoTitle : s);
  // THE REPO RECORD IS THE REPO (#201 runs 426–427, 2026-09-30: plan #254
  // named its repo "apps/stamp-api", a folder, and the worker cloned
  // github.com/apps/stamp-api.git twice). When the product has a repo record,
  // a named repo is used only if it is that record's; anything else was a
  // path or a guess, and the record wins.
  const known = (s: string | null) => (s && repoTitle && qualified(s) === repoTitle ? repoTitle : null);
  const repoSlug = repoTitle
    ? known(str(g, 'repoSlug')) ?? known(planRepo) ?? repoTitle
    : qualified(str(g, 'repoSlug')) ?? qualified(planRepo);
  // THE LAST ATTEMPT'S VERDICT IS THIS ATTEMPT'S BRIEF. QA sent #157 back
  // with "0 of 8 proven" and a line per criterion saying what would settle it
  // (2026-09-26); a rebuild that starts from the request alone repeats the
  // same gap. The unproven lines ride the objective, where the worker reads.
  // The verdict that is carried is the one about the code this attempt starts from.
  const resume = str(g, 'baseSha') ? null : input.resume ?? null;
  const prev = resume ?? input.previous ?? null;
  const prevVerdict = (prev?.meta.verdict ?? null) as { note?: string; criteria?: Array<{ criterion?: string; status?: string; evidence?: string }> } | null;
  const owed = (prevVerdict?.criteria ?? []).filter(c => c.status !== 'proven' && c.criterion);
  const carried = prev && prevVerdict
    ? `\n\nThe last attempt (task #${prev.id}${str(prev.meta, 'prUrl') ? `, ${str(prev.meta, 'prUrl')}` : ''}) was sent back by ${(prevVerdict as { heldBy?: string }).heldBy === 'person' ? 'the person who merges' : 'QA'}: ${String(prevVerdict.note ?? 'changes asked').replace(/^A person held the merge: /, '')}${owed.length > 0 ? `\nProve each of these with evidence a reviewer can open (a named test, a screenshot of that exact state):\n${owed.map(c => `- ${c.criterion}${c.evidence ? ` (QA: ${c.evidence})` : ''}`).join('\n')}` : ''}`
    : '';
  const asked = input.note ? `\n\nFor this attempt: ${input.note}` : '';
  // WHAT THE PERSON SAW (Chris, 2026-09-30, #268): what they sent in the chat
  // it was filed from, as links the engineer opens before changing anything.
  const reported = (input.reported ?? []).length > 0
    ? `\n\nWhat the person reported (open each to see what they saw):\n${input.reported!.map(r => `- ${r.title}: ${r.file ?? r.url}${r.file ? ` (${r.url})` : ''}`).join('\n')}`
    : '';
  const resumeProven = resume ? (resume.meta.verdict as { proven?: number; total?: number } | undefined) : undefined;
  const continued = resume
    ? `\n\nThis attempt continues branch ${String(resume.meta.branch)} (task #${resume.id}, ${resumeProven?.proven ?? 0} of ${resumeProven?.total ?? '?'} criteria proven). Keep what is proven; change only what the open criteria need.`
    : '';
  const objective = (str(g, 'objective') ?? [str(r, 'outcome'), str(p, 'approach')].filter(Boolean).join(' ')) + reported + carried + continued + asked;
  // A ui change is refused without a QA flow (the worker screenshots it
  // before and after). The request says where it lives; that page is the flow.
  const visuals = (r.visuals ?? {}) as Meta;
  let qaPath = '/';
  try {
    qaPath = str(visuals, 'surfaceUrl') ? new URL(str(visuals, 'surfaceUrl')!).pathname || '/' : '/';
  } catch { /* not a URL: the home page */ }
  // A change a person can SEE is screenshotted whatever its risk class: #131
  // (library search) is `logic` because it touches the API, and shipped with no
  // QA flow and so no picture to prove it (2026-09-26).
  const visible = risk === 'ui' || ['ui', 'flow'].includes(String(r.surface ?? ''));
  // A QA flow name fits the worker's contract (≤ 60 characters): #214's title
  // was 64 and the worker refused the whole contract before cloning (run 404,
  // 2026-09-28). Cut at a word, never mid-word.
  const flowName = fitName(typeof r.title === 'string' ? r.title : 'the change', 60);
  const qa = g.qa ?? (visible ? { surface: str(repo, 'qaSurface') ?? 'app', flows: [{ name: flowName, path: qaPath, sign_in: true }] } : undefined);
  const environment = g.environment ?? (repo.environment && typeof repo.environment === 'object' ? repo.environment : undefined);
  return {
    ...g,
    ...(qa ? { qa } : {}),
    ...(environment ? { environment } : {}),
    title: str(g, 'title') ?? (typeof r.title === 'string' ? r.title : null),
    objective: objective || null,
    ...(input.previous ? { previousTaskId: input.previous.id } : prev ? { previousTaskId: prev.id } : {}),
    // What was asked of THIS attempt, kept apart from the objective it rides
    // in, so the run page says it in one line (`RunWhy`). Task metadata only:
    // `contractFromTask` names the worker's fields and never sends it.
    ...(input.note ? { attemptNote: input.note.slice(0, 1000) } : {}),
    ...(resume ? { baseSha: String(resume.meta.branch), attempt: (Number(resume.meta.attempt) || 1) + 1, resumedFrom: resume.id } : {}),
    acceptanceContract: acceptance,
    allowedPaths: paths,
    requiredChecks: checks,
    riskClass: risk,
    repoSlug,
  };
}

/**
 * A name that fits `max` characters, cut at the last whole word (with an ellipsis).
 * @param name - The full name.
 * @param max - The limit the worker's contract sets.
 */
export function fitName(name: string, max: number): string {
  const clean = name.trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max - 1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).replace(/[\s,;:.\-—"'(]+$/, '')}…`;
}

export async function readRepo(orgId: string, slug: string | null, product?: string | null): Promise<Meta | null> {
  if (!slug && !product) {
    return null;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ title: businessObjectSchema.title, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, (await factoryTypes(orgId)).repo)));
  // By its title (owner/name), its short slug, then the product it builds.
  const hit = rows.find(x => slug && x.title === slug)
    ?? rows.find(x => slug && ((x.meta as Meta).slug === slug || x.title.endsWith(`/${slug}`)))
    ?? rows.find(x => product && (x.meta as Meta).product === product);
  return hit ? { ...(hit.meta as Meta), title: hit.title } : null;
}

/**
 * The attempt a retry continues from: the one under this plan that proved the
 * most, whatever came after it (#224, 2026-09-29: attempt 2 proved 6 of 8 on
 * PR #121; attempt 3 started again from main, edited a component the library
 * page does not render, and proved 1 of 8). An attempt that proved nothing is
 * a wrong direction, never a base; one under another plan was built to other
 * paths. Newest wins a tie.
 * An attempt built before the plan's current approval was built to the plan
 * as it read then (#130: plan #136 was rewritten in place for the Send →
 * Stamp rename, and the resume picked a branch cut to the old paths).
 * @param rows - The request's sent-back and superseded attempts.
 * @param planId - The plan this build answers, or null when it has none.
 * @param planApprovedAt - When that plan was last approved (ISO), if known.
 */
export function pickResumeBase(rows: Array<{ id: number; meta: Meta; createdAt?: Date | null }>, planId: number | null, planApprovedAt?: string | null): { id: number; meta: Meta } | null {
  const proven = (m: Meta) => Number((m.verdict as { proven?: unknown } | undefined)?.proven ?? 0) || 0;
  const samePlan = (m: Meta) => (Number(m.planId) > 0 ? Number(m.planId) : null) === planId;
  const since = planApprovedAt ? Date.parse(planApprovedAt) : Number.NaN;
  const afterApproval = (r: { createdAt?: Date | null }) => Number.isNaN(since) || !r.createdAt || r.createdAt.getTime() >= since;
  const eligible = rows.filter(r => typeof r.meta.branch === 'string' && r.meta.branch.startsWith('factory/') && proven(r.meta) > 0 && samePlan(r.meta) && afterApproval(r));
  return eligible.sort((a, b) => proven(b.meta) - proven(a.meta) || b.id - a.id)[0] ?? null;
}

/**
 * The newest attempt at this request that QA sent back, and the attempt the
 * next build continues from ({@link pickResumeBase}).
 * @param orgId - The workspace.
 * @param requestId - The request.
 * @param planId - The plan this build answers.
 * @param planApprovedAt - When that plan was last approved.
 */
async function sentBackTask(orgId: string, requestId: number, planId: number | null, planApprovedAt?: string | null): Promise<{ latest: { id: number; meta: Meta } | null; resume: { id: number; meta: Meta } | null }> {
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ id: businessObjectSchema.id, status: businessObjectSchema.status, meta: businessObjectSchema.metadata, createdAt: businessObjectSchema.createdAt })
    .from(businessObjectSchema)
    .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
    .where(and(
      eq(businessObjectSchema.orgId, orgId),
      eq(businessObjectTypeSchema.slug, (await factoryTypes(orgId)).task),
      sql`${businessObjectSchema.metadata}->>'requestId' = ${String(requestId)}`,
      inArray(businessObjectSchema.status, ['changes_requested', 'abandoned']),
    ))
    .orderBy(sql`${businessObjectSchema.id} desc`)
    .limit(20);
  const all = rows.map(r => ({ id: r.id, status: r.status, meta: (r.meta ?? {}) as Meta, createdAt: r.createdAt }));
  const latest = all.find(r => r.status === 'changes_requested') ?? null;
  return { latest: latest ? { id: latest.id, meta: latest.meta } : null, resume: pickResumeBase(all, planId, planApprovedAt) };
}

async function loadAll(ctx: ActionContext, input: z.infer<typeof dispatchInput>) {
  const stored = input.taskId ? await readRecord(ctx.orgId, input.taskId) : null;
  const plan = input.planId ? await readRecord(ctx.orgId, input.planId) : null;
  const requestId = stored ? Number(stored.meta.requestId) : Number(input.requestId);
  const request = Number.isFinite(requestId) ? await readRecord(ctx.orgId, requestId) : null;
  let task = stored;
  const planRepo = plan && Array.isArray(plan.meta.repoSlugs) ? String((plan.meta.repoSlugs as unknown[])[0] ?? '') || null : null;
  const repo = request || plan
    ? await readRepo(ctx.orgId, str((input.contract ?? {}) as Meta, 'repoSlug') ?? planRepo ?? (stored ? str(stored.meta, 'repoSlug') : null) ?? (request ? str(request.meta, 'ownerRepo') : null), request ? str(request.meta, 'product') : null)
    : null;
  if (!stored && request) {
    const { latest: previous, resume } = await sentBackTask(ctx.orgId, request.id, plan ? plan.id : null, plan ? str(plan.meta, 'approvedAt') : null);
    const { reportedLinks } = await import('@/services/objects/reported');
    const reported = await reportedLinks(ctx.orgId, request.id).catch(() => []);
    const meta = deriveContract({ given: (input.contract ?? {}) as Meta, request: { ...request.meta, title: request.title }, plan: plan?.meta ?? null, repo, previous, resume, note: input.note, reported });
    task = { id: 0, title: String(meta.title ?? request.title), typeId: 0, typeSlug: (await factoryTypes(ctx.orgId)).task, meta: { ...meta, requestId: request.id } };
  }
  return { task, plan, request, repo };
}

/**
 * A PLAN WRITTEN BEFORE A RENAME IS STALE (#130, 2026-09-29): plan #136 named
 * `apps/send-api/...` three days before those directories became
 * `apps/stamp-*`, and its build ran into a fence it could not see. When the
 * plan's components name app or package roots the repo record no longer
 * lists, the build is not sent — the plan is superseded and planned again.
 * @param plan - The named plan.
 * @param repo - The repo record.
 */
async function stalePlan(plan: Rec | null, repo: Meta | null) {
  if (!plan) {
    return null;
  }
  const { stalePlanRoots } = await import('@/services/factory/recovery');
  return stalePlanRoots(list(plan.meta, 'components'), repo);
}

/**
 * Mark a plan superseded: it stays on the record, with why, and no longer
 * counts as approved (`planIsApproved`), so nothing builds from it.
 * @param orgId - Tenant.
 * @param planId - The plan.
 * @param why - Why it no longer stands.
 * @param at - When.
 */
export async function supersedePlan(orgId: string, planId: number, why: string, at: string): Promise<void> {
  await writeMeta(orgId, planId, { status: 'superseded', supersededAt: at, supersededReason: why });
}

/**
 * The worker's contract this dispatch would send, without sending it — what a
 * recovery compares against the contract a failed run was given.
 * @param orgId - Tenant.
 * @param raw - The dispatch input.
 */
export async function previewContract(orgId: string, raw: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const parsed = dispatchInput.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const { task, plan, request } = await loadAll({ orgId }, parsed.data);
  if (!task) {
    return null;
  }
  const approved = plan && planIsApproved(plan.meta) ? { id: plan.id, approach: str(plan.meta, 'approach'), approvedBy: String(plan.meta.approvedBy ?? 'a person'), approvedAt: String(plan.meta.approvedAt ?? '') } : undefined;
  return contractFromTask(task, { product: request ? str(request.meta, 'product') : null, plan: approved });
}

/**
 * THE PLAN GATE FOR THIS DISPATCH: would it build, or plan first? A plan the
 * dispatch names counts as approved when it already is, or when a person is
 * approving this card (approving the build approves its plan, as before).
 * @param task - The contract as a record.
 * @param task.id - Its id (0 before it is created).
 * @param task.title - Its title.
 * @param task.meta - Its fields.
 * @param plan - The named plan.
 * @param request - The request.
 * @param opts - The decision.
 * @param opts.personApproving - A person is approving this dispatch.
 * @param opts.planFirst - The worker's own refusal, when a run gave one.
 */
async function gateFor(task: { id: number; title: string; meta: Meta }, plan: Rec | null, request: Rec | null, opts: { personApproving: boolean; planFirst?: string }) {
  const { planGate } = await import('@/services/factory/recovery');
  const approved = Boolean(plan && (opts.personApproving || planIsApproved(plan.meta)));
  const contract = contractFromTask(task, { product: request ? str(request.meta, 'product') : null, plan: approved && plan ? { id: plan.id, approach: str(plan.meta, 'approach'), approvedBy: 'a person', approvedAt: '' } : undefined });
  return planGate({ contract, planApproved: approved, planFirst: opts.planFirst ?? null });
}

/** The trust key each automatic start answers to. */
const TRIGGER_KEY = { request: 'from_request', recovery: 'recovery', plan: 'from_plan' } as const;

/**
 * The dedup suffix of an automatic start: one per failed run for a recovery,
 * one per plan for a plan's build, one for the intake — so a pending Build
 * card never swallows the factory's own start, nor the other way round.
 * @param input - The dispatch input.
 */
function triggerKey(input: z.infer<typeof dispatchInput>): string {
  if (input.trigger === 'recovery') {
    return `:recovery-${input.recoveryOfRun ?? 'sweep'}`;
  }
  if (input.trigger === 'plan') {
    return `:plan-${input.planId ?? 'none'}`;
  }
  return input.trigger === 'request' ? ':from-request' : '';
}

/** A planning start holds its request this long: the planner answers in a minute or two. */
export const PLANNING_HOLD_MS = 15 * 60_000;
/** A worker run in one of these is a build in progress. */
const BUILDING_WORKER_STATUSES = ['queued', 'running', 'paused'];
/** An action run in one of these is between its decision and its result. */
const IN_FLIGHT_RUN_STATUSES = ['approved', 'executing', 'awaiting_execution'];

/** One earlier start of the same request, as `buildUnderway` reads it. */
export type EarlierStart = { id: number; status: string; executedAt: Date | null; result: Meta | null; workerStatus?: string | null };

/**
 * IS THIS REQUEST ALREADY BUILDING? The pure half of the guard: given the
 * request's earlier starts (newest first), the sentence that refuses a second
 * one, or null. Request #224 (2026-09-29) was started twice in 27 seconds —
 * runs 5016 and 5018 — and each asked the planner for a plan, so two planners
 * ran side by side for one change.
 *
 * Underway means: a start between its decision and its result; a start whose
 * worker run is queued, running or paused; or a start that went to planning
 * less than fifteen minutes ago. A plan's own build (`trigger: plan`) is the
 * continuation of that planning, never a second start of it.
 * @param earlier - The request's earlier starts, newest first.
 * @param opts - What is asking.
 * @param opts.trigger - The new start's trigger.
 * @param opts.now - The clock.
 */
export function underwayRefusal(earlier: readonly EarlierStart[], opts: { trigger?: string | null; now?: Date } = {}): string | null {
  const u = underwayNow(earlier, opts);
  return u ? `already building: ${u.line}. Nothing new was started — follow that run.` : null;
}

/**
 * What is already happening for this request, as a line a person reads and
 * the worker run to follow, or null (the positive half of the guard: a start
 * of something already running is answered, not refused).
 * @param earlier - The request's earlier starts, newest first.
 * @param opts - What is asking.
 * @param opts.trigger - The new start's trigger.
 * @param opts.now - The clock.
 */
export function underwayNow(earlier: readonly EarlierStart[], opts: { trigger?: string | null; now?: Date } = {}): { line: string; workerRunId: number | null } | null {
  const now = (opts.now ?? new Date()).getTime();
  for (const run of earlier) {
    // A plan's own build continues the start that asked for the plan, even
    // while that start is still executing (#201, 2026-09-30: run 5335 went to
    // planning, the plan was approved two minutes later, and its build was
    // refused as "already building: run #5335 is starting it").
    if (IN_FLIGHT_RUN_STATUSES.includes(run.status) && opts.trigger !== 'plan') {
      return { line: `run #${run.id} is starting it now`, workerRunId: null };
    }
    if (run.status !== 'done' || !run.result) {
      continue;
    }
    const workerRunId = Number(run.result.workerRunId);
    if (Number.isInteger(workerRunId) && workerRunId > 0 && run.workerStatus && BUILDING_WORKER_STATUSES.includes(run.workerStatus)) {
      return { line: `run #${workerRunId} (started by action #${run.id}) is ${run.workerStatus}`, workerRunId };
    }
    if (run.result.planning === true && opts.trigger !== 'plan' && run.executedAt && now - run.executedAt.getTime() < PLANNING_HOLD_MS) {
      const minutes = Math.max(0, Math.round((now - run.executedAt.getTime()) / 60_000));
      const why = typeof run.result.why === 'string' ? ` (${run.result.why})` : '';
      return { line: `run #${run.id} started it ${minutes === 0 ? 'under a minute' : `${minutes} min`} ago and it is planning first${why}; the plan's approval starts the build`, workerRunId: null };
    }
  }
  return null;
}

/**
 * The request's earlier starts, newest first, with each one's worker run status.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param excludeRunId - The run asking, when it is one.
 */
async function earlierStarts(orgId: string, requestId: number, excludeRunId?: number): Promise<EarlierStart[]> {
  const { and, desc, eq, inArray, ne, or, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, workerRunSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ id: actionRunSchema.id, status: actionRunSchema.status, executedAt: actionRunSchema.executedAt, result: actionRunSchema.result })
    .from(actionRunSchema)
    .where(and(
      eq(actionRunSchema.orgId, orgId),
      eq(actionRunSchema.actionId, DISPATCH_ACTION_ID),
      inArray(actionRunSchema.status, ['done', ...IN_FLIGHT_RUN_STATUSES]),
      or(sql`${actionRunSchema.input}->>'requestId' = ${String(requestId)}`, sql`${actionRunSchema.result}->>'requestId' = ${String(requestId)}`),
      ...(excludeRunId ? [ne(actionRunSchema.id, excludeRunId)] : []),
    ))
    .orderBy(desc(actionRunSchema.id))
    .limit(5);
  const workerIds = rows.map(r => Number((r.result as Meta | null)?.workerRunId)).filter(n => Number.isInteger(n) && n > 0);
  const statuses = workerIds.length === 0
    ? new Map<number, string>()
    : new Map((await db.select({ id: workerRunSchema.id, status: workerRunSchema.status }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.id, workerIds)))).map(w => [w.id, w.status]));
  return rows.map(r => ({ id: r.id, status: r.status, executedAt: r.executedAt, result: (r.result ?? null) as Meta | null, workerStatus: statuses.get(Number((r.result as Meta | null)?.workerRunId)) ?? null }));
}

/**
 * Close what a person's start of a request makes moot: its open "Stopped"
 * ask (the recovery's) and any other pending Build card for it. Each closes
 * with the reason, so the queue says what happened instead of waiting.
 * @param orgId - The workspace.
 * @param request - The request being started.
 * @param request.id
 * @param request.meta
 * @param opts - Who started it, and the run doing so (never closed).
 * @param opts.by
 * @param opts.runId
 */
export async function settleMootDecisions(orgId: string, request: { id: number; meta: Meta }, opts: { by: string; runId: number | null }): Promise<{ asks: number[]; cards: number[] }> {
  const { and, eq, ne, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const why = `A person started request #${request.id}${opts.runId ? ` (run #${opts.runId})` : ''}.`;
  const asks: number[] = [];
  const askId = Number((request.meta.recovery as { askId?: unknown } | undefined)?.askId);
  if (Number.isInteger(askId) && askId > 0) {
    const { getAsk, supersedeAsk } = await import('@/services/AskService');
    const ask = await getAsk(orgId, askId);
    if (ask && ask.status === 'open') {
      await supersedeAsk(orgId, askId, `${why} This stop is answered.`);
      asks.push(askId);
    }
  }
  const pending = await db.select({ id: actionRunSchema.id }).from(actionRunSchema).where(and(
    eq(actionRunSchema.orgId, orgId),
    eq(actionRunSchema.actionId, DISPATCH_ACTION_ID),
    eq(actionRunSchema.status, 'pending'),
    sql`${actionRunSchema.input}->>'requestId' = ${String(request.id)}`,
    ...(opts.runId ? [ne(actionRunSchema.id, opts.runId)] : []),
  ));
  const cards: number[] = [];
  if (pending.length > 0) {
    const { rejectAction } = await import('@/services/ActionService');
    for (const row of pending) {
      await rejectAction(row.id, orgId, `${why} This card is moot.`, { reviewedBy: opts.by }).catch(() => undefined);
      cards.push(row.id);
    }
  }
  return { asks, cards };
}

/**
 * The refusal for a start of a request that is already building, or null.
 * @param orgId - Tenant.
 * @param requestId - The request, when the start names one.
 * @param opts - What is asking.
 * @param opts.trigger - The new start's trigger.
 * @param opts.excludeRunId - The run asking, when it is one.
 */
export async function buildUnderway(orgId: string, requestId: number | undefined, opts: { trigger?: string | null; excludeRunId?: number } = {}): Promise<string | null> {
  if (!requestId) {
    return null;
  }
  return underwayRefusal(await earlierStarts(orgId, requestId, opts.excludeRunId), { trigger: opts.trigger });
}

/**
 * A start the factory made on its own, as opposed to one a person made or
 * approved. Only these count toward the automatic-attempt limit.
 * @param input - The dispatch input.
 * @param ctx - The execution context; a person approving makes it theirs.
 */
function isAutomatic(input: z.infer<typeof dispatchInput>, ctx: ActionContext): boolean {
  return Boolean(input.trigger || input.autoRetryOf) && !ctx.reviewedBy;
}

export const factoryDispatchAction: Action<typeof dispatchInput> = {
  id: DISPATCH_ACTION_ID,
  name: 'Start the build',
  description: 'Approve an engineering task (and its architecture plan, when named) and send it to the engineer that runs on the external worker. Takes the engineering_task record id, OR carries the contract itself (contract + requestId) and creates the task on approval; the contract must carry an objective, acceptance, allowed paths, required checks, a risk class and a repo. Spends money on a model: a person approves it. Undo cancels the run while no worker has claimed it.',
  inputSchema: dispatchInput,
  grant: 'factory_write',
  external: true,
  dedupKeyFor: input => `${DISPATCH_ACTION_ID}:${input.taskId ?? `request-${input.requestId}`}${input.autoRetryOf ? `:retry-${input.autoRetryOf}` : ''}${triggerKey(input)}`,
  // ONE BUILD CARD PER REQUEST: a card's own label hash never splits one
  // request into two runs, and a model cannot write the factory's triggers.
  ownsDedupKey: true,
  internalInput: ['trigger', 'recoveryOfRun', 'recoveryClass', 'autoRetryOf', 'planFirst', 'replan'],
  policyKeyFor: input => (input.autoRetryOf ? `${DISPATCH_ACTION_ID}.retry` : input.trigger ? `${DISPATCH_ACTION_ID}.${TRIGGER_KEY[input.trigger]}` : DISPATCH_ACTION_ID),
  // Already building, planning or starting: answered with the run, never refused.
  async underway(ctx, input) {
    if (!input.requestId) {
      return null;
    }
    const u = underwayNow(await earlierStarts(ctx.orgId, input.requestId), { trigger: input.trigger });
    return u ? { line: u.line, href: u.workerRunId ? `/dashboard/p/runs/${u.workerRunId}` : null } : null;
  },
  async precheck(ctx, input) {
    const { externalWorkersEnabled } = await import('@/services/WorkerRunService');
    if (!externalWorkersEnabled()) {
      return 'External workers are not enabled on this deployment (VOCION_EXTERNAL_WORKERS=1), so nothing can take the build.';
    }
    const underway = await buildUnderway(ctx.orgId, input.requestId, { trigger: input.trigger });
    if (underway) {
      return underway;
    }
    const { task, plan } = await loadAll(ctx, input);
    const types = await factoryTypes(ctx.orgId);
    if (!task || task.typeSlug !== types.task) {
      return `No engineering task #${input.taskId} in this workspace. Carry the contract on this action (contract + requestId) or name a task that exists.`;
    }
    if (!input.taskId && input.requestId) {
      const req = await readRecord(ctx.orgId, input.requestId);
      if (!req || req.typeSlug !== types.request) {
        return `No request #${input.requestId} in this workspace.`;
      }
    }
    // A request whose records name no files is not refused: it is a request
    // that needs a plan to say which, and the dispatch plans (execute).
    const gaps = contractGaps(task.meta).filter(g => !(g === 'allowedPaths' && task.id === 0 && !(plan && planIsApproved(plan.meta))));
    if (gaps.length > 0) {
      return task.id > 0
        ? `Engineering task #${task.id} is not ready to build: it has no ${gaps.join(', ')}. Fill them on the task, then start it.`
        : `This request is not ready to build: nothing says its ${gaps.join(', ')}. Approve a plan that names the files, or give the repo record productPaths for ${str(task.meta, 'product') ?? 'this product'}.`;
    }
    if (input.planId && (!plan || plan.typeSlug !== types.plan)) {
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
    const { task, plan, request, repo } = await loadAll(ctx, input);
    const m = task?.meta ?? {};
    const stale = await stalePlan(plan, repo);
    const gate = stale
      ? { go: false as const, why: `plan #${plan!.id} ${stale.reason}; it is planned again` }
      : task ? await gateFor(task, plan, request, { personApproving: true, planFirst: input.planFirst }) : { go: true as const };
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
      nextAction: !gate.go
        ? `Approving plans first — ${gate.why}. The build starts on its own once the plan is approved.`
        : plan ? 'Approving approves the plan and starts the engineer on the task. Undo works until a worker picks it up.' : 'Approving starts the engineer on the task. Undo works until a worker picks it up.',
      verbs: { approve: 'Start build', reject: 'Not yet' },
    };
  },
  async execute(ctx, input) {
    const { createWorkerRun } = await import('@/services/WorkerRunService');
    const loaded = await loadAll(ctx, input);
    const { request } = loaded;
    let { plan } = loaded;
    let task = loaded.task;
    if (!task) {
      throw new Error(`No engineering task #${input.taskId}.`);
    }
    // Executed twice is impossible: a card approved after another start of
    // the same request took it says which run has it, and starts nothing.
    const underway = await buildUnderway(ctx.orgId, input.requestId ?? (request ? request.id : undefined), { trigger: input.trigger, excludeRunId: ctx.runId });
    if (underway) {
      throw new Error(underway);
    }
    const automatic = isAutomatic(input, ctx);
    const at = new Date().toISOString();
    // BUILD ON A CLOSED REQUEST REOPENS IT (Chris, 2026-09-29, on #246:
    // "Chris said open so open. It needs a plan so plan. Plan is done kickoff
    // build."). A person's start is the decision to build it: the verdict it
    // was closed with is cleared (the reason stays in its history), and the
    // build — or its plan first — goes on as for any request. An automatic
    // start never reopens what a person closed.
    // What undo puts back, read before a reopen changes it.
    const before = request ? { state: request.meta.state ?? null, recommendationState: request.meta.recommendationState ?? null, decidedAt: request.meta.decidedAt ?? null, acceptanceFrozenAt: request.meta.acceptanceFrozenAt ?? null } : null;
    const reopened = Boolean(request && !automatic && (REOPENABLE_REQUEST_STATES.has(String(request.meta.state ?? '')) || request.meta.recommendationState === 'rejected'));
    if (request && reopened) {
      const by = ctx.reviewedBy ?? ctx.invokedBy ?? 'a person';
      await writeMeta(ctx.orgId, request.id, { state: 'in_scope', recommendationState: 'approved', reopenedAt: at, reopenedBy: by, decisionReason: `Reopened by Build (${by}) after it was ${String(request.meta.state ?? 'rejected').replace(/_/g, ' ')}.` });
      request.meta = { ...request.meta, state: 'in_scope', recommendationState: 'approved' };
    }
    // A PERSON'S START SETTLES WHAT IT ANSWERS (Chris, 2026-09-29, #201:
    // approving the re-dispatch left "Needs your decision: Stopped …" and a
    // second card standing beside it). Whatever this start goes on to do —
    // build or plan first — the stop is answered and any other Build card
    // for the request is moot.
    if (request && ctx.reviewedBy && !automatic) {
      await settleMootDecisions(ctx.orgId, request, { by: ctx.reviewedBy, runId: ctx.runId ?? null }).catch(() => undefined);
    }
    // A STALE PLAN IS PLANNED AGAIN BEFORE ANYTHING IS SENT: superseded, and
    // the planner is briefed with the paths that are gone and the ones that
    // exist. Undo puts the plan back as it was.
    const stale = await stalePlan(plan, loaded.repo);
    let supersededPlan: { id: number; status: unknown } | null = null;
    if ((stale || input.replan) && plan) {
      const { replanBrief, staleFailure } = await import('@/services/factory/recovery');
      supersededPlan = { id: plan.id, status: plan.meta.status ?? null };
      await supersedePlan(ctx.orgId, plan.id, stale ? `it ${stale.reason.replace(/^it /, '')}` : `QA sent the build back to planning: ${input.replan}`, at);
      plan = null;
      if (request) {
        const why = (stale
          ? `plan #${supersededPlan.id} is stale; ${replanBrief(staleFailure(stale))}`
          : `QA sent the build of plan #${supersededPlan.id} back to planning: ${input.replan}`).slice(0, 1000);
        const { startPlanning } = await import('@/services/factory/carry');
        const planning = await startPlanning(ctx.orgId, { request, plan: null, why, counted: automatic, trigger: input.trigger ?? (input.autoRetryOf ? 'retry' : null), by: ctx.reviewedBy ?? ctx.invokedBy ?? 'a person', at });
        return { planning: true, workerRunId: null, requestId: request.id, record: { objectType: request.typeSlug, id: request.id }, planId: planning.planId, why, via: planning.via, previousRecovery: planning.previous, supersededPlan, ...(reopened && before ? { previousRequestState: before.state, previousRequest: { recommendationState: before.recommendationState } } : {}) };
      }
    }
    // BUILD IS ONE PATH THROUGH THE PLAN GATE (backlog 038: run 401 went out
    // with a contract spanning two packages and the worker refused it, "plan
    // is required"). The rule the worker enforces is read here first; a
    // required plan with none approved does not create a run — it plans, and
    // the approved plan dispatches its own build.
    const noPaths = list(task.meta, 'allowedPaths').length === 0 && !(plan && (ctx.reviewedBy || planIsApproved(plan.meta)));
    const gate = noPaths
      ? { go: false as const, why: 'nothing on the records says which files the change may touch' }
      : await gateFor(task, plan, request, { personApproving: Boolean(ctx.reviewedBy), planFirst: input.planFirst });
    if (!gate.go) {
      if (!request) {
        throw new Error(`A plan is required before this builds (${gate.why}), and task #${task.id} names no request to plan.`);
      }
      const { startPlanning } = await import('@/services/factory/carry');
      const planning = await startPlanning(ctx.orgId, { request, plan, why: gate.why, counted: automatic, trigger: input.trigger ?? (input.autoRetryOf ? 'retry' : null), by: ctx.reviewedBy ?? ctx.invokedBy ?? 'a person', at });
      return { planning: true, workerRunId: null, requestId: request.id, record: { objectType: request.typeSlug, id: request.id }, planId: planning.planId, why: gate.why, via: planning.via, previousRecovery: planning.previous, supersededPlan, ...(reopened && before ? { previousRequestState: before.state, previousRequest: { recommendationState: before.recommendationState } } : {}) };
    }
    let createdTaskId: number | null = null;
    if (!input.taskId) {
      const { createBusinessObject } = await import('@/services/BusinessObjectService');
      const { title, ...rest } = task.meta as Meta & { title?: string };
      const created = await createBusinessObject({ typeSlug: task.typeSlug, title: String(title ?? task.title), status: 'active', metadata: { ...rest, requestId: input.requestId, productSlug: request ? str(request.meta, 'product') : undefined, status: 'ready', ...(input.autoRetryOf ? { autoRetryOf: input.autoRetryOf } : {}), dispatchTrigger: input.trigger ?? (input.autoRetryOf ? 'retry' : 'person'), ...(input.recoveryOfRun ? { recoveryOfRun: input.recoveryOfRun, recoveryClass: input.recoveryClass ?? null } : {}) } } as never, ctx.orgId, ctx.reviewedBy ?? ctx.invokedBy ?? 'system');
      createdTaskId = (created as { id: number }).id;
      task = { ...task, id: createdTaskId };
      // THE WORKER'S KEY on the task it will report to (2026-09-26: run 357
      // upserted a second engineering_task by `factory` / `task:<task_id>`
      // and the dispatched one stayed "dispatched" forever). Same id the
      // contract carries, so claimed / completed land on this record.
      const product = request ? str(request.meta, 'product') : null;
      const workerTaskId = str(task.meta, 'taskId') ?? `${product ?? 'product'}-t${createdTaskId}`;
      const { and, eq } = await import('drizzle-orm');
      const { db } = await import('@/libs/DB');
      const { businessObjectSchema } = await import('@/models/Schema');
      await db.update(businessObjectSchema)
        .set({ externalSystem: 'factory', externalId: `task:${workerTaskId}`, status: 'dispatched' })
        .where(and(eq(businessObjectSchema.orgId, ctx.orgId), eq(businessObjectSchema.id, createdTaskId)));
      // The attempt QA sent back is superseded by this one, not still open:
      // abandoned is what the rework rollup counts, which is what it was.
      const previousTaskId = typeof task.meta.previousTaskId === 'number' ? task.meta.previousTaskId : null;
      if (previousTaskId) {
        const { sql } = await import('drizzle-orm');
        await db.update(businessObjectSchema)
          .set({ status: 'abandoned', metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ status: 'abandoned', supersededBy: createdTaskId })}::jsonb`, updatedAt: new Date() })
          .where(and(eq(businessObjectSchema.orgId, ctx.orgId), eq(businessObjectSchema.id, previousTaskId)));
        const { recomputeRollupsForObject } = await import('@/services/objects/rollups');
        await recomputeRollupsForObject(ctx.orgId, previousTaskId).catch(() => undefined);
        // Its pull request closes now, naming this attempt, rather than
        // waiting for the sweep (services/factory/supersededPulls.ts).
        void import('@/services/factory/supersededPulls').then(m => m.closeSupersededPulls(ctx.orgId)).catch(() => undefined);
      }
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
      modelPolicy: await seatModelPolicy(ctx.orgId, agentSlug),
    });
    const capCents = typeof task.meta.tokenBudget === 'number' ? Math.round(task.meta.tokenBudget * 100) : null;
    const run = await createWorkerRun({ orgId: ctx.orgId, agentSlug, input: { task: contract, record: { id: task.id, type: task.typeSlug } }, capCents, createdBy: approvedBy });
    const previousTask = { status: task.meta.status ?? null, workerRunId: task.meta.workerRunId ?? null };
    await writeMeta(ctx.orgId, task.id, { status: 'dispatched', workerRunId: run.id, ...(plan ? { planId: plan.id } : {}) });
    let previousRecovery: unknown = null;
    if (request) {
      // THE COUNT (backlog 038): an automatic start is one attempt of the
      // limit; a person's start begins the count again.
      const { logLine, noteAttempt, personActed, readRecovery } = await import('@/services/factory/recovery');
      previousRecovery = request.meta.recovery ?? null;
      const state = readRecovery(request.meta);
      const recovery = automatic
        ? noteAttempt(state, { at, kind: 'build', trigger: input.trigger ?? 'retry', runId: run.id, taskId: task.id, line: input.reason })
        : logLine(personActed(state, at, `Build started by ${approvedBy}.`), `Run #${run.id} queued for task #${task.id}.`, at, run.id);
      // A BUILD ANSWERS THE STOP (2026-09-30, #246: a stop ask from 00:56 stayed
      // open after the build started again at 01:48, and the sweep then read
      // the request as waiting on a person). Whatever started this build, the
      // request's open stop asks are superseded by it.
      await supersedeStopAsks(ctx.orgId, request.id, input.reason ?? `Building again (run #${run.id}).`).catch(() => undefined);
      // The card was the decision: the acceptance is frozen as the contract
      // and the recommendation is approved, in the same action.
      await writeMeta(ctx.orgId, request.id, {
        state: 'building',
        recommendationState: 'approved',
        decidedAt: approvedAt,
        ...(request.meta.acceptanceFrozenAt ? {} : { acceptanceFrozenAt: approvedAt }),
        recovery,
      });
    }
    return { workerRunId: run.id, agentSlug, taskId: task.id, createdTaskId, planId: plan?.id ?? null, requestId: request?.id ?? null, ...(request ? { record: { objectType: request.typeSlug, id: request.id } } : {}), previousTask, previousPlan, previousRequestState: before ? before.state : null, previousRequest: before ? { recommendationState: before.recommendationState, decidedAt: before.decidedAt, acceptanceFrozenAt: before.acceptanceFrozenAt } : null, previousRecovery };
  },
  async undo(ctx, _input, result) {
    // Planning started instead of a build: nothing ran, so the request goes
    // back to where it stood. A plan already being written stays a draft.
    if (result.planning) {
      if (result.requestId) {
        await writeMeta(ctx.orgId, Number(result.requestId), { recovery: result.previousRecovery ?? null });
      }
      const sp = result.supersededPlan as { id?: number; status?: unknown } | null | undefined;
      if (sp?.id) {
        await writeMeta(ctx.orgId, sp.id, { status: sp.status ?? 'approved', supersededAt: null, supersededReason: null });
      }
      return { stoppedPlanning: true };
    }
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
      await writeMeta(ctx.orgId, Number(result.requestId), { state: result.previousRequestState, ...((result.previousRequest ?? {}) as Meta), ...(result.previousRecovery !== undefined ? { recovery: result.previousRecovery } : {}) });
    }
    return { cancelledRun: runId };
  },
};

/**
 * Supersede a request's open factory stop asks (`factory-recovery:<id>:…`).
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param note - What answered them.
 */
async function supersedeStopAsks(orgId: string, requestId: number, note: string): Promise<void> {
  const { and, eq, like } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { askSchema } = await import('@/models/Schema');
  const { supersedeAsk } = await import('@/services/AskService');
  const open = await db.select({ id: askSchema.id }).from(askSchema).where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `factory-recovery:${requestId}:%`)));
  for (const ask of open) {
    await supersedeAsk(orgId, ask.id, note);
  }
}
