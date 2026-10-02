/**
 * THE MERGE, WRITTEN ON THE REQUEST, AND THE RUNS IT STARTED, READ BACK
 * (Chris, 2026-09-30, #269). The pure half — what a delivery is and how it
 * reads — is `libs/factory/delivery.ts`; this half knows the tables and GitHub.
 *
 *   recordMerge        `pr.merged` → every request whose attempt carried that
 *                      pull request gets `delivery` (who merged it, when, the
 *                      merge commit, the GitHub runs on it), and its recovery
 *                      stage settles with a line on its account.
 *   refreshDeliveries  the five-minute reconcile: a merge whose webhook never
 *                      became a delivery is written from the recorded event,
 *                      and runs still going are read again until they finish.
 *
 * Nothing here names a type, a workflow or a seat: an attempt is found by the
 * pull request its record carries (`metadata.prUrl`), its request by the id
 * the attempt names (`metadata.requestId`), and the runs by the merge commit.
 */

import type { Delivery } from '@/libs/factory/delivery';
import { deliveryRunsOf, deliveryStage, readDelivery } from '@/libs/factory/delivery';

type Meta = Record<string, unknown>;
type Result = { requestId: number; did: string };

/** A merge older than this is not read back: its release has landed or never will by this path. */
const WATCH_MS = 48 * 3_600_000;
/** How soon after a merge the runs are read once more: GitHub lists a run a moment after the push. */
const SECOND_READ_MS = 8_000;

/** Where a delivery acts on the world, injected in tests. */
export type DeliveryDeps = {
  runsOn: (orgId: string, repo: string, sha: string) => Promise<Parameters<typeof deliveryRunsOf>[0]>;
  /** A failed run's jobs, for the step that failed; absent, the step is not read. */
  jobs?: (orgId: string, repo: string, runId: number) => Promise<Array<{ name: string; failedStep: string | null }>>;
};

async function defaultDeps(): Promise<DeliveryDeps> {
  const { runJobs, workflowRunsOn } = await import('./githubChecks');
  return { runsOn: workflowRunsOn, jobs: runJobs };
}

/** Conclusions that are not a failure of the work, as `libs/factory/delivery.ts` reads them. */
const NOT_FAILED = new Set(['success', 'skipped', 'neutral', 'cancelled']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * "PR #141" from a pull request URL.
 * @param url - The URL.
 */
function prOf(url: string): string | null {
  const n = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1];
  return n ? `PR #${n}` : null;
}

/**
 * The records whose attempt carried this pull request, and the requests they name.
 * @param orgId - Tenant.
 * @param url - The pull request.
 */
async function attemptsFor(orgId: string, url: string): Promise<Array<{ id: number; requestId: number }>> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const rows = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(
    eq(businessObjectSchema.orgId, orgId),
    sql`${businessObjectSchema.metadata} ->> 'prUrl' = ${url}`,
  ));
  return rows
    .map(r => ({ id: r.id, requestId: Number((r.meta as Meta | null)?.requestId) }))
    .filter(r => Number.isSafeInteger(r.requestId) && r.requestId > 0);
}

/** What a merge Vocion made says beside it, instead of the token's owner. */
export const VOCION_MERGED = 'Vocion';

/**
 * Who merged it, by name: the person who decided the merge card for one of
 * these attempts, when a person did; Vocion and who approved it, when Vocion
 * merged it on its own (an agent seat's merge, or a trust rule); else
 * GitHub's own login.
 *
 * MERGED BY VOCION (run 2, 2026-10-01): a merge Vocion made on the person's
 * token read "Merged by chrisfitkin", as if the person had clicked it. GitHub's
 * `merged_by` is the token's identity; the merge run says who decided it.
 * @param orgId - Tenant.
 * @param attemptIds - The attempts that carried the pull request.
 * @param login - GitHub's `merged_by`, or the pull request's author.
 */
