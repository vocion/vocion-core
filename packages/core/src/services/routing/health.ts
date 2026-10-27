/**
 * IS JEV LIVE? (ADR 0006, "Health"). One read per decision Jev makes —
 * factory routing, an agent turn's model and effort, who answers a first
 * message, the duplicate check — from the records each already writes:
 *
 *   - factory routing: `engine_run.route_detail`;
 *   - agent turns: `model_call.route_detail`, one per turn (by trace);
 *   - who answers: `conversation_message.routing_json -> 'jev'`;
 *   - duplicates: `record_duplicate_check` rows judged by Jev.
 *
 * Each decision is sorted by what happened (`jevOutcomeOf`): Jev's answer was
 * used, Jev answered but code did not act on it (unsure), or the call failed —
 * a rejected key (HTTP 401/403), rate limited, another HTTP error, a timeout,
 * unreachable, a malformed answer — or Jev was not asked (breaker open, a key
 * that will not decrypt, nothing to choose). Sorted from the stored reason, so
 * decisions logged before this file existed count too.
 *
 * Beside it, the outcomes the system already records (`jevOutcomes`): Undo on
 * duplicate links, another agent answering after a pick, and factory runs'
 * pull requests, QA verdicts, merges, reverts and reruns. Counts only: no
 * holdout, no calibration (paused, ADR 0006 roadmap).
 */

import type { SpendScope } from '@/services/spend/spend';
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { conversationMessageSchema, conversationSchema, engineRunSchema, modelCallSchema, projectSchema, recordDuplicateCheckSchema } from '@/models/Schema';

export type JevDecisionType = 'agent' | 'duplicate' | 'factory' | 'turn';

/** What happened to one decision. */
export type JevOutcome
  = | 'used' // Jev answered and its answer was acted on
    | 'unsure' // Jev answered; code did not act on it (confidence, `none`, a pick it may not take)
    | 'auth' // the key was rejected (HTTP 401 or 403)
    | 'rate_limited' // HTTP 429
    | 'http_error' // any other HTTP error
    | 'timeout'
    | 'unreachable'
    | 'bad_response' // an answer that is not the documented shape
    | 'breaker' // skipped after failures in a row
    | 'config' // the saved key will not decrypt
    | 'skipped'; // not asked: nothing to choose between

export const JEV_OUTCOMES: readonly JevOutcome[] = ['used', 'unsure', 'auth', 'rate_limited', 'http_error', 'timeout', 'unreachable', 'bad_response', 'breaker', 'config', 'skipped'];
/** The outcomes that mean the call to Jev failed. */
export const JEV_FAILURES: ReadonlySet<JevOutcome> = new Set(['auth', 'rate_limited', 'http_error', 'timeout', 'unreachable', 'bad_response']);

/**
 * Sort one decision from what it logged. Pure.
 * @param fallback - Why Jev's answer was not used, or null when it was.
 * @param asked - Whether Jev was called.
 */
export function jevOutcomeOf(fallback: string | null, asked: boolean): JevOutcome {
  if (fallback === null || fallback === '') {
    return 'used';
  }
  const f = fallback;
  if (/HTTP 40[13]\b/.test(f)) {
    return 'auth';
  }
  if (/HTTP 429\b/.test(f)) {
    return 'rate_limited';
  }
  if (/HTTP \d{3}\b/.test(f)) {
    return 'http_error';
  }
  if (/no answer within/.test(f)) {
    return 'timeout';
  }
  if (/could not be reached/.test(f)) {
    return 'unreachable';
  }
  if (/carried no answers|answer was missing or not a choice|answered none of the questions/.test(f)) {
    return 'bad_response';
  }
  if (/three times in a row|breaker open/.test(f)) {
    return 'breaker';
  }
  if (/could not be decrypted/.test(f)) {
    return 'config';
  }
  return asked ? 'unsure' : 'skipped';
}

/** One logged decision, as the health read needs it. */
export type JevSample = { at: Date; asked: boolean; fallback: string | null; latencyMs: number | null; version: string | null };

export type JevDecisionHealth = {
  type: JevDecisionType;
  /** Decisions logged while a key was set. */
  decisions: number;
  /** Jev was called. */
  asked: number;
  /** Jev answered (used or unsure). */
  answered: number;
  used: number;
  failed: number;
  byOutcome: Record<JevOutcome, number>;
  /** Over the calls Jev answered. */
  latencyMs: { p50: number | null; p95: number | null };
  lastAnsweredAt: string | null;
  lastFailure: { outcome: JevOutcome; reason: string; at: string } | null;
  /** Decisions by question wording, most first. */
  versions: Array<{ version: string; decisions: number }>;
  /** From the newest call: `live` (it answered), `failing` (it failed), `idle` (no calls). */
  status: 'failing' | 'idle' | 'live';
  /** More decisions than were read: the counts are of the newest `JEV_HEALTH_SAMPLE`. */
  sampled: boolean;
};

