/**
 * THE PIPELINE'S OWNER FIXES THE PIPELINE ITSELF (backlog 049; Chris,
 * 2026-09-30: "a red CI, a failed deploy or an unhealthy environment gets
 * noticed, diagnosed and fixed, or escalated once with its reason, without a
 * person"). When the fix is in the pipeline — a default branch red in its
 * workflows, a CI that could not run even after a re-run, an environment its
 * recovery could not bring back — the seat that owns the pipeline is asked to
 * fix it, and what it did is read back, never taken on its word:
 *
 *   raisePipelineFix     `pipeline.needs_fix`, one per record and attempt, at
 *                        most PIPELINE_FIX_ATTEMPTS; past that, one ask.
 *   pipelineFixEnded     the seat's run ended: a move it made (a pipeline
 *                        change, a re-run, a dispatch) is on the action rail,
 *                        or the stop goes to a person once, with the reason.
 *   reconcileChanges     every five minutes, each open pipeline change is read
 *                        back from GitHub: green merges it under
 *                        `git.merge.pipeline` (Undo opens the revert), red goes
 *                        back to the seat carrying the failing checks, merged
 *                        and closed are written where the record is read.
 *   watchUnanswered      a fix asked for whose run never acted or never ended
 *                        is a stop too: nothing waits on the pipeline silently.
 *
 * No seat, type or product is named here: the owner is the automation's
 * `do.input.owner`, the record is whatever the change says it answers, and a
 * record's lines go on its own account (`carry.noteOnRequest`).
 */

import type { GithubCheckRun, GithubPullRequest } from '@/libs/github/events';

type Meta = Record<string, unknown>;
type Result = { requestId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);

/** How many times the seat that owns the pipeline is asked to fix one thing before a person is. */
export const PIPELINE_FIX_ATTEMPTS = 2;
/** A pipeline change with no checks at all merges after this long: the repository runs none on it. */
export const NO_CHECKS_WAIT_MS = 15 * 60_000;
/** A fix asked for with no move and no end after this long is a stop. */
export const UNANSWERED_FIX_MS = 45 * 60_000;
/** What counts as the seat having acted on a fix: its moves on the action rail. */
export const PIPELINE_MOVES = ['github.open_pull', 'github.rerun_failed_jobs', 'github.dispatch_workflow'] as const;

/**
 * The seat's display name, for the lines a person reads.
 * @param orgId
 * @param owner
 */
async function seatName(orgId: string, owner: string | null): Promise<string> {
  if (!owner) {
    return 'The pipeline\'s owner';
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { agentSchema } = await import('@/models/Schema');
  const [row] = await db.select({ name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, owner))).limit(1);
  return row?.name?.trim() || 'The pipeline\'s owner';
}

async function noteLine(orgId: string, recordId: number | null, line: string, runId: number | null = null): Promise<void> {
  if (recordId) {
    const { noteOnRequest } = await import('./carry');
    await noteOnRequest(orgId, recordId, line, runId).catch(() => undefined);
  }
}

const SYSTEM = (orgId: string, owner: string | null) => ({ kind: 'agent' as const, id: `agent:${owner ?? 'system'}`, scope: { orgId }, grants: ['*'], autonomy: 2 });

/** What a record carries about the fix its pipeline owner was asked for. */
export type PipelineWork = { attempt: number; raisedAt: string; cause: string; why: string; url: string; owner: string | null; requestId: number | null; stoppedAt?: string | null; askId?: number | null };

export function readWork(meta: Meta): PipelineWork | null {
  const w = obj(meta.pipelineWork);
  return w && typeof w.attempt === 'number' ? w as unknown as PipelineWork : null;
}

