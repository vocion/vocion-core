/**
 * PRODUCTION ERRORS ARE WATCHED, AND A DEPLOY THAT CAUSED THEM IS TAKEN BACK
 * (Chris, 2026-10-01: "build the mechanism that creates ability to fix in
 * Vocion, then ability to watch for and proactively recommend & fix"). On
 * that day an API answered 500 to every signed-in call for hours while its
 * deploy read "succeeded", its health check read ok, and Sentry counted 184
 * errors nobody read.
 *
 *   compareRelease  after a deploy (and after the live check), the deployed
 *                   release's errors against the window before it: an issue
 *                   first seen in this release, or one firing at least twice
 *                   as often, is a finding on the environment and the
 *                   release, in plain words.
 *   watchErrors     every ten minutes, each production environment's error
 *                   tracking: an issue past the threshold (20 events in 10
 *                   minutes by default), or any issue on a release deployed in
 *                   the last hour, starts its recovery, one step a pass:
 *
 *     revert   the issue was first seen in the release deployed here, after
 *              it was deployed (`errorCause`): the pull request behind that
 *              release is reverted at once (`github.revert_pull`, done for you
 *              under its trust rule, Undo puts it back). The Release engineer
 *              is woken too, to file the incident with the issue as evidence.
 *     wake     otherwise: `production.error` wakes the Release engineer with
 *              the issue, to file the bug with its stack and recommend the fix
 *              (`debug-a-production-error`).
 *     ask      still firing an hour after the last step: one needs-person ask
 *              on the environment, and nothing more until a person answers.
 *
 * Every step is a line on the environment and on the release it ran on. An
 * issue that goes quiet closes its recovery and says after what. Nothing
 * here names a product, a project or a stage: the records say where each
 * environment's errors go (`observability.sentry`).
 */

import type { EnvironmentRow } from './environments';
import type { DeployCause } from './errorCause';
import type { IssueCount, SentryCredentials, SentryIssue, SentryResult } from '@/libs/sentry/client';
import type { SentryRef } from '@/libs/sentry/reference';

type Meta = Record<string, unknown>;
type Result = { recordId: number | null; did: string; line: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);
const short = (s: string | null | undefined) => s?.slice(0, 7) ?? '?';

/** The defaults an automation's `do.input` may override. */
export const WATCH_DEFAULTS = {
  /** Events in the window that make an issue worth waking someone for. */
  threshold: 20,
  windowMinutes: 10,
  /** A release deployed this recently is watched issue by issue, whatever its count. */
  recentDeployMinutes: 60,
  /** How long a step is given before the next. */
  stepWaitMinutes: 60,
  /** How many issues one pass acts on per environment. */
  issuesPerPass: 3,
};

/** A spike: at least this many times the rate before, and at least SPIKE_MIN events. */
export const SPIKE_FACTOR = 2;
export const SPIKE_MIN = 10;

/** Where the watch and the comparison read and act, injected in tests. */
export type ErrorWatchDeps = {
  sentry: (orgId: string) => Promise<{ ok: true; credentials: SentryCredentials } | { ok: false; message: string }>;
  countErrors: (c: SentryCredentials, q: { project?: string | null; environment?: string | null; release?: string | null; start: Date; end: Date; limit?: number }) => Promise<SentryResult<IssueCount[]>>;
  newIssues: (c: SentryCredentials, q: { project: string; environment: string | null; release: string }) => Promise<SentryResult<SentryIssue[]>>;
  readIssue: (c: SentryCredentials, id: string) => Promise<SentryResult<SentryIssue>>;
  mergedPullFor: (orgId: string, repo: string, sha: string) => Promise<string | null>;
  propose: (orgId: string, o: { actionId: string; input: Meta; owner: string | null; why: string }) => Promise<{ runId: number; status: string; error?: string }>;
  wake: (orgId: string, payload: ProductionErrorPayload) => Promise<void>;
  note: (orgId: string, recordId: number, line: string, o?: { runId?: number | null; url?: string | null; at?: string }) => Promise<void>;
  write: (orgId: string, recordId: number, set: Meta) => Promise<void>;
  releaseFor: (orgId: string, product: string | null, sha: string) => Promise<number | null>;
  escalate: (orgId: string, o: { recordId: number; why: string; tried: string[]; owner: string | null; key: string; now: string; evidenceUrl: string | null }) => Promise<{ askId: number; line: string }>;
  /** Whether an ask is still waiting on a person. */
  askOpen: (orgId: string, askId: number) => Promise<boolean>;
  /** Take back an ask the error no longer needs. */
  supersede: (orgId: string, askId: number, line: string) => Promise<unknown>;
};