async function mergedByName(orgId: string, attemptIds: number[], login: string | null): Promise<string | null> {
  const { and, desc, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema, agentSchema, userSchema } = await import('@/models/Schema');
  const { decidedByMachine } = await import('@/libs/actions/decider');
  const { MERGE_ACTION_ID } = await import('@/libs/actions/mergeAction');
  if (attemptIds.length === 0) {
    return login;
  }
  const cards = await db.select({ actionId: actionRunSchema.actionId, decidedBy: actionRunSchema.decidedBy, invokedBy: actionRunSchema.invokedBy, proposal: actionRunSchema.proposal }).from(actionRunSchema).where(and(
    eq(actionRunSchema.orgId, orgId),
    eq(actionRunSchema.status, 'done'),
    sql`(${actionRunSchema.input} ->> 'taskId') in (${sql.join(attemptIds.map(id => sql`${String(id)}`), sql`, `)})`,
    sql`${actionRunSchema.decidedBy} is not null`,
  )).orderBy(desc(actionRunSchema.decidedAt)).limit(5);
  const person = cards.map(c => c.decidedBy!).find(by => !decidedByMachine(by));
  if (person) {
    const [u] = await db.select({ name: userSchema.name, email: userSchema.email }).from(userSchema).where(eq(userSchema.id, person)).limit(1);
    if (u) {
      return u.name?.trim() || u.email;
    }
  }
  const machine = cards.find(c => c.actionId === MERGE_ACTION_ID && decidedByMachine(c.decidedBy));
  if (!machine) {
    return login;
  }
  const proposal = (machine.proposal ?? {}) as Meta;
  const seat = str(proposal.agentSlug) ?? [machine.invokedBy, machine.decidedBy].map(by => /^agent:(.+)$/.exec(by ?? '')?.[1]).find(Boolean) ?? null;
  const [agent] = seat
    ? await db.select({ name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, seat))).limit(1)
    : [];
  const approver = agent?.name?.trim() || seat;
  if (approver) {
    return `${VOCION_MERGED} · ${approver} approved`;
  }
  const rule = str(proposal.autoApprovedReason);
  return rule ? `${VOCION_MERGED} · ${rule}` : VOCION_MERGED;
}

/**
 * Read the runs on the merge commit, or keep what is known when GitHub cannot
 * be read (the next pass tries again).
 * @param orgId - Tenant.
 * @param d - The delivery.
 * @param deps - GitHub.
 * @param now - The clock.
 */
async function readRuns(orgId: string, d: Delivery, deps: DeliveryDeps, now: Date): Promise<Delivery> {
  if (!d.repo || !d.mergeSha) {
    return d;
  }
  try {
    const fresh = deliveryRunsOf(await deps.runsOn(orgId, d.repo, d.mergeSha), d.mergeSha);
    // THE STEP THAT FAILED, read once per failed run (2026-10-01, #294: "Deploy
    // run #59 failed" said nothing of which surface; the API image build had).
    const runs = await Promise.all(fresh.map(async (r) => {
      const failed = r.status === 'completed' && !NOT_FAILED.has(r.conclusion ?? '');
      if (!failed) {
        return r;
      }
      const known = d.runs.find(k => k.runId === r.runId && k.failedStep);
      if (known) {
        return { ...r, failedStep: known.failedStep };
      }
      const jobs = deps.jobs ? await deps.jobs(orgId, d.repo!, r.runId).catch(() => []) : [];
      const step = jobs.find(j => j.failedStep)?.failedStep ?? null;
      return step ? { ...r, failedStep: step } : r;
    }));
    return { ...d, runs, runsReadAt: now.toISOString() };
  } catch (err) {
    console.warn('[delivery] the runs on a merge could not be read', { orgId, repo: d.repo, sha: d.mergeSha, message: (err as Error).message });
    return d;
  }
}

/**
 * `pr.merged` → the delivery on every request that attempt carried, and the
 * request's recovery settled. Idempotent: a merge already written is only
 * read again.
 * @param orgId - Tenant.
 * @param payload - The `pr.merged` payload (`url`, `repo`, `mergeSha`, `mergedAt`, `mergedBy`, `author`).
 * @param deps - Injected in tests.
 * @param now - The clock.
 */