/**
 * Ask the seat that owns the pipeline to fix it: `pipeline.needs_fix`, one per
 * record and attempt. Past the attempts, one ask to a person instead.
 * @param orgId - The workspace.
 * @param o - What needs fixing.
 * @param o.recordId - The record the fix answers (a fix request, an environment).
 * @param o.requestId - The request a stop goes on; the record itself when omitted.
 * @param o.title - The record's title.
 * @param o.repo - `owner/name`.
 * @param o.branch - Where the fix lands.
 * @param o.cause - Why it is the pipeline's (`main_broken`, `infra`, `change_failed`, `unhealthy`).
 * @param o.why - One line from the diagnosis.
 * @param o.failing - The failing checks or steps.
 * @param o.url - The evidence to read first.
 * @param o.change - The pipeline change already open, to add to.
 * @param o.change.url - Its pull request.
 * @param o.change.branch - Its branch.
 * @param o.owner - The seat that owns the pipeline.
 * @param o.now - The clock.
 */
export async function raisePipelineFix(orgId: string, o: { recordId: number; requestId?: number | null; title: string; repo: string; branch: string; cause: string; why: string; failing: string; url: string; change?: { url: string; branch: string } | null; owner: string | null; now?: Date }): Promise<{ raised: boolean; attempt: number; line: string; askId?: number }> {
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const record = await readRecord(orgId, o.recordId);
  const prior = record ? readWork(record.meta) : null;
  const attempt = (prior?.attempt ?? 0) + 1;
  const now = (o.now ?? new Date()).toISOString();
  const requestId = o.requestId ?? prior?.requestId ?? o.recordId;
  const name = await seatName(orgId, o.owner);
  if (attempt > PIPELINE_FIX_ATTEMPTS) {
    if (prior?.stoppedAt) {
      return { raised: false, attempt: prior.attempt, line: `Already with a person (ask #${prior.askId ?? '?'}).` };
    }
    const { askId, line } = await escalatePipeline(orgId, { recordId: o.recordId, requestId, why: `${name} tried ${PIPELINE_FIX_ATTEMPTS} times and it is still ${o.cause === 'unhealthy' ? 'unhealthy' : 'red'}: ${o.why}`, unblock: 'fix what the pipeline needs (a secret, a permission, a service), then approve to check it again', owner: o.owner, evidenceUrl: o.url, now });
    return { raised: false, attempt: prior!.attempt, line, askId };
  }
  const work: PipelineWork = { attempt, raisedAt: now, cause: o.cause, why: o.why.slice(0, 500), url: o.url, owner: o.owner, requestId, stoppedAt: null, askId: null };
  await writeMeta(orgId, o.recordId, { pipelineWork: work });
  const { emitEvent, PIPELINE_NEEDS_FIX } = await import('@/services/EventService');
  const payload: import('@/services/EventService').PipelineNeedsFixPayload = {
    recordId: o.recordId,
    title: o.title,
    repo: o.repo,
    branch: o.branch,
    cause: o.cause,
    why: o.why.slice(0, 500),
    failing: o.failing.slice(0, 300),
    url: o.url,
    attempt,
    attempts: PIPELINE_FIX_ATTEMPTS,
    changeUrl: o.change?.url ?? '',
    changeBranch: o.change?.branch ?? '',
  };
  await emitEvent({ orgId, type: PIPELINE_NEEDS_FIX, payload, dedupeKey: `${PIPELINE_NEEDS_FIX}:${o.recordId}:${attempt}`, invokedBy: `factory:${o.owner ?? 'system'}`, dispatchMode: 'auto' });
  const line = `${name} is fixing the pipeline (attempt ${attempt} of ${PIPELINE_FIX_ATTEMPTS}): ${o.why}`;
  await noteLine(orgId, o.recordId, line);
  return { raised: true, attempt, line };
}

/**
 * The pipeline's owner could not fix it: ONE ask to a person, with every
 * attempt, and the request stopped on it so its page says "Needs you" and the
 * plugin's needs-a-person notification goes out (`factory.stopped`).
 * @param orgId - The workspace.
 * @param o - The stop.
 * @param o.recordId - The record the fix answered.
 * @param o.requestId - The request the stop goes on (or the record itself, when it is not a request).
 * @param o.why - Why it stopped.
 * @param o.unblock - What would unblock it.
 * @param o.owner - The seat that owns the pipeline.
 * @param o.evidenceUrl - What to read first; a pull request or run is re-run when the person approves.
 * @param o.now - When.
 * @param o.key - What makes this stop its own ask; the record's attempt when omitted.
 * @param o.tried - What was tried, when the caller kept its own account of it.
 * @param o.contextUrl - Where the ask opens; the request's feature page when omitted.
 */
