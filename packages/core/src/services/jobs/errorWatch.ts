/**
 * `error-watch` — production errors become records a person and an agent can
 * act on (2026-10-01: an API answered 500 to every signed-in call for hours,
 * Sentry counted 184 of them, and nothing in the workspace knew).
 *
 * Every pass reads the error tracker for the projects the automation names
 * (`do.input.projects`) and, for an issue past a simple threshold, opens or
 * updates one record of the type the automation names (`do.input.recordType`),
 * keyed on the issue, so a retry or the next pass lands on the same row:
 *
 *   new       first seen within the last hour, with `threshold` events in it;
 *   spiking   `threshold` events in the last `windowMinutes`, at least twice
 *             the window before.
 *
 * A record that is opened carries `cause` — `deploy`, `code` or `unknown` —
 * read by the classifier from the facts (the release the issue first appeared
 * in and when, the project's releases and when each went out, the exception
 * and the app's frames), never matched from words. An open record whose issue
 * has had no event for an hour is resolved. Each change raises the events the
 * automation names (`do.input.events.opened` / `.updated`), with the typed
 * `cause`, `release` and `environment`, for whatever listens — a
 * notification, another plugin's automation. Nothing here names a product, a
 * plugin or a type.
 */

import type { IssueCount, SentryCredentials, SentryEvent, SentryIssue, SentryResult } from '@/libs/sentry/client';

type Meta = Record<string, unknown>;

export const ERROR_WATCH_JOB = 'error-watch';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);

export type Cause = 'deploy' | 'code' | 'unknown';
export type WatchedProject = { project: string; environment: string | null; org: string | null; product: string | null };
export type ErrorWatchInput = {
  projects: WatchedProject[];
  recordType: string;
  events: { opened: string | null; updated: string | null };
  threshold: number;
  windowMinutes: number;
};

/** One hour: what "new" means, and how long an issue is quiet before its record resolves. */
const HOUR_MS = 60 * 60_000;
/** Issues read in full per project per pass. */
const CANDIDATES = 5;

/**
 * The automation's input, read with its defaults. Null when it names no record type.
 * @param input - `do.input`.
 */
export function watchInput(input: Meta): ErrorWatchInput | null {
  const recordType = str(input.recordType);
  if (!recordType) {
    return null;
  }
  const projects = (Array.isArray(input.projects) ? input.projects : []).flatMap((p): WatchedProject[] => {
    const o = typeof p === 'string' ? { project: p } : obj(p);
    const project = str(o?.project);
    return project && /^[\w-]+$/.test(project) ? [{ project, environment: str(o?.environment), org: str(o?.org), product: str(o?.product) }] : [];
  });
  const events = obj(input.events);
  return {
    projects,
    recordType,
    events: { opened: str(events?.opened), updated: str(events?.updated) },
    threshold: Number(input.threshold) > 0 ? Number(input.threshold) : 20,
    windowMinutes: Number(input.windowMinutes) > 0 ? Number(input.windowMinutes) : 10,
  };
}

/** Where the watch reads and writes, injected in tests. */
export type ErrorWatchDeps = {
  sentry: (orgId: string) => Promise<{ ok: true; credentials: SentryCredentials } | { ok: false; message: string }>;
  countErrors: (c: SentryCredentials, q: { project?: string | null; environment?: string | null; start: Date; end: Date; limit?: number }) => Promise<SentryResult<IssueCount[]>>;
  readIssue: (c: SentryCredentials, id: string) => Promise<SentryResult<SentryIssue>>;
  latestEvent: (c: SentryCredentials, id: string, environment: string | null) => Promise<SentryResult<SentryEvent>>;
  releases: (c: SentryCredentials, project: string) => Promise<SentryResult<Array<{ version: string; createdAt: string | null }>>>;
  cause: (orgId: string, facts: string) => Promise<{ cause: Cause; why: string } | null>;
  records: (orgId: string, type: string) => Promise<Array<{ id: number; title: string; meta: Meta }>>;
  upsert: (orgId: string, o: { type: string; key: string; title: string; meta: Meta }) => Promise<{ id: number; created: boolean }>;
  emit: (orgId: string, type: string, payload: Meta, dedupeKey: string) => Promise<void>;
};