export async function recordMerge(orgId: string, payload: Meta, deps?: DeliveryDeps, now: Date = new Date()): Promise<Result[]> {
  const url = str(payload.url);
  if (!url) {
    return [];
  }
  const attempts = await attemptsFor(orgId, url);
  if (attempts.length === 0) {
    return [];
  }
  const d = deps ?? await defaultDeps();
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const { settleOnMerge } = await import('./carry');
  const out: Result[] = [];
  for (const requestId of [...new Set(attempts.map(a => a.requestId))]) {
    const request = await readRecord(orgId, requestId);
    if (!request) {
      continue;
    }
    // A request its release already carried is history, not a delivery to watch.
    if (str(request.meta.shippedAt)) {
      continue;
    }
    const known = readDelivery(request.meta);
    if (known?.prUrl === url) {
      out.push({ requestId, did: 'already recorded' });
      continue;
    }
    const by = await mergedByName(orgId, attempts.filter(a => a.requestId === requestId).map(a => a.id), str(payload.mergedBy) ?? str(payload.author));
    const base: Delivery = {
      prUrl: url,
      pr: prOf(url),
      repo: str(payload.repo),
      mergedAt: str(payload.mergedAt) ?? now.toISOString(),
      mergedBy: by,
      mergeSha: str(payload.mergeSha),
      runs: [],
      runsReadAt: null,
    };
    const delivery = await readRuns(orgId, base, d, now);
    await writeMeta(orgId, requestId, { delivery });
    const mergedLine = `Merged ${base.pr ?? url}${by ? ` by ${by}` : ''}; the runs it started on GitHub carry it to the release.`;
    await settleOnMerge(orgId, requestId, mergedLine);
    const { markStatus } = await import('@/services/objects/statusField');
    await markStatus(orgId, requestId, 'merged', { line: mergedLine });
    out.push({ requestId, did: 'recorded' });
    // GitHub lists a run a moment after the push: read once more shortly,
    // off the event's path. The reconcile keeps it current after that.
    if (delivery.runs.length === 0 && !deps) {
      setTimeout(() => {
        void refreshOne(orgId, requestId, d, new Date()).catch(() => undefined);
      }, SECOND_READ_MS);
    }
  }
  return out;
}

/**
 * Read one request's runs again and write them when they moved.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param deps - GitHub.
 * @param now - The clock.
 */
async function refreshOne(orgId: string, requestId: number, deps: DeliveryDeps, now: Date): Promise<boolean> {
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const request = await readRecord(orgId, requestId);
  const d = request ? readDelivery(request.meta) : null;
  if (!d) {
    return false;
  }
  const next = await readRuns(orgId, d, deps, now);
  if (JSON.stringify(next.runs) === JSON.stringify(d.runs)) {
    return false;
  }
  await writeMeta(orgId, requestId, { delivery: next });
  return true;
}

/**
 * The reconcile's half (every five minutes): a merge Vocion recorded as an
 * event but never wrote as a delivery is written now, and the runs of every
 * delivery still going are read again until they finish.
 * @param orgId - Tenant.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function refreshDeliveries(orgId: string, now: Date = new Date(), deps?: DeliveryDeps): Promise<Result[]> {
  const { and, desc, eq, gt, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema, eventLogSchema } = await import('@/models/Schema');
  const { PR_MERGED } = await import('@/libs/github/events');
  const d = deps ?? await defaultDeps();
  const since = new Date(now.getTime() - WATCH_MS);
  const out: Result[] = [];

  // 1. Merges heard, not yet written on their request.
  const merges = await db.select({ payload: eventLogSchema.payload }).from(eventLogSchema).where(and(
    eq(eventLogSchema.orgId, orgId),
    eq(eventLogSchema.type, PR_MERGED),
    gt(eventLogSchema.createdAt, since),
  )).orderBy(desc(eventLogSchema.createdAt)).limit(25);
  for (const m of merges) {
    for (const r of await recordMerge(orgId, (m.payload ?? {}) as Meta, d, now)) {
      if (r.did === 'recorded') {
        out.push({ requestId: r.requestId, did: 'merge recorded by the reconcile' });
      }
    }
  }

  // 2. Deliveries whose runs have not finished, were never read, or failed —
  // a failed run is read again, because the answer to it is a re-run of the
  // same run (2026-10-01, #294), and a re-run that passes is the deploy.
  const open = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(
    eq(businessObjectSchema.orgId, orgId),
    sql`${businessObjectSchema.metadata} ? 'delivery'`,
    sql`coalesce(${businessObjectSchema.metadata} ->> 'state', '') <> 'shipped'`,
    sql`(${businessObjectSchema.metadata} -> 'delivery' ->> 'mergedAt') > ${since.toISOString()}`,
  )).limit(25);
  for (const row of open) {
    const delivery = readDelivery((row.meta ?? {}) as Meta);
    if (!delivery || !['deploying', 'unread', 'failed'].includes(deliveryStage(delivery))) {
      continue;
    }
    if (await refreshOne(orgId, row.id, d, now)) {
      out.push({ requestId: row.id, did: 'runs read again' });
    }
  }
  return out;
}