export async function escalatePipeline(orgId: string, o: { recordId: number; requestId: number; why: string; unblock: string; owner: string | null; evidenceUrl?: string | null; now?: string; key?: string; tried?: string[]; contextUrl?: string }): Promise<{ askId: number; line: string }> {
  const { readRecord, writeMeta } = await import('@/libs/actions/factory-dispatch');
  const { upsertAsk } = await import('@/services/AskService');
  const request = await readRecord(orgId, o.requestId);
  const record = o.recordId === o.requestId ? request : await readRecord(orgId, o.recordId);
  const types = await (await import('@/libs/factory/types')).factoryTypes(orgId);
  const work = record ? readWork(record.meta) : null;
  const attempts = o.tried ?? await movesSince(orgId, o.owner, work?.raisedAt ? new Date(Date.parse(work.raisedAt) - 6 * 3_600_000) : new Date(0), o.recordId);
  const at = o.now ?? new Date().toISOString();
  const { parsePullUrl } = await import('@/services/agents/tools/githubPullRead');
  const { parseRunUrl } = await import('./githubChecks');
  const rerunnable = o.evidenceUrl && (parsePullUrl(o.evidenceUrl) || parseRunUrl(o.evidenceUrl)) ? o.evidenceUrl : null;
  const line = `Stopped: ${o.why.replace(/[.\s]+$/, '')}. What would unblock it: ${o.unblock}.`;
  const { ask } = await upsertAsk({
    orgId,
    createdBy: `agent:${o.owner ?? 'system'}`,
    ask: {
      kind: 'approval',
      title: `Stopped: ${request?.title ?? `record #${o.requestId}`}`.slice(0, 140),
      body: [
        line,
        attempts.length > 0 ? `**What was tried**\n${attempts.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : 'No move of its own reached GitHub.',
        rerunnable ? 'Approve once it is fixed: the failed jobs run again.' : 'Approve once it is fixed; reject to leave it.',
      ].join('\n\n'),
      sourceRef: `pipeline-stop:${o.recordId}:${o.key ?? work?.attempt ?? 0}`,
      agentSlug: o.owner,
      risk: 'medium',
      options: [
        { id: 'approve', label: 'It is fixed, check again', description: rerunnable ? 'Re-run the failed jobs now.' : 'The next pass reads it again.', recommended: true, ...(rerunnable ? { action: { id: 'github.rerun_failed_jobs', input: { url: rerunnable, reason: `After a person fixed it: ${o.why}`.slice(0, 500) } } } : {}) },
        { id: 'reject', label: 'Leave it', description: 'Nothing runs again.' },
      ],
      objectRefs: [{ type: request?.typeSlug ?? types.request, id: String(o.requestId) }, ...(o.recordId !== o.requestId ? [{ type: record?.typeSlug ?? 'record', id: String(o.recordId) }] : [])],
      decisionCost: 5,
      contextUrl: o.contextUrl ?? `/dashboard/p/feature/${o.requestId}`,
    },
  });
  if (work) {
    await writeMeta(orgId, o.recordId, { pipelineWork: { ...work, stoppedAt: at, askId: ask.id } });
  }
  // Only a request carries a stop as its stage: a record that is not one (an
  // environment, whose own account and product page say it) is not made into work.
  if (request?.typeSlug === types.request) {
    const { stopOnRequest } = await import('./carry');
    await stopOnRequest(orgId, o.requestId, `${line} Ask #${ask.id} is with a person.`, ask.id);
  }
  const { emitEvent, FACTORY_STOPPED } = await import('@/services/EventService');
  const payload: import('@/services/EventService').FactoryStoppedPayload = {
    requestId: o.requestId,
    title: request?.title ?? `Record #${o.requestId}`,
    askId: ask.id,
    why: o.why.replace(/[.\s]+$/, ''),
    unblock: o.unblock,
    line,
    attempts: attempts.length,
    failure: null,
  };
  await emitEvent({ orgId, type: FACTORY_STOPPED, payload, dedupeKey: `${FACTORY_STOPPED}:${o.requestId}:${ask.id}`, invokedBy: `factory:${o.owner ?? 'system'}`, dispatchMode: 'auto' }).catch((err: Error) => {
    console.warn('[pipeline] could not raise factory.stopped', { requestId: o.requestId, error: err.message });
  });
  return { askId: ask.id, line };
}

/**
 * The seat's moves since a moment, as one line each: what it proposed and how it ended.
 * @param orgId - The workspace.
 * @param owner - The seat.
 * @param since - From when.
 * @param recordId - Only moves about this record, when they name one.
 */
async function movesSince(orgId: string, owner: string | null, since: Date, recordId?: number): Promise<string[]> {
  const rows = await moveRows(orgId, owner, since);
  return rows
    .filter(r => recordId === undefined || !r.recordId || r.recordId === recordId)
    .map(r => `${r.actionId} (action #${r.id}): ${r.status}${r.error ? ` — ${r.error.slice(0, 160)}` : ''}`);
}

async function moveRows(orgId: string, owner: string | null, since: Date): Promise<Array<{ id: number; actionId: string; status: string; error: string | null; recordId: number | null }>> {
  const { and, eq, gte, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const rows = await db.select({ id: actionRunSchema.id, actionId: actionRunSchema.actionId, status: actionRunSchema.status, error: actionRunSchema.error, input: actionRunSchema.input, invokedBy: actionRunSchema.invokedBy })
    .from(actionRunSchema)
    .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.actionId, [...PIPELINE_MOVES]), gte(actionRunSchema.createdAt, since)))
    .limit(50);
  return rows
    .filter(r => !owner || r.invokedBy === `agent:${owner}`)
    .map(r => ({ id: r.id, actionId: r.actionId, status: r.status, error: r.error ?? null, recordId: Number((r.input as Meta | null)?.recordId) || null }));
}

/**
 * The seat's run on a fix ended (`automation_run.completed` or
 * `automation_run.failed` of the plugin's `pipeline-fix`): a move it made is on the action rail, or the stop goes to a
 * person once, with what the run said.
 * @param orgId - The workspace.
 * @param payload - The event payload, merged over the job's `do.input` (`owner`).
 */
export async function pipelineFixEnded(orgId: string, payload: Meta): Promise<Result> {
  const runId = Number(payload.automationRunId);
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { automationRunSchema } = await import('@/models/Schema');
  const [run] = Number.isInteger(runId) && runId > 0
    ? await db.select({ input: automationRunSchema.input, startedAt: automationRunSchema.startedAt, result: automationRunSchema.result }).from(automationRunSchema).where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.id, runId))).limit(1)
    : [];
  const recordId = Number((run?.input as Meta | null)?.recordId);
  if (!run || !Number.isInteger(recordId) || recordId <= 0) {
    return { requestId: null, did: 'no record on the run', line: null };
  }
  const owner = str(payload.owner);
  const said = str(payload.error) ? `the run failed: ${str(payload.error)}` : str((run.result as Meta | null)?.summary) ?? str(payload.summary);
  return answerIfUnmoved(orgId, recordId, owner, run.startedAt, said);
}