/** At most this many decisions of each kind are read. */
export const JEV_HEALTH_SAMPLE = 5_000;

const percentile = (sorted: number[], p: number): number | null => (sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!);

/**
 * One decision type's health from its samples, newest first. Pure.
 * @param type - The decision.
 * @param samples - Its logged decisions, newest first.
 * @param sampled - Whether there were more than were read.
 */
export function healthOf(type: JevDecisionType, samples: readonly JevSample[], sampled = false): JevDecisionHealth {
  const byOutcome = Object.fromEntries(JEV_OUTCOMES.map(o => [o, 0])) as Record<JevOutcome, number>;
  const latencies: number[] = [];
  const versions = new Map<string, number>();
  let lastAnsweredAt: string | null = null;
  let lastFailure: JevDecisionHealth['lastFailure'] = null;
  let status: JevDecisionHealth['status'] = 'idle';
  let asked = 0;
  for (const s of samples) {
    const o = jevOutcomeOf(s.fallback, s.asked);
    byOutcome[o] += 1;
    if (s.version) {
      versions.set(s.version, (versions.get(s.version) ?? 0) + 1);
    }
    const failed = JEV_FAILURES.has(o);
    if (s.asked || failed) {
      asked += 1;
      if (status === 'idle') {
        status = failed ? 'failing' : 'live';
      }
    }
    if (failed && !lastFailure) {
      lastFailure = { outcome: o, reason: (s.fallback ?? '').slice(0, 160), at: s.at.toISOString() };
    }
    if (s.asked && !failed) {
      if (!lastAnsweredAt) {
        lastAnsweredAt = s.at.toISOString();
      }
      if (typeof s.latencyMs === 'number' && Number.isFinite(s.latencyMs)) {
        latencies.push(s.latencyMs);
      }
    }
  }
  latencies.sort((a, b) => a - b);
  const failed = [...JEV_FAILURES].reduce((n, o) => n + byOutcome[o], 0);
  return {
    type,
    decisions: samples.length,
    asked,
    answered: asked - failed,
    used: byOutcome.used,
    failed,
    byOutcome,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    lastAnsweredAt,
    lastFailure,
    versions: [...versions.entries()].sort((a, b) => b[1] - a[1]).map(([version, decisions]) => ({ version, decisions })),
    status,
    sampled,
  };
}

type Window = { workspaces: string[]; from: Date; to: Date };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

/**
 * A decision detail (`RouteDetail`, `AgentRouteDetail`, the pick's `jev`) as a sample.
 * @param at - When.
 * @param detail - The JSON detail.
 */
function sampleOf(at: Date, detail: unknown): JevSample {
  const d = obj(detail);
  return { at, asked: d.asked === true, fallback: str(d.fallback), latencyMs: num(d.latencyMs), version: str(d.questionVersion) };
}

async function factorySamples(w: Window): Promise<JevSample[]> {
  const e = engineRunSchema;
  const rows = await db.select({ at: e.createdAt, detail: e.routeDetail }).from(e).where(and(inArray(e.orgId, w.workspaces), isNotNull(e.routeDetail), gte(e.createdAt, w.from), lt(e.createdAt, w.to))).orderBy(desc(e.createdAt)).limit(JEV_HEALTH_SAMPLE + 1);
  return rows.map(r => sampleOf(r.at, r.detail));
}

async function turnSamples(w: Window): Promise<JevSample[]> {
  const m = modelCallSchema;
  // Every model call of a routed turn carries the same decision: one per trace.
  const rows = await db.select({ at: m.createdAt, trace: sql<string>`coalesce(${m.traceId}, ${m.id}::text)`, detail: m.routeDetail }).from(m).where(and(inArray(m.orgId, w.workspaces), isNotNull(m.routeSelector), gte(m.createdAt, w.from), lt(m.createdAt, w.to))).orderBy(desc(m.createdAt)).limit(4 * (JEV_HEALTH_SAMPLE + 1));
  const seen = new Set<string>();
  const out: JevSample[] = [];
  for (const r of rows) {
    if (!seen.has(r.trace)) {
      seen.add(r.trace);
      out.push(sampleOf(r.at, r.detail));
    }
  }
  return out.slice(0, JEV_HEALTH_SAMPLE + 1);
}

async function agentSamples(w: Window): Promise<JevSample[]> {
  const msg = conversationMessageSchema;
  const c = conversationSchema;
  const rows = await db.select({ at: msg.createdAt, detail: sql<unknown>`${msg.routingJson} -> 'jev'` }).from(msg).innerJoin(c, eq(c.id, msg.conversationId)).where(and(inArray(c.orgId, w.workspaces), sql`(${msg.routingJson} -> 'jev') is not null`, gte(msg.createdAt, w.from), lt(msg.createdAt, w.to))).orderBy(desc(msg.createdAt)).limit(JEV_HEALTH_SAMPLE + 1);
  return rows.map(r => sampleOf(r.at, r.detail));
}