async function defaultDeps(): Promise<ErrorWatchDeps> {
  const client = await import('@/libs/sentry/client');
  return {
    sentry: async orgId => (await import('@/services/sentry/access')).sentryFor(orgId),
    countErrors: client.countErrors,
    readIssue: client.readIssue,
    latestEvent: client.latestEvent,
    releases: (c, project) => client.listReleases(c, project, 5),
    cause: readCause,
    records: async (orgId, type) => {
      const { listBusinessObjects } = await import('@/services/BusinessObjectService');
      return ((await listBusinessObjects(orgId, type).catch(() => [])) as Array<{ id: number; title: string; metadata: unknown }>).map(r => ({ id: r.id, title: r.title, meta: (r.metadata ?? {}) as Meta }));
    },
    upsert: async (orgId, o) => {
      const { upsertBusinessObjectByExternalKey } = await import('@/services/BusinessObjectService');
      const r = await upsertBusinessObjectByExternalKey({ typeSlug: o.type, title: o.title, metadata: o.meta, externalKey: { system: 'sentry', id: o.key } }, orgId, 'system:error-watch');
      return { id: r.object.id, created: r.created };
    },
    emit: async (orgId, type, payload, dedupeKey) => {
      const { emitEvent } = await import('@/services/EventService');
      await emitEvent({ orgId, type, payload, dedupeKey, invokedBy: 'system:error-watch', dispatchMode: 'auto' });
    },
  };
}

/**
 * What caused an error, read by the classifier from the facts as typed
 * fields. Null when the read failed (the record then says `unknown`).
 * @param orgId - The workspace.
 * @param facts - The facts, as lines.
 */
export async function readCause(orgId: string, facts: string): Promise<{ cause: Cause; why: string } | null> {
  try {
    const { z } = await import('zod');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const schema = z.object({
      cause: z.enum(['deploy', 'code', 'unknown']).describe('deploy: a release that went out brought it (it first appeared in that release, soon after it went out, and the error is about how the build or its runtime was made, or the release is the newest). code: an existing code path fails on some input or state, independent of a fresh release. unknown: the facts do not settle it.'),
      why: z.string().max(240).describe('One line: which facts settle it.'),
    });
    const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 250 }) as unknown as { bindTools: (tools: unknown[], opts: unknown) => { invoke: (m: unknown[]) => Promise<{ tool_calls?: Array<{ name: string; args: unknown }> }> } };
    const report = tool(async () => 'recorded', { name: 'report_cause', description: 'Report what caused the production error.', schema: schema as never });
    const res = await model.bindTools([report], { tool_choice: 'report_cause' }).invoke([
      new SystemMessage('You read an error tracker\'s facts about one production error and say what caused it. Judge only from the facts given. Answer only through the tool.'),
      new HumanMessage(facts.slice(0, 6_000)),
    ]);
    const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
    const { FEATURES } = await import('@/libs/Langfuse/features');
    await chargeModelCall({ orgId, feature: FEATURES.ERROR_CAUSE, role: 'classifier', response: res as never }).catch(() => undefined);
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_cause');
    const parsed = call ? schema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : null;
  } catch (err) {
    console.warn('error watch: the cause read failed', { orgId, message: (err as Error).message });
    return null;
  }
}

/**
 * The facts the classifier reads, as lines.
 * @param issue - The issue.
 * @param event - Its latest event, when read.
 * @param releases - The project's latest releases, newest first.
 */
export function causeFacts(issue: SentryIssue, event: SentryEvent | null, releases: Array<{ version: string; createdAt: string | null }>): string {
  const first = issue.firstRelease ?? null;
  const ex = event?.exceptions[0];
  const frames = (event?.exceptions ?? []).flatMap(x => x.frames.filter(f => f.inApp)).slice(-5).map(f => `${f.file}:${f.line ?? '?'}`);
  return [
    `Issue ${issue.shortId}: ${issue.title}${issue.culprit ? ` at ${issue.culprit}` : ''}`,
    `First seen ${issue.firstSeen ?? 'unknown'}, in release ${first ?? 'none recorded'}${issue.firstReleaseAt ? ` (that release was created ${issue.firstReleaseAt})` : ''}; last seen ${issue.lastSeen ?? 'unknown'}.`,
    `The project's latest releases, newest first: ${releases.length > 0 ? releases.map(r => `${r.version.slice(0, 12)} created ${r.createdAt ?? '?'}`).join('; ') : 'none recorded'}.`,
    ex ? `Exception: ${ex.type ?? '?'}: ${(ex.value ?? '').slice(0, 600)}` : 'No exception was read.',
    frames.length > 0 ? `App frames, innermost last: ${frames.join(', ')}` : 'No app frame.',
    event?.request ? `Request: ${event.request.method ?? ''} ${event.request.url ?? ''} → ${event.request.status ?? '?'}` : '',
  ].filter(Boolean).join('\n');
}