async function answerIfUnmoved(orgId: string, recordId: number, owner: string | null, since: Date, said: string | null): Promise<Result> {
  const { readRecord } = await import('@/libs/actions/factory-dispatch');
  const record = await readRecord(orgId, recordId);
  const work = record ? readWork(record.meta) : null;
  if (!record || !work || work.stoppedAt) {
    return { requestId: work?.requestId ?? null, did: 'nothing waits', line: null };
  }
  const moved = (await moveRows(orgId, owner, since)).filter(r => !['rejected', 'failed'].includes(r.status) && (!r.recordId || r.recordId === recordId));
  if (moved.length > 0) {
    return { requestId: work.requestId, did: 'acted', line: null };
  }
  const name = await seatName(orgId, owner);
  const { line } = await escalatePipeline(orgId, { recordId, requestId: work.requestId ?? recordId, why: `${name}'s pass on it ended without a fix${said ? ` (${said.slice(0, 200)})` : ''}; it was asked because ${work.why}`, unblock: 'fix what the pipeline needs, then approve to check it again', owner, evidenceUrl: work.url });
  return { requestId: work.requestId, did: 'stopped', line };
}

/**
 * A fix asked for with no move and no end — the run errored, or never started
 * — is a stop, not a wait.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param owner - The seat that owns the pipeline.
 */