async function duplicateSamples(w: Window): Promise<JevSample[]> {
  const r = recordDuplicateCheckSchema;
  const rows = await db.select({ at: r.createdAt, verdict: r.verdict, fallback: r.fallback, latencyMs: r.latencyMs, version: r.questionVersion }).from(r).where(and(inArray(r.orgId, w.workspaces), eq(r.judge, 'jev'), gte(r.createdAt, w.from), lt(r.createdAt, w.to))).orderBy(desc(r.createdAt)).limit(JEV_HEALTH_SAMPLE + 1);
  // A Jev row is asked unless the breaker skipped it (no latency, no answer).
  return rows.map(x => ({ at: x.at, asked: !(x.verdict === 'failed' && x.latencyMs === null), fallback: x.fallback, latencyMs: x.latencyMs, version: x.version }));
}

/**
 * The workspaces a scope covers.
 * @param scope - An Org or one workspace.
 */
async function workspacesOf(scope: SpendScope): Promise<string[]> {
  if ('orgId' in scope) {
    return [scope.orgId];
  }
  return (await db.select({ id: projectSchema.id }).from(projectSchema).where(eq(projectSchema.accountId, scope.accountId))).map(r => r.id);
}

/**
 * Each decision type's health over a period.
 * @param input - What to read.
 * @param input.scope - An Org or one workspace.
 * @param input.from - Period start, inclusive.
 * @param input.to - Period end, exclusive.
 */
export async function jevHealth(input: { scope: SpendScope; from: Date; to: Date }): Promise<JevDecisionHealth[]> {
  const workspaces = await workspacesOf(input.scope);
  const w = { workspaces, from: input.from, to: input.to };
  const readers: Array<[JevDecisionType, (w: Window) => Promise<JevSample[]>]> = [['factory', factorySamples], ['turn', turnSamples], ['agent', agentSamples], ['duplicate', duplicateSamples]];
  return Promise.all(readers.map(async ([type, read]) => {
    const samples = workspaces.length === 0 ? [] : await read(w);
    return healthOf(type, samples.slice(0, JEV_HEALTH_SAMPLE), samples.length > JEV_HEALTH_SAMPLE);
  }));
}

/** The outcomes already on record, split by who decided. */
export type JevOutcomes = {
  /** Factory runs Jev was asked about, by whose route ran. */
  factory: Array<{ selector: string; runs: number; prs: number; qaJudged: number; qaApproved: number; merged: number; reverted: number; reruns: number }>;
  /** First messages Jev was asked about: Jev picked, or the model read did. */
  agent: Array<{ decidedBy: 'jev' | 'model'; firstMessages: number; anotherAgentLater: number }>;
  /** Duplicate links written, by the judge that wrote them, and how many a person undid. */
  duplicate: Array<{ judge: string; linked: number; undone: number }>;
};

/**
 * The outcomes over a period.
 * @param input - What to read.
 * @param input.scope - An Org or one workspace.
 * @param input.from - Period start, inclusive.
 * @param input.to - Period end, exclusive.
 */