type Result = { project: string; shortId: string | null; did: string; recordId: number | null };

/**
 * One pass over every watched project.
 * @param orgId - The workspace.
 * @param raw - The automation's `do.input`.
 * @param now - The clock.
 * @param deps - Injected in tests.
 */
export async function runErrorWatch(orgId: string, raw: Meta = {}, now: Date = new Date(), deps?: Partial<ErrorWatchDeps>): Promise<{ acted: Result[]; problem?: string }> {
  const input = watchInput(raw);
  if (!input) {
    return { acted: [], problem: 'the automation names no recordType for incidents' };
  }
  if (input.projects.length === 0) {
    return { acted: [], problem: 'the automation names no project to watch (do.input.projects)' };
  }
  const d = { ...(await defaultDeps()), ...deps };
  const access = await d.sentry(orgId);
  if (!access.ok) {
    return { acted: [], problem: access.message };
  }
  const existing = await d.records(orgId, input.recordType);
  const acted: Result[] = [];
  for (const p of input.projects) {
    try {
      acted.push(...await watchProject(orgId, { ...access.credentials, org: p.org ?? access.credentials.org }, p, input, existing, now, d));
    } catch (err) {
      acted.push({ project: p.project, shortId: null, did: `failed: ${(err as Error).message.slice(0, 200)}`, recordId: null });
    }
  }
  return { acted };
}