export async function watchUnanswered(orgId: string, now: Date, owner: string | null): Promise<Result[]> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const rows = await db.select({ id: businessObjectSchema.id, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.metadata} -> 'pipelineWork' ->> 'raisedAt' is not null`, sql`coalesce(${businessObjectSchema.metadata} -> 'pipelineWork' ->> 'stoppedAt', '') = ''`))
    .limit(25);
  const out: Result[] = [];
  for (const row of rows) {
    const work = readWork((row.meta ?? {}) as Meta);
    const raised = work ? Date.parse(work.raisedAt) : Number.NaN;
    if (!work || !Number.isFinite(raised) || now.getTime() - raised < UNANSWERED_FIX_MS) {
      continue;
    }
    const change = obj(((row.meta ?? {}) as Meta).pipelineChange);
    if (change && str(change.state) === 'open') {
      continue;
    }
    const r = await answerIfUnmoved(orgId, row.id, work.owner ?? owner, new Date(raised), 'no move reached GitHub').catch((err: Error) => ({ requestId: work.requestId, did: 'could not answer', line: err.message }));
    if (r.did !== 'acted' && r.did !== 'nothing waits') {
      out.push(r);
    }
  }
  return out;
}

/** The branch every pipeline change Vocion opens is on (`githubChange.branchFor`). */
const PIPELINE_BRANCH_PREFIX = 'vocion/pipeline-';

/** Where the change reconciler acts on the world, injected in tests. */
export type ChangeDeps = {
  readPull: (orgId: string, url: string) => Promise<{ repo: string; pr: GithubPullRequest; checkRuns: GithubCheckRun[] }>;
  /** Open pull requests on a repository whose branch is one of Vocion's pipeline changes. */
  listPipelinePulls?: (orgId: string, repo: string) => Promise<Array<{ url: string; branch: string; base: string; headSha: string; title: string; createdAt: string }>>;
  proposeMerge: (orgId: string, o: { url: string; title: string; headSha: string; riskClass: string; owner: string | null; why: string; recordId: number }) => Promise<{ runId: number; status: string; error?: string }>;
};

async function defaultChangeDeps(): Promise<ChangeDeps> {
  const gh = await import('./githubChecks');
  return {
    readPull: gh.readPull,
    listPipelinePulls: async (orgId, repo) => {
      const { tokenForRepo } = await import('@/services/agents/tools/githubPullRead');
      const token = await tokenForRepo(orgId, repo);
      if (!token) {
        return [];
      }
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=50`, { headers: { 'authorization': `Bearer ${token}`, 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        return [];
      }
      const pulls = await res.json() as Array<{ html_url: string; title: string; created_at: string; head: { ref: string; sha: string }; base: { ref: string } }>;
      return pulls.filter(p => p.head.ref.startsWith(PIPELINE_BRANCH_PREFIX)).map(p => ({ url: p.html_url, branch: p.head.ref, base: p.base.ref, headSha: p.head.sha, title: p.title, createdAt: p.created_at }));
    },
    proposeMerge: async (orgId, o) => {
      const { proposeAction } = await import('@/services/ActionService');
      const { MERGE_ACTION_ID } = await import('@/libs/actions/mergeAction');
      return await proposeAction({
        orgId,
        actionId: MERGE_ACTION_ID,
        input: {
          title: `Merge ${o.title}`.slice(0, 200),
          headline: 'Every check passed; merging lands the pipeline fix.',
          summary: o.why.slice(0, 1200),
          steps: [{ say: 'Merge the pull request.', url: o.url }, { say: 'The checks behind it run again on the fixed branch.' }],
          evidence: [o.url],
          externalRef: { system: 'github', id: o.url.replace('https://github.com/', ''), url: o.url },
          riskClass: o.riskClass,
          commitSha: o.headSha,
          verdictCommitSha: o.headSha,
          rollback: 'Undo opens the revert pull request; merging the revert takes the change back out.',
        },
        principal: SYSTEM(orgId, o.owner),
        invokedBy: `agent:${o.owner ?? 'system'}`,
        internal: true,
        proposal: { confidence: 0.9, rationale: `A pipeline change with every check green: ${o.why}`.slice(0, 500), agentSlug: o.owner ?? undefined, suggestedDecision: 'approve', suggestedDecisionReason: 'Every check passed on its head; a revert undoes it.' },
      } as never) as { runId: number; status: string; error?: string };
    },
  };
}