export async function jevOutcomes(input: { scope: SpendScope; from: Date; to: Date }): Promise<JevOutcomes> {
  const workspaces = await workspacesOf(input.scope);
  if (workspaces.length === 0) {
    return { factory: [], agent: [], duplicate: [] };
  }
  const e = engineRunSchema;
  const msg = conversationMessageSchema;
  const c = conversationSchema;
  const r = recordDuplicateCheckSchema;
  const count = (cond: ReturnType<typeof sql>) => sql<number>`count(*) filter (where ${cond})::int`;
  const [factory, agent, duplicate] = await Promise.all([
    db.select({
      selector: sql<string>`coalesce(${e.routeSelector}, 'static')`,
      runs: sql<number>`count(*)::int`,
      prs: count(sql`${e.prUrl} is not null`),
      qaJudged: count(sql`${e.qaVerdict} is not null`),
      qaApproved: count(sql`${e.qaVerdict} = 'approve'`),
      merged: count(sql`${e.merged}`),
      reverted: count(sql`${e.reverted}`),
      reruns: count(sql`${e.attempt} > 1`),
    }).from(e).where(and(inArray(e.orgId, workspaces), isNotNull(e.routeDetail), gte(e.createdAt, input.from), lt(e.createdAt, input.to))).groupBy(sql`1`),
    db.select({
      decidedBy: sql<'jev' | 'model'>`case when ${msg.routingJson} ->> 'decidedBy' = 'jev' then 'jev' else 'model' end`,
      firstMessages: sql<number>`count(*)::int`,
      anotherAgentLater: count(sql`exists (select 1 from ${msg} as later where later.conversation_id = ${msg.conversationId} and later.role = 'assistant' and later.created_at > ${msg.createdAt} and later.agent_slug is not null and later.agent_slug <> (${msg.routingJson} ->> 'chosen'))`),
    }).from(msg).innerJoin(c, eq(c.id, msg.conversationId)).where(and(inArray(c.orgId, workspaces), sql`(${msg.routingJson} -> 'jev') is not null`, gte(msg.createdAt, input.from), lt(msg.createdAt, input.to))).groupBy(sql`1`),
    db.select({
      judge: r.judge,
      linked: sql<number>`count(*)::int`,
      undone: count(sql`exists (select 1 from action_run a where a.org_id = ${r.orgId} and a.status = 'undone' and a.dedup_key like 'objects.update_meta:' || lower(${r.objectType}) || ':' || ${r.objectId} || ':%')`),
    }).from(r).where(and(inArray(r.orgId, workspaces), eq(r.linked, true), gte(r.createdAt, input.from), lt(r.createdAt, input.to))).groupBy(r.judge),
  ]);
  return {
    factory: factory.map(x => ({ selector: x.selector, runs: Number(x.runs), prs: Number(x.prs), qaJudged: Number(x.qaJudged), qaApproved: Number(x.qaApproved), merged: Number(x.merged), reverted: Number(x.reverted), reruns: Number(x.reruns) })),
    agent: agent.map(x => ({ decidedBy: x.decidedBy, firstMessages: Number(x.firstMessages), anotherAgentLater: Number(x.anotherAgentLater) })),
    duplicate: duplicate.map(x => ({ judge: x.judge, linked: Number(x.linked), undone: Number(x.undone) })),
  };
}

/** The last live check, per workspace, and when it ran. */
const lastCheck = new Map<string, { at: number; result: JevCheck }>();
/** A live check is run at most this often per workspace; within it the last result is returned. */
export const JEV_CHECK_EVERY_MS = 30_000;

export type JevCheck = {
  /** Jev answered a one-question call with the key this workspace spends. */
  ok: boolean;
  outcome: JevOutcome | 'no_key';
  reason: string | null;
  latencyMs: number | null;
  model: string | null;
  keyScope: 'instance' | 'workspace' | null;
  at: string;
  /** Returned from the last check (within `JEV_CHECK_EVERY_MS`), not a new call. */
  cached: boolean;
};

/** Seams for tests. */
export type JevCheckDeps = {
  resolveKey?: (orgId: string) => Promise<{ key: string; scope: 'instance' | 'workspace' } | null>;
  fetch?: typeof fetch;
  now?: () => number;
};

/**
 * Ask Jev one yes/no question with the key this workspace spends, to prove the
 * key and the service work right now. Costs one tiny call; never throws,
 * never returns or logs the key.
 * @param orgId - The workspace.
 * @param deps - Seams for tests.
 */
export async function checkJevNow(orgId: string, deps: JevCheckDeps = {}): Promise<JevCheck> {
  const now = deps.now ?? Date.now;
  const last = lastCheck.get(orgId);
  if (last && now() - last.at < JEV_CHECK_EVERY_MS) {
    return { ...last.result, cached: true };
  }
  const at = new Date(now()).toISOString();
  const done = (result: JevCheck): JevCheck => {
    lastCheck.set(orgId, { at: now(), result });
    return result;
  };
  let resolved: { key: string; scope: 'instance' | 'workspace' } | null;
  try {
    resolved = await (deps.resolveKey ?? (async (id: string) => (await import('./jevKey')).resolveJevKey(id)))(orgId);
  } catch {
    return done({ ok: false, outcome: 'config', reason: 'the saved Jev key could not be decrypted', latencyMs: null, model: null, keyScope: null, at, cached: false });
  }
  if (!resolved) {
    return done({ ok: false, outcome: 'no_key', reason: 'no Jev key is set', latencyMs: null, model: null, keyScope: null, at, cached: false });
  }
  const { askYesNo, jevSettings } = await import('./jev');
  const res = await askYesNo(resolved.key, { state: { check: 'a health check from Vocion' }, questions: { ok: { instructions: 'Is the state a health check?' } } }, jevSettings(), { fetch: deps.fetch, now });
  if ('failed' in res) {
    return done({ ok: false, outcome: jevOutcomeOf(res.reason, true), reason: res.reason, latencyMs: res.latencyMs, model: null, keyScope: resolved.scope, at, cached: false });
  }
  return done({ ok: true, outcome: 'used', reason: null, latencyMs: res.latencyMs, model: res.model, keyScope: resolved.scope, at, cached: false });
}

/** Forget the last checks (tests). */
export function resetJevChecks(): void {
  lastCheck.clear();
}