/** Payload of `production.error`, which wakes the seat that owns the pipeline. Scalars. */
export type ProductionErrorPayload = {
  environmentId: number;
  environment: string;
  product: string;
  repo: string;
  shortId: string;
  issueUrl: string;
  title: string;
  events: number;
  windowMinutes: number;
  verdict: string;
  why: string;
  /** The pull request behind the issue's first release, when known. */
  pull: string;
  /** The revert already opened for it, when the deploy caused it. */
  revertActionRunId: number;
  releaseId: number;
};

export const PRODUCTION_ERROR_EVENT = 'production.error';

async function defaultDeps(): Promise<ErrorWatchDeps> {
  const client = await import('@/libs/sentry/client');
  const env = await import('./environments');
  return {
    sentry: async orgId => (await import('@/services/sentry/access')).sentryFor(orgId),
    countErrors: client.countErrors,
    newIssues: (c, q) => client.listIssues(c, { project: q.project, environment: q.environment, firstRelease: q.release, statsPeriod: '24h', limit: 20 }),
    readIssue: client.readIssue,
    mergedPullFor: async (orgId, repo, sha) => (await import('./githubChecks')).mergedPullFor(orgId, repo, sha),
    propose: async (orgId, o) => {
      const { proposeAction } = await import('@/services/ActionService');
      return await proposeAction({
        orgId,
        actionId: o.actionId,
        input: o.input,
        principal: { kind: 'agent', id: `agent:${o.owner ?? 'system'}`, scope: { orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: `agent:${o.owner ?? 'system'}`,
        internal: true,
        proposal: { confidence: 0.9, rationale: o.why.slice(0, 500), agentSlug: o.owner ?? undefined, suggestedDecision: 'approve', suggestedDecisionReason: 'The error was first seen in the release this deploy shipped, after it shipped; reverting it takes the error out, and Undo puts the release back.' },
      } as never) as { runId: number; status: string; error?: string };
    },
    wake: async (orgId, payload) => {
      const { emitEvent } = await import('@/services/EventService');
      await emitEvent({ orgId, type: PRODUCTION_ERROR_EVENT, payload: payload as unknown as Meta, dedupeKey: `${PRODUCTION_ERROR_EVENT}:${payload.environmentId}:${payload.shortId}:${payload.revertActionRunId || 'wake'}`, invokedBy: 'factory:error-watch', dispatchMode: 'auto' });
    },
    note: env.noteOnRecord,
    write: async (orgId, id, set) => (await import('@/libs/actions/factory-dispatch')).writeMeta(orgId, id, set),
    releaseFor: async (orgId, product, sha) => {
      const { listBusinessObjects } = await import('@/services/BusinessObjectService');
      const types = await (await import('@/libs/factory/types')).factoryTypes(orgId);
      const { sameCommit } = await import('./errorCause');
      const rows = await listBusinessObjects(orgId, types.release).catch(() => []) as Array<{ id: number; metadata: unknown }>;
      const hit = rows.find((r) => {
        const m = (r.metadata ?? {}) as Meta;
        return sameCommit(str(m.commitSha), sha) && (!product || !str(m.product) || str(m.product) === product);
      });
      return hit?.id ?? null;
    },
    escalate: async (orgId, o) => {
      const { escalatePipeline } = await import('./pipelineChange');
      const { rawRecordPath } = await import('@/libs/workspace/recordHref');
      return escalatePipeline(orgId, { recordId: o.recordId, requestId: o.recordId, why: o.why, unblock: 'fix what production is failing on (or tell the Release engineer which change to take back), then approve to watch it again', owner: o.owner, evidenceUrl: o.evidenceUrl, key: o.key, tried: o.tried, now: o.now, contextUrl: rawRecordPath(o.recordId) });
    },
    askOpen: async (orgId, askId) => ((await (await import('@/services/AskService')).getAsk(orgId, askId))?.status ?? 'open') === 'open',
    supersede: async (orgId, askId, line) => (await import('@/services/AskService')).supersedeAsk(orgId, askId, line),
  };
}

/* ------------------------------------------------------------------ */
/* After a deploy: this release against the window before it           */
/* ------------------------------------------------------------------ */

export type ReleaseErrors = {
  state: 'clean' | 'new' | 'spiking' | 'unread';
  /** One line a person reads. */
  line: string;
  sha: string;
  checkedAt: string;
  issues: Array<{ shortId: string; url: string; title: string | null; events: number; before: number; isNew: boolean }>;
};

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * What the deployed release's errors say against the same stretch of time
 * before it was deployed. Null when the environment tracks no errors.
 * @param orgId - The workspace.
 * @param env - The environment, its `lastDeployedSha` / `lastDeployedAt` being the release.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function compareRelease(orgId: string, env: EnvironmentRow, now: Date = new Date(), deps?: Partial<ErrorWatchDeps>): Promise<ReleaseErrors | null> {
  const { sentryRefOf } = await import('@/libs/sentry/reference');
  const ref = sentryRefOf(env.meta);
  const sha = str(env.meta.lastDeployedSha);
  const at = Date.parse(str(env.meta.lastDeployedAt) ?? '');
  if (!ref || !sha || !Number.isFinite(at)) {
    return null;
  }
  const d = { ...(await defaultDeps()), ...deps };
  const checkedAt = now.toISOString();
  const unread = (why: string): ReleaseErrors => ({ state: 'unread', line: `Errors after ${short(sha)} could not be read from Sentry ${ref.org}/${ref.project}: ${why}`, sha, checkedAt, issues: [] });
  const access = await d.sentry(orgId);
  if (!access.ok) {
    return unread(access.message);
  }
  const c = { ...access.credentials, org: ref.org };
  const span = Math.max(now.getTime() - at, 60_000);
  const [after, before, fresh] = await Promise.all([
    d.countErrors(c, { project: ref.project, environment: ref.environment, release: sha, start: new Date(at), end: now, limit: 20 }),
    d.countErrors(c, { project: ref.project, environment: ref.environment, start: new Date(at - span), end: new Date(at), limit: 50 }),
    d.newIssues(c, { project: ref.project, environment: ref.environment, release: sha }),
  ]);
  if (!after.ok) {
    return unread(after.message);
  }
  const beforeBy = new Map((before.ok ? before.data : []).map(i => [i.shortId, i.events]));
  const newIds = new Set((fresh.ok ? fresh.data : []).map(i => i.shortId));
  const issues = after.data.map(i => ({ shortId: i.shortId, url: `https://${ref.org}.sentry.io/issues/${i.issueId}/`, title: i.title, events: i.events, before: beforeBy.get(i.shortId) ?? 0, isNew: newIds.has(i.shortId) }));
  const findings = issues.filter(i => i.isNew || (i.events >= SPIKE_MIN && i.events >= SPIKE_FACTOR * Math.max(i.before, 1)));
  const name = str(env.meta.slug) ?? env.title;
  const took = minutes(now.getTime() - at);
  if (findings.length === 0) {
    const total = issues.reduce((n, i) => n + i.events, 0);
    return { state: 'clean', line: `No new or spiking error on ${name} since ${short(sha)} deployed ${plural(took, 'minute')} ago${total > 0 ? ` (${plural(total, 'event')} of issues it already had)` : ''}.`, sha, checkedAt, issues };
  }
  const top = findings.slice(0, 3).map(i => `${i.shortId}${i.title ? ` (${i.title.replace(/[:\s]+$/, '')})` : ''} ${i.isNew ? 'is new in this release' : `is firing ${i.before > 0 ? `${Math.round(i.events / i.before)} times as often` : 'where it was quiet'}`}, ${plural(i.events, 'event')} in ${plural(took, 'minute')}`);
  return { state: findings.some(i => i.isNew) ? 'new' : 'spiking', line: `After ${short(sha)} deployed to ${name}: ${top.join('; ')}.`, sha, checkedAt, issues: findings };
}

/**
 * Write a comparison where it is read: `errorsAfterDeploy` on the
 * environment and `errorsAfter` on the release, and a line on each when it
 * found something or could not read.
 * @param orgId - The workspace.
 * @param env - The environment.
 * @param found - The comparison.
 * @param releaseId - The release it ran on, when known.
 * @param deps - Injected in tests.
 */
export async function recordReleaseErrors(orgId: string, env: EnvironmentRow, found: ReleaseErrors, releaseId: number | null, deps?: Partial<ErrorWatchDeps>): Promise<void> {
  const d = { ...(await defaultDeps()), ...deps };
  const url = found.issues[0]?.url ?? null;
  await d.write(orgId, env.id, { errorsAfterDeploy: found });
  if (found.state !== 'clean') {
    await d.note(orgId, env.id, found.line, { url, at: found.checkedAt });
  }
  if (releaseId) {
    await d.write(orgId, releaseId, { errorsAfter: { ...found, environment: str(env.meta.slug) ?? env.title } });
    if (found.state !== 'clean') {
      await d.note(orgId, releaseId, found.line, { url, at: found.checkedAt });
    }
  }
}

/**
 * After a deploy or a live check: compare, and write it on the environment
 * and its release. Never throws; returns what it wrote.
 * @param orgId - The workspace.
 * @param env - The environment, as just deployed.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function checkReleaseErrors(orgId: string, env: EnvironmentRow, now: Date = new Date(), deps?: Partial<ErrorWatchDeps>): Promise<ReleaseErrors | null> {
  try {
    const found = await compareRelease(orgId, env, now, deps);
    if (!found) {
      return null;
    }
    const d = { ...(await defaultDeps()), ...deps };
    const releaseId = await d.releaseFor(orgId, str(env.meta.product), found.sha).catch(() => null);
    await recordReleaseErrors(orgId, env, found, releaseId, deps);
    return found;
  } catch (err) {
    console.warn('error watch: the release comparison failed', { orgId, environmentId: env.id, message: (err as Error).message });
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Every ten minutes: the recovery ladder                              */
/* ------------------------------------------------------------------ */

export type ErrorStep = { kind: 'revert' | 'wake' | 'ask'; at: string; actionRunId?: number | null; status?: string; url?: string | null; error?: string | null };
export type IssueRecovery = { shortId: string; url: string; since: string; events: number; cause: DeployCause['verdict']; line: string; steps: ErrorStep[]; closedAt?: string | null; askId?: number | null };

function readRecoveries(meta: Meta): Record<string, IssueRecovery> {
  const w = obj(meta.errorWatch);
  const issues = obj(w?.issues);
  return (issues ?? {}) as Record<string, IssueRecovery>;
}

/**
 * The issues this pass looks at: past the threshold in the window, or
 * carrying the release deployed in the last hour.
 * @param input - What was counted.
 * @param input.window - Every issue's events in the window.
 * @param input.onRelease - Issues on the newly deployed release, when it is recent.
 * @param input.threshold - Events that make an issue worth acting on.
 */
export function issuesToAct(input: { window: IssueCount[]; onRelease: IssueCount[]; threshold: number }): IssueCount[] {
  const out = new Map<string, IssueCount>();
  for (const i of input.window) {
    if (i.events >= input.threshold) {
      out.set(i.shortId, i);
    }
  }
  for (const i of input.onRelease) {
    if (!out.has(i.shortId)) {
      out.set(i.shortId, i);
    }
  }
  return [...out.values()].sort((a, b) => b.events - a.events);
}

/**
 * One pass over every production environment that names its error tracking.
 * @param orgId - The workspace.
 * @param input - The automation's `do.input`: `owner`, `threshold`, `windowMinutes`.
 * @param now - The clock.
 * @param deps - Injected in tests.
 * @param rows - The environments, injected in tests.
 */
export async function watchErrors(orgId: string, input: Meta = {}, now: Date = new Date(), deps?: Partial<ErrorWatchDeps>, rows?: EnvironmentRow[]): Promise<{ acted: Result[] }> {
  const { sentryRefOf } = await import('@/libs/sentry/reference');
  const envs = (rows ?? await (await import('./environments')).environmentRows(orgId))
    .filter(e => str(e.meta.stage) === 'production' && sentryRefOf(e.meta));
  if (envs.length === 0) {
    return { acted: [] };
  }
  const d = { ...(await defaultDeps()), ...deps };
  const access = await d.sentry(orgId);
  if (!access.ok) {
    // Said once per environment, where it is read, not every ten minutes.
    const acted: Result[] = [];
    for (const env of envs) {
      if (str(obj(env.meta.errorWatch)?.unread) !== access.message) {
        await d.write(orgId, env.id, { errorWatch: { ...obj(env.meta.errorWatch), unread: access.message, readAt: now.toISOString() } });
        await d.note(orgId, env.id, `Errors are not being watched: ${access.message}`, { at: now.toISOString() });
        acted.push({ recordId: env.id, did: 'unread', line: access.message });
      }
    }
    return { acted };
  }
  const opts = {
    owner: str(input.owner),
    threshold: Number(input.threshold) > 0 ? Number(input.threshold) : WATCH_DEFAULTS.threshold,
    windowMinutes: Number(input.windowMinutes) > 0 ? Number(input.windowMinutes) : WATCH_DEFAULTS.windowMinutes,
  };
  const acted: Result[] = [];
  for (const env of envs) {
    try {
      acted.push(...await watchOne(orgId, env, access.credentials, opts, now, d, sentryRefOf(env.meta)!));
    } catch (err) {
      console.warn('error watch: a pass failed', { orgId, environmentId: env.id, message: (err as Error).message });
    }
  }
  return { acted };
}

async function watchOne(orgId: string, env: EnvironmentRow, creds: SentryCredentials, opts: { owner: string | null; threshold: number; windowMinutes: number }, now: Date, d: ErrorWatchDeps, ref: SentryRef): Promise<Result[]> {
  const c = { ...creds, org: ref.org };
  const at = now.toISOString();
  const name = str(env.meta.slug) ?? env.title;
  const sha = str(env.meta.lastDeployedSha);
  const deployedAt = Date.parse(str(env.meta.lastDeployedAt) ?? '');
  const recent = !!sha && Number.isFinite(deployedAt) && now.getTime() - deployedAt < WATCH_DEFAULTS.recentDeployMinutes * 60_000;
  const windowStart = new Date(now.getTime() - opts.windowMinutes * 60_000);
  const [win, onRelease] = await Promise.all([
    d.countErrors(c, { project: ref.project, environment: ref.environment, start: windowStart, end: now, limit: 20 }),
    recent ? d.countErrors(c, { project: ref.project, environment: ref.environment, release: sha, start: new Date(Math.max(deployedAt, now.getTime() - WATCH_DEFAULTS.recentDeployMinutes * 60_000)), end: now, limit: 20 }) : Promise.resolve(null),
  ]);
  if (!win.ok) {
    return [{ recordId: env.id, did: 'unread', line: win.message }];
  }
  const recoveries = readRecoveries(env.meta);
  const counted = new Map(win.data.map(i => [i.shortId, i.events]));
  const out: Result[] = [];
  const save = async (next: Record<string, IssueRecovery>) => {
    await d.write(orgId, env.id, { errorWatch: { issues: next, readAt: at, unread: null } });
  };
  let next = { ...recoveries };

  // An issue whose recovery is open and that has gone quiet closes it.
  for (const rec of Object.values(recoveries)) {
    if (!rec.closedAt && (counted.get(rec.shortId) ?? 0) === 0) {
      const steps = rec.steps.filter(s => s.kind !== 'ask').map(s => (s.kind === 'revert' ? 'the revert' : 'the Release engineer\'s fix'));
      const line = `${rec.shortId} has stopped on ${name}: no event in ${plural(opts.windowMinutes, 'minute')}${steps.length > 0 ? `, after ${steps.join(' and ')}` : ''}.`;
      next = { ...next, [rec.shortId]: { ...rec, closedAt: at } };
      await d.note(orgId, env.id, line, { url: rec.url, at });
      if (rec.askId) {
        await d.supersede(orgId, rec.askId, line).catch(() => undefined);
      }
      out.push({ recordId: env.id, did: `quiet: ${rec.shortId}`, line });
    }
  }

  const candidates = issuesToAct({ window: win.data, onRelease: onRelease?.ok ? onRelease.data : [], threshold: opts.threshold }).slice(0, WATCH_DEFAULTS.issuesPerPass);
  for (const hit of candidates) {
    const prior = next[hit.shortId];
    let open = prior && !prior.closedAt ? prior : null;
    if (open?.askId) {
      // With a person: nothing more until they answer. Answered and still
      // firing, the recovery starts over, once more.
      if (await d.askOpen(orgId, open.askId).catch(() => true)) {
        continue;
      }
      await d.note(orgId, env.id, `${hit.shortId} is still firing on ${name} after ask #${open.askId} was answered; its recovery starts again.`, { url: open.url, at });
      open = null;
    }
    const last = open?.steps.at(-1);
    if (last && now.getTime() - Date.parse(last.at) < WATCH_DEFAULTS.stepWaitMinutes * 60_000) {
      continue;
    }
    const issue = await d.readIssue(c, hit.shortId);
    if (!issue.ok) {
      out.push({ recordId: env.id, did: `unread: ${hit.shortId}`, line: issue.message });
      continue;
    }
    const { deployCauseOf } = await import('./errorCause');
    const cause = deployCauseOf({ shortId: hit.shortId, firstRelease: issue.data.firstRelease ?? null, firstSeen: issue.data.firstSeen, url: issue.data.url }, env.meta);
    const releaseId = sha ? await d.releaseFor(orgId, str(env.meta.product), sha).catch(() => null) : null;
    const rec: IssueRecovery = open ?? { shortId: hit.shortId, url: issue.data.url, since: at, events: hit.events, cause: cause.verdict, line: cause.line, steps: [] };
    const tried = new Set(rec.steps.map(s => s.kind));
    const what = `${hit.shortId} (${issue.data.title.replace(/[:\s]+$/, '')}) on ${name}: ${plural(hit.events, 'event')} in ${plural(opts.windowMinutes, 'minute')}`;
    const notes = async (line: string, o: { runId?: number | null; url?: string | null }) => {
      await d.note(orgId, env.id, line, { ...o, at });
      if (releaseId) {
        await d.note(orgId, releaseId, line, { ...o, at });
      }
    };
    const payload = (revertActionRunId: number, pull: string | null): ProductionErrorPayload => ({
      environmentId: env.id,
      environment: name,
      product: str(env.meta.product) ?? '',
      repo: env.repo ?? '',
      shortId: hit.shortId,
      issueUrl: issue.data.url,
      title: issue.data.title,
      events: hit.events,
      windowMinutes: opts.windowMinutes,
      verdict: cause.verdict,
      why: cause.line,
      pull: pull ?? '',
      revertActionRunId,
      releaseId: releaseId ?? 0,
    });

    // 1. Caused by the last deploy: take it back now, done for you, with Undo.
    if (!tried.has('revert') && cause.verdict === 'last-deploy' && env.repo && sha) {
      const pull = await d.mergedPullFor(orgId, env.repo, sha).catch(() => null);
      if (pull) {
        const res = await d.propose(orgId, { actionId: 'github.revert_pull', input: { url: pull, recordId: env.id, reason: `${what}. ${cause.line} Reverting ${pull.replace('https://github.com/', '')} takes it out.`.slice(0, 600) }, owner: opts.owner, why: cause.line })
          .catch((err: Error) => ({ runId: 0, status: 'failed', error: err.message }));
        const step: ErrorStep = { kind: 'revert', at, actionRunId: res.runId || null, status: res.status, url: pull, ...(res.error ? { error: res.error.slice(0, 300) } : {}) };
        next = { ...next, [hit.shortId]: { ...rec, events: hit.events, steps: [...rec.steps, step] } };
        await save(next);
        const line = res.status === 'failed'
          ? `${what}. ${cause.line} The revert of ${pull.replace('https://github.com/', '')} could not be opened: ${res.error ?? 'no reason given'}; the Release engineer has it.`
          : res.status === 'pending'
            ? `${what}. ${cause.line} → the revert of ${pull.replace('https://github.com/', '')} is on a card for a person (action #${res.runId}).`
            : `${what}. ${cause.line} → revert opened of ${pull.replace('https://github.com/', '')} (action #${res.runId}); it merges on green, and Undo puts the release back.`;
        await notes(line, { runId: res.runId || null, url: pull });
        // The seat files the incident with the issue as evidence; on a failed
        // revert, it is the next step of the recovery.
        await d.wake(orgId, payload(res.status === 'failed' ? 0 : res.runId, pull)).catch(() => undefined);
        out.push({ recordId: env.id, did: `revert ${res.status}: ${hit.shortId}`, line });
        continue;
      }
    }

    // 2. Otherwise: the Release engineer is woken with the issue, to file the bug and recommend the fix.
    if (!tried.has('wake')) {
      const pull = cause.firstRelease && env.repo ? await d.mergedPullFor(orgId, env.repo, cause.firstRelease).catch(() => null) : null;
      const step: ErrorStep = { kind: 'wake', at, url: issue.data.url };
      next = { ...next, [hit.shortId]: { ...rec, events: hit.events, steps: [...rec.steps, step] } };
      await save(next);
      const line = `${what}. ${cause.line} The Release engineer has it, to file the bug with its stack and recommend the fix.`;
      await notes(line, { url: issue.data.url });
      await d.wake(orgId, payload(0, pull)).catch(() => undefined);
      out.push({ recordId: env.id, did: `woke: ${hit.shortId}`, line });
      continue;
    }

    // 3. Still firing after every step: one person, once.
    const triedLines = rec.steps.map(s => `${s.kind === 'revert' ? `revert ${s.url ?? ''}` : 'the Release engineer woken'}${s.actionRunId ? ` (action #${s.actionRunId})` : ''}${s.status ? `: ${s.status}` : ''}${s.error ? ` — ${s.error}` : ''}`);
    const { askId, line } = await d.escalate(orgId, { recordId: env.id, why: `${what}, still, after ${rec.steps.map(s => s.kind).join(' and ')}`, tried: triedLines, owner: opts.owner, key: `errors:${hit.shortId}:${rec.since}`, now: at, evidenceUrl: null });
    next = { ...next, [hit.shortId]: { ...rec, events: hit.events, askId, steps: [...rec.steps, { kind: 'ask', at }] } };
    await save(next);
    await notes(`${line} Ask #${askId}.`, { url: issue.data.url });
    out.push({ recordId: env.id, did: `asked: ${hit.shortId}`, line });
  }
  if (out.length > 0 || obj(env.meta.errorWatch)?.unread) {
    await save(next);
  }
  return out;
}