/**
 * A PIPELINE CHANGE NOTHING TRACKS IS ADOPTED. Every open pull request on a
 * Vocion pipeline branch, on a repository the workspace keeps a record for
 * (titled owner/name, carrying its checks or product paths), is written on
 * that record when no record tracks it, so the reconcile below merges it on
 * green like any other. squatch-core #148 (2026-10-01) was opened from chat
 * with no record named and sat green, while the reply said it merges itself.
 * @param orgId - Tenant.
 * @param now - The clock.
 * @param list - Reads a repository's open pipeline pull requests.
 */
export async function adoptUntrackedChanges(orgId: string, now: Date, list: NonNullable<ChangeDeps['listPipelinePulls']>): Promise<Result[]> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const { writeMeta } = await import('@/libs/actions/factory-dispatch');
  const repos = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.title} ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'`, sql`(${businessObjectSchema.metadata} ? 'checks' or ${businessObjectSchema.metadata} ? 'productPaths')`)).limit(20);
  const out: Result[] = [];
  for (const repo of repos) {
    const pulls = await list(orgId, repo.title).catch(() => []);
    for (const pull of pulls) {
      const [tracked] = await db.select({ id: businessObjectSchema.id }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.metadata} -> 'pipelineChange' ->> 'url' = ${pull.url}`)).limit(1);
      const current = obj((repo.meta as Meta | null)?.pipelineChange);
      if (tracked || (current && str(current.state) === 'open')) {
        continue;
      }
      await writeMeta(orgId, repo.id, { pipelineChange: { url: pull.url, repo: repo.title, branch: pull.branch, base: pull.base, headSha: pull.headSha, title: pull.title, riskClass: 'pipeline', state: 'open', openedAt: pull.createdAt, pushedAt: pull.createdAt, by: null, adopted: now.toISOString() } });
      await noteLine(orgId, repo.id, `${pull.url.replace('https://github.com/', '')} was open with nothing tracking it; it is tracked here now and merges itself when its checks are green.`);
      out.push({ requestId: repo.id, did: 'adopted', line: null });
      break;
    }
  }
  return out;
}

/**
 * Every open pipeline change, read back from GitHub: green merges, red goes
 * back to its seat, merged and closed are written down.
 * @param orgId - The workspace.
 * @param now - The clock.
 * @param owner - The seat that owns the pipeline.
 * @param deps - Injected in tests.
 */
export async function reconcileChanges(orgId: string, now: Date, owner: string | null, deps?: ChangeDeps): Promise<Result[]> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const { writeMeta } = await import('@/libs/actions/factory-dispatch');
  const d = deps ?? await defaultChangeDeps();
  const adopted = d.listPipelinePulls ? await adoptUntrackedChanges(orgId, now, d.listPipelinePulls).catch(() => []) : [];
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), sql`${businessObjectSchema.metadata} -> 'pipelineChange' ->> 'state' = 'open'`))
    .limit(25);
  if (rows.length === 0) {
    return adopted;
  }
  const { checksAllowMerge } = await import('./githubMerge');
  const out: Result[] = [...adopted];
  for (const row of rows) {
    const meta = (row.meta ?? {}) as Meta;
    const change = obj(meta.pipelineChange)!;
    const url = str(change.url);
    if (!url) {
      continue;
    }
    const work = readWork(meta);
    const seat = str(change.by)?.replace(/^agent:/, '') ?? work?.owner ?? owner;
    const set = async (patch: Meta) => writeMeta(orgId, row.id, { pipelineChange: { ...change, ...patch } });
    // A record that keeps its own pipeline account (an environment) hears it there.
    const note = async (id: number, line: string, runId: number | null = null) => change.noRework === true
      ? (await import('./environments')).noteOnRecord(orgId, id, line, { runId, url })
      : noteLine(orgId, id, line, runId);
    let read: Awaited<ReturnType<ChangeDeps['readPull']>>;
    try {
      read = await d.readPull(orgId, url);
    } catch (err) {
      console.warn('pipeline reconcile: a change could not be read back', { orgId, url, message: (err as Error).message });
      continue;
    }
    const short = url.replace('https://github.com/', '');
    if (read.pr.merged_at) {
      await set({ state: 'merged', mergedAt: read.pr.merged_at, mergeSha: read.pr.merge_commit_sha ?? null });
      const line = `${short} merged${read.pr.merge_commit_sha ? ` at ${read.pr.merge_commit_sha.slice(0, 7)}` : ''}: the pipeline fix is in.`;
      await note(row.id, line);
      out.push({ requestId: row.id, did: 'change merged', line });
      continue;
    }
    if (read.pr.state !== 'open') {
      await set({ state: 'closed', closedAt: read.pr.closed_at ?? now.toISOString() });
      const line = `${short} was closed without merging.`;
      await note(row.id, line);
      out.push({ requestId: row.id, did: 'change closed', line });
      continue;
    }
    const head = read.pr.head.sha;
    const runs = read.checkRuns;
    const pushed = Date.parse(str(change.pushedAt) ?? str(change.openedAt) ?? '') || now.getTime();
    if (runs.length === 0 && now.getTime() - pushed < NO_CHECKS_WAIT_MS) {
      continue;
    }
    if (runs.some(r => r.status !== 'completed')) {
      continue;
    }
    const verdict = checksAllowMerge(runs.map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion ?? null })));
    if (verdict.ok) {
      if (str(change.mergeProposedSha) === head) {
        continue;
      }
      const res = await d.proposeMerge(orgId, { url, title: str(change.title) ?? row.title, headSha: head, riskClass: str(change.riskClass) ?? 'pipeline', owner: seat, why: work?.why ?? str(change.title) ?? row.title, recordId: row.id }).catch((err: Error) => ({ runId: 0, status: 'failed', error: err.message }));
      await set({ headSha: head, mergeProposedSha: head, mergeRunId: res.runId || null, mergeStatus: res.status });
      const line = res.status === 'failed'
        ? `Every check passed on ${short}, but the merge failed: ${res.error ?? 'no reason given'}.`
        : res.status === 'pending'
          ? `Every check passed on ${short}; its merge is on a card for a person (action #${res.runId}).`
          : `Every check passed on ${short}; it was merged (action #${res.runId}, Undo opens the revert).`;
      await note(row.id, line, res.runId || null);
      out.push({ requestId: row.id, did: `change green: merge ${res.status}`, line });
      continue;
    }
    if (str(change.failedSha) === head) {
      continue;
    }
    await set({ headSha: head, failedSha: head });
    const failing = runs.filter(r => !['success', 'neutral', 'skipped'].includes(String(r.conclusion))).map(r => r.name).slice(0, 5).join(', ');
    // A change whose record carries its own recovery (an environment's
    // rollback) is written down, and that recovery takes the next step.
    if (change.noRework === true) {
      const line = `${short} is red (${failing}): ${verdict.why}; it is not merged.`;
      await note(row.id, line);
      out.push({ requestId: row.id, did: 'change red: noted', line });
      continue;
    }
    const again = await raisePipelineFix(orgId, {
      recordId: row.id,
      title: row.title,
      repo: read.repo,
      branch: str(change.base) ?? read.pr.base.ref,
      cause: 'change_failed',
      why: `the pipeline change ${short} is red itself: ${verdict.why}`,
      failing,
      url,
      change: { url, branch: str(change.branch) ?? read.pr.head.ref },
      owner: seat,
      now,
    });
    out.push({ requestId: row.id, did: again.raised ? 'change red: asked again' : 'change red: stopped', line: again.line });
  }
  return out;
}