async function watchProject(orgId: string, c: SentryCredentials, p: WatchedProject, input: ErrorWatchInput, existing: Array<{ id: number; title: string; meta: Meta }>, now: Date, d: ErrorWatchDeps): Promise<Result[]> {
  const winMs = input.windowMinutes * 60_000;
  const q = { project: p.project, environment: p.environment, limit: 25 };
  const [hour, win, before] = await Promise.all([
    d.countErrors(c, { ...q, start: new Date(now.getTime() - HOUR_MS), end: now }),
    d.countErrors(c, { ...q, start: new Date(now.getTime() - winMs), end: now }),
    d.countErrors(c, { ...q, start: new Date(now.getTime() - 2 * winMs), end: new Date(now.getTime() - winMs) }),
  ]);
  if (!hour.ok) {
    return [{ project: p.project, shortId: null, did: `unread: ${hour.message}`, recordId: null }];
  }
  const inWin = new Map((win.ok ? win.data : []).map(i => [i.issueId, i.events]));
  const inBefore = new Map((before.ok ? before.data : []).map(i => [i.issueId, i.events]));
  const mine = existing.filter(r => r.meta.source === 'sentry' && str(r.meta.org) === c.org && str(r.meta.project) === p.project && (str(r.meta.environment) ?? null) === p.environment);
  const byIssue = new Map(mine.map(r => [str(r.meta.issueId), r]));
  const out: Result[] = [];
  const at = now.toISOString();

  const candidates = hour.data
    .filter((i) => {
      const w = inWin.get(i.issueId) ?? 0;
      return i.events >= input.threshold || (w >= input.threshold && w >= 2 * (inBefore.get(i.issueId) ?? 0));
    })
    .slice(0, CANDIDATES);
  for (const hit of candidates) {
    const issue = await d.readIssue(c, hit.issueId);
    if (!issue.ok) {
      out.push({ project: p.project, shortId: hit.shortId, did: `unread: ${issue.message}`, recordId: null });
      continue;
    }
    const firstSeen = Date.parse(issue.data.firstSeen ?? '');
    const isNew = Number.isFinite(firstSeen) && now.getTime() - firstSeen < HOUR_MS && hit.events >= input.threshold;
    const w = inWin.get(hit.issueId) ?? 0;
    const spiking = w >= input.threshold && w >= 2 * (inBefore.get(hit.issueId) ?? 0);
    const prior = byIssue.get(hit.issueId);
    if (!isNew && !spiking && !(prior && prior.meta.status === 'open')) {
      continue;
    }
    const base: Meta = {
      source: 'sentry',
      org: c.org,
      project: p.project,
      environment: p.environment,
      ...(p.product ? { product: p.product } : {}),
      issueId: issue.data.id,
      shortId: issue.data.shortId,
      url: issue.data.url,
      culprit: issue.data.culprit,
      release: issue.data.firstRelease ?? null,
      lastRelease: issue.data.lastRelease ?? null,
      firstSeen: issue.data.firstSeen,
      lastSeen: issue.data.lastSeen,
      eventsLastHour: hit.events,
      events: issue.data.events,
      checkedAt: at,
    };
    const title = `${issue.data.shortId}: ${issue.data.title.replace(/[:\s]+$/, '')}`.slice(0, 200);
    const key = `${c.org}/${issue.data.id}`;
    const payload = (id: number, m: Meta): Meta => ({
      incidentId: id,
      shortId: issue.data.shortId,
      title,
      url: issue.data.url,
      project: p.project,
      environment: p.environment ?? '',
      product: p.product ?? '',
      release: str(m.release) ?? '',
      cause: str(m.cause) ?? 'unknown',
      why: str(m.causeWhy) ?? '',
      events: hit.events,
      status: str(m.status) ?? 'open',
    });

    if (!prior) {
      const event = await d.latestEvent(c, issue.data.id, p.environment);
      const releases = await d.releases(c, p.project);
      const latest = event.ok ? event.data : null;
      const read = await d.cause(orgId, causeFacts(issue.data, latest, releases.ok ? releases.data : []));
      const m: Meta = {
        ...base,
        status: 'open',
        openedAt: at,
        trigger: isNew ? 'new' : 'spiking',
        cause: read?.cause ?? 'unknown',
        causeWhy: read?.why ?? 'the cause could not be read',
        exception: latest?.exceptions[0] ? `${latest.exceptions[0].type ?? ''}: ${(latest.exceptions[0].value ?? '').trim().split('\n').find(Boolean) ?? ''}`.slice(0, 300) : null,
        request: latest?.request ? `${latest.request.method ?? ''} ${latest.request.url ?? ''} → ${latest.request.status ?? '?'}`.trim() : null,
        frames: latest ? latest.exceptions.flatMap(x => x.frames.filter(f => f.inApp)).slice(-6).map(f => `${f.file}:${f.line ?? '?'}${f.function ? ` in ${f.function}` : ''}`) : [],
        lastEmittedEvents: hit.events,
      };
      const rec = await d.upsert(orgId, { type: input.recordType, key, title, meta: m });
      if (input.events.opened) {
        await d.emit(orgId, input.events.opened, payload(rec.id, m), `${input.events.opened}:${key}`);
      }
      out.push({ project: p.project, shortId: issue.data.shortId, did: `opened: ${m.cause}`, recordId: rec.id });
      continue;
    }
    // Seen again: a resolved one reopens; an open one is updated, and heard
    // about again only when it has doubled since it was last raised.
    const reopened = prior.meta.status !== 'open';
    const doubled = hit.events >= 2 * Math.max(Number(prior.meta.lastEmittedEvents) || 0, 1);
    const m: Meta = { ...base, status: 'open', ...(reopened ? { reopenedAt: at } : {}), ...(reopened || doubled ? { lastEmittedEvents: hit.events } : {}) };
    await d.upsert(orgId, { type: input.recordType, key, title, meta: m });
    if ((reopened || doubled) && input.events.updated) {
      await d.emit(orgId, input.events.updated, { ...payload(prior.id, { ...prior.meta, ...m }), change: reopened ? 'reopened' : 'spiking' }, `${input.events.updated}:${key}:${at}`);
    }
    out.push({ project: p.project, shortId: issue.data.shortId, did: reopened ? 'reopened' : doubled ? 'updated: spiking' : 'updated', recordId: prior.id });
  }

  // Quiet for an hour: resolved.
  const busy = new Set(hour.data.map(i => i.issueId));
  for (const r of mine) {
    if (r.meta.status === 'open' && !busy.has(String(r.meta.issueId))) {
      const key = `${c.org}/${String(r.meta.issueId)}`;
      const m: Meta = { status: 'resolved', resolvedAt: at, resolvedWhy: 'no event in the last hour' };
      await d.upsert(orgId, { type: input.recordType, key, title: r.title, meta: { ...r.meta, ...m } });
      if (input.events.updated) {
        await d.emit(orgId, input.events.updated, { incidentId: r.id, shortId: String(r.meta.shortId ?? ''), url: String(r.meta.url ?? ''), project: p.project, environment: p.environment ?? '', product: p.product ?? '', release: String(r.meta.release ?? ''), cause: String(r.meta.cause ?? 'unknown'), status: 'resolved', change: 'resolved' }, `${input.events.updated}:${key}:resolved:${at}`);
      }
      out.push({ project: p.project, shortId: String(r.meta.shortId ?? ''), did: 'resolved', recordId: r.id });
    }
  }
  return out;
}
