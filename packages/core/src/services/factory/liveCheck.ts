/**
 * THE LIVE CHECK, recorded from Vocion: what QA saw of a release on the live
 * product, line by line, written on the release and each feature it shipped.
 * QA looks with the run's browser (`services/factory/liveBrowser.ts`, the
 * `browser_*` tools) signed in as the product's QA account, and records with
 * `record_live_check`; the decisions are `libs/factory/liveCheck.ts`.
 *
 * The structure is on the evidence (Chris, 2026-10-03): every acceptance line
 * of every shipped request is recorded seen, not seen or not observable, and a
 * seen or not-seen line cites what this run's browser captured (a snapshot, a
 * screenshot, a response, an action). What it writes is what the check wrote
 * before the browser tools — `liveState`, `liveSummary`, `liveEvidence` and the
 * announcement image on the release, `liveCheck` with its per-line `lines` on
 * each feature — so the feature page, Releases, Work and the release pack read
 * it unchanged.
 *
 * The password is read where the browser signs in and never reaches a tool's
 * answer, the record or a log line.
 */

import type { BrowserContext } from 'playwright';
import type { AcceptanceLine, BeforeMergeLine, LiveReason, LiveRow, LiveVerdict, RecordedLine } from '@/libs/factory/liveCheck';
import type { BrowserEvidence } from '@/services/factory/liveBrowser';
import type { EnvironmentAccess } from '@/services/factory/productAccess';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { acceptanceLines, isSignInPath, lineResults, LIVE_ROLE, liveVerdict, notSeenLine, pickAnnouncementImage, resolveRecordedLines, uncheckedRow } from '@/libs/factory/liveCheck';
import { artifactSchema, businessObjectSchema } from '@/models/Schema';

type Meta = Record<string, unknown>;

const short = (e: unknown, n = 240) => String((e as Error)?.message ?? e ?? '').split('\n')[0]!.slice(0, n);

/**
 * The environment a page opens on: the one whose surface is named, else the
 * one that carries the QA sign-in, else the first with an address.
 * @param want - The surface asked for, if any.
 * @param want.surface - An environment's surface or slug.
 * @param envs - The product's environments.
 */
export function environmentFor(want: { surface?: string }, envs: readonly EnvironmentAccess[]): EnvironmentAccess | null {
  const withUrl = envs.filter(e => e.url);
  if (want.surface) {
    return withUrl.find(e => e.surface === want.surface || e.slug === want.surface) ?? null;
  }
  return withUrl.find(e => e.login?.stored) ?? withUrl[0] ?? null;
}

/**
 * The origins a check may open: each environment's address and its sign-in
 * page. Anything else — an internal address, another site — is refused, so
 * the browser on the box goes only where the product lives.
 * @param envs - The product's environments.
 */
export function allowedOrigins(envs: readonly EnvironmentAccess[]): Set<string> {
  const out = new Set<string>();
  for (const e of envs) {
    for (const u of [e.url, e.login?.signInUrl]) {
      try {
        if (u) {
          out.add(new URL(u).origin);
        }
      } catch { /* not an address */ }
    }
  }
  return out;
}

/**
 * Sign in on the environment's sign-in page by its accessible labels — the
 * form every product's sign-in page is: an Email field, a Password field, a
 * submit button. Resolves '' or the reason it failed, in the page's words,
 * never what was typed.
 * @param context - A fresh context.
 * @param env - The environment, its password revealed.
 */
export async function signIn(context: BrowserContext, env: EnvironmentAccess): Promise<string> {
  const login = env.login!;
  const page = await context.newPage();
  try {
    await page.goto(login.signInUrl || `${String(env.url).replace(/\/+$/, '')}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByLabel('Email', { exact: true }).first().fill(login.email ?? '', { timeout: 15000 });
    await page.getByLabel('Password', { exact: true }).first().fill(login.password ?? '', { timeout: 15000 });
    await page.getByRole('button', { name: 'Sign in', exact: true }).or(page.locator('button[type=submit]')).first().click({ timeout: 15000 });
    try {
      await page.waitForURL(u => !isSignInPath(u.pathname), { timeout: 30000 });
    } catch {
      // What the page shows a person, as rendered.
      // eslint-disable-next-line unicorn/prefer-dom-node-text-content
      const alert = await page.getByRole('alert').first().innerText({ timeout: 2000 }).catch(() => '');
      return `still on the sign-in page after submitting${alert ? ` ("${alert.trim().slice(0, 160)}")` : ''}`;
    }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    return '';
  } catch (e) {
    // A Playwright error names the locator, never the value it filled.
    return short(e);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Why the QA sign-in cannot be used, or ''.
 * @param env - The environment, its password revealed.
 */
export function signInProblem(env: EnvironmentAccess): string {
  const l = env.login;
  if (!l) {
    return `no QA sign-in is stored for ${env.slug} (the environment's qaLoginCredentialId)`;
  }
  if (!l.stored) {
    return `the QA sign-in for ${env.slug} could not be read${l.problem ? `: ${l.problem}` : ''}`;
  }
  if (!l.email || !l.password) {
    return `the QA sign-in for ${env.slug} has no ${l.email ? 'password' : 'email'}`;
  }
  return '';
}

async function mergeMeta(orgId: string, id: number, set: Meta): Promise<void> {
  await db
    .update(businessObjectSchema)
    .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

async function readMeta(orgId: string, id: number): Promise<{ title: string; meta: Meta } | null> {
  const [row] = await db
    .select({ title: businessObjectSchema.title, meta: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return row ? { title: row.title, meta: (row.meta ?? {}) as Meta } : null;
}

function ids(v: unknown): number[] {
  return (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
}

/**
 * A release and what its features promised, numbered: the product it names, the requests it
 * shipped, and each request's acceptance lines — with the lines the shipped attempts' verdict left
 * to the live check (FE-392).
 * @param orgId - The workspace.
 * @param releaseId - The release record.
 */
export async function releaseLines(orgId: string, releaseId: number): Promise<
  | { ok: true; meta: Meta; product: string; requestIds: number[]; linesByRequest: Map<number, AcceptanceLine[]>; acceptance: Array<{ requestId: number; lines: AcceptanceLine[] }> }
  | { ok: false; why: string }
> {
  const release = await readMeta(orgId, releaseId);
  if (!release) {
    return { ok: false, why: `release #${releaseId} does not exist in this workspace` };
  }
  const product = typeof release.meta.product === 'string' && release.meta.product.trim() ? release.meta.product.trim() : null;
  if (!product) {
    return { ok: false, why: `release #${releaseId} names no product, so there is no live product to check` };
  }
  const requestIds = ids(release.meta.requestIds);
  const shippedTaskIds = ids(release.meta.taskIds);
  const shippedTasks: Array<{ id: number; meta: Meta }> = [];
  for (const id of shippedTaskIds) {
    const task = await readMeta(orgId, id);
    if (task) {
      shippedTasks.push({ id, meta: task.meta });
    }
  }
  const linesByRequest = new Map<number, AcceptanceLine[]>();
  const acceptance: Array<{ requestId: number; lines: AcceptanceLine[] }> = [];
  for (const id of requestIds) {
    const request = await readMeta(orgId, id);
    if (request) {
      linesByRequest.set(id, acceptanceLines(request.meta, { tasks: shippedTasks.filter(t => Number(t.meta.requestId) === id), shippedTaskIds }));
      acceptance.push({ requestId: id, lines: linesByRequest.get(id)! });
    }
  }
  return { ok: true, meta: release.meta, product, requestIds, linesByRequest, acceptance };
}

/** Where the recording finds the evidence a line cites. */
export type EvidenceSource = {
  /** What this run's browser session captured, by id. */
  session: ReadonlyMap<string, BrowserEvidence>;
  /** The run the check ran in: a screenshot it filed on the release is evidence even once the session is gone. */
  missionRunId?: number | null;
  /** What stopped the session from looking (a failed sign-in), said when nothing was seen. */
  problems?: LiveReason[];
};

/**
 * A screenshot id (`shot-<artifact id>`) the session no longer holds, read from the release's live
 * shots — only one this run filed.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param id - The evidence id.
 * @param missionRunId - The run.
 */
async function storedShot(orgId: string, releaseId: number, id: string, missionRunId: number | null | undefined): Promise<BrowserEvidence | null> {
  const n = id.startsWith('shot-') ? Number(id.slice(5)) : Number.NaN;
  if (!Number.isSafeInteger(n) || n <= 0 || !missionRunId) {
    return null;
  }
  const [row] = await db
    .select({ id: artifactSchema.id, spec: artifactSchema.spec, createdAt: artifactSchema.createdAt })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), eq(artifactSchema.id, n), eq(artifactSchema.recordType, 'object'), eq(artifactSchema.recordId, String(releaseId)), eq(artifactSchema.recordRole, LIVE_ROLE)))
    .limit(1);
  const spec = (row?.spec ?? {}) as Meta;
  const prov = (spec.provenance ?? {}) as Meta;
  if (!row || Number(prov.missionRunId) !== missionRunId) {
    return null;
  }
  return { id, kind: 'screenshot', at: row.createdAt?.toISOString?.() ?? '', artifactId: row.id, url: String(spec.url ?? ''), pageUrl: String(spec.capturedFrom ?? ''), caption: String(spec.caption ?? ''), viewport: prov.viewport === 'phone' ? 'phone' : 'desktop', signedIn: prov.signedIn !== false };
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`.slice(0, 200);
  } catch {
    return url.slice(0, 200);
  }
};

/** What `recordLiveCheck` answers. */
export type RecordLiveResult = {
  ok: boolean;
  releaseId: number;
  product: string | null;
  attempt: number | null;
  verdict: LiveVerdict;
  /** What was written, in one line, or why nothing was. */
  written: string;
  /** Each request the release shipped and its acceptance lines, numbered. */
  acceptance: Array<{ requestId: number; lines: AcceptanceLine[] }>;
  beforeMerge: BeforeMergeLine[];
  /** Set when the recording did not hold: nothing was written. */
  refused?: string;
};

/**
 * Record a release's live check: every acceptance line of every request it shipped, seen, not seen
 * or not observable, the seen and not-seen ones citing evidence this run captured. Writes what the
 * check has always written on the release and each feature. Refuses, writing nothing, when a line
 * is missing, unknown, doubled, or cites evidence this run did not capture.
 * @param orgId - The workspace.
 * @param input - The release and QA's lines.
 * @param input.releaseId - The release record.
 * @param input.lines - QA's lines, validated (`RecordedLineSchema`).
 * @param source - Where the cited evidence is found.
 * @param now - The clock.
 */
export async function recordLiveCheck(orgId: string, input: { releaseId: number; lines: RecordedLine[] }, source: EvidenceSource, now: Date = new Date()): Promise<RecordLiveResult> {
  const release = await releaseLines(orgId, input.releaseId);
  const nothing = (why: string, extra: Partial<RecordLiveResult> = {}): RecordLiveResult => ({ ok: false, releaseId: input.releaseId, product: release.ok ? release.product : null, attempt: null, verdict: liveVerdict([], [why]), written: 'nothing written', acceptance: release.ok ? release.acceptance : [], beforeMerge: [], refused: why, ...extra });
  if (!release.ok) {
    return nothing(release.why);
  }
  const resolved = resolveRecordedLines(input.lines, release.linesByRequest);
  if (!resolved.ok) {
    return nothing(resolved.refusal);
  }
  // THE EVIDENCE IS THIS RUN'S: every id a line cites was captured by this run's browser.
  const found = new Map<string, BrowserEvidence>();
  const unknown: string[] = [];
  for (const id of new Set(resolved.lines.flatMap(l => l.evidence))) {
    const e = source.session.get(id) ?? await storedShot(orgId, input.releaseId, id, source.missionRunId);
    if (e) {
      found.set(id, e);
    } else {
      unknown.push(id);
    }
  }
  if (unknown.length > 0) {
    const have = [...source.session.values()].filter(e => e.kind !== 'response').slice(-30).map(e => `${e.id} (${e.kind === 'screenshot' ? e.caption : e.kind === 'snapshot' ? e.url : e.kind === 'action' ? e.what : ''})`);
    return nothing(`${unknown.length === 1 ? 'An evidence id was' : `${unknown.length} evidence ids were`} not captured by this run's browser: ${unknown.slice(0, 10).join(', ')}. Cite only ids this run's browser tools returned (snapshots, screenshots, responses from browser_responses, actions).${have.length > 0 ? `\nThis run captured: ${have.join('; ')}` : '\nThis run\'s browser captured nothing: open the live product with browser_open first.'}`);
  }
  const rows: LiveRow[] = [];
  for (const l of resolved.lines) {
    if (l.result === 'not_observable') {
      if (!l.line.provenBeforeMerge) {
        rows.push(uncheckedRow(l.requestId, l.line, true));
      }
      continue;
    }
    const ev = l.evidence.map(id => found.get(id)!);
    const shot = ev.find((e): e is Extract<BrowserEvidence, { kind: 'screenshot' }> => e.kind === 'screenshot');
    const snap = ev.findLast((e): e is Extract<BrowserEvidence, { kind: 'snapshot' }> => e.kind === 'snapshot');
    const responses = ev.filter((e): e is Extract<BrowserEvidence, { kind: 'response' }> => e.kind === 'response');
    const seen = l.result === 'seen';
    const proved = responses.map(r => `${r.method} ${pathOf(r.url)} returned ${r.status}${r.signedIn ? ' signed in' : ' to a visitor'}`);
    const why = l.why.slice(0, 400);
    rows.push({
      requestId: l.requestId,
      flow: `line ${l.line.n}`,
      line: l.line.n,
      criterion: l.line.text.slice(0, 300),
      viewport: shot?.viewport ?? snap?.viewport ?? 'desktop',
      artifactId: shot?.artifactId ?? null,
      status: seen ? 'reached' : 'not_reached',
      ...(seen ? {} : { reason: why, why: { kind: 'not_seen' as const, detail: why } }),
      url: shot?.pageUrl || snap?.url || null,
      ...(shot?.caption ? { label: shot.caption } : {}),
      ...(seen && proved.length > 0 ? { proved } : {}),
      evidence: l.evidence,
    });
  }
  // What stopped the browser from looking at all, said first when nothing on a line was seen.
  const blocking: LiveReason[] = rows.some(r => r.status === 'reached') ? [] : (source.problems ?? []);
  const problems = blocking.map(p => p.detail);
  const { beforeMerge } = resolved;
  const verdict = liveVerdict(rows, blocking, beforeMerge);
  const attempt = (Number.isInteger(release.meta.liveAttempts) ? Number(release.meta.liveAttempts) : 0) + 1;
  const checkedAt = now.toISOString();
  const pick = pickAnnouncementImage(rows);
  await mergeMeta(orgId, input.releaseId, {
    liveEvidence: rows.slice(0, 120),
    liveSummary: verdict.line.slice(0, 500),
    liveProblems: problems.slice(0, 20),
    liveCheckedAt: checkedAt,
    liveState: verdict.state,
    liveReason: verdict.reason,
    liveWhy: verdict.why,
    liveAttempts: attempt,
    liveBeforeMerge: beforeMerge,
    ...(pick ? { announcementImageArtifactId: pick } : {}),
  });
  await markFeatures(orgId, input.releaseId, release.requestIds, { rows, blocking, checkedAt, attempt, beforeMerge });
  return {
    ok: verdict.state === 'seen',
    releaseId: input.releaseId,
    product: release.product,
    attempt,
    verdict,
    written: `release #${input.releaseId}: ${verdict.line}${pick ? `; the announcement leads with artifact #${pick}` : ''}`,
    acceptance: release.acceptance,
    beforeMerge,
  };
}

/**
 * Each feature the release shipped hears what the live check saw: its
 * `liveCheck` (state, the line, what it saw of each acceptance line), its
 * reached shots added to its after pictures (the carousel's Live section),
 * and a line on its timeline.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param requestIds - The features it shipped.
 * @param w - What the check saw.
 * @param w.rows - The line rows.
 * @param w.blocking - What stopped the browser from looking.
 * @param w.checkedAt - When.
 * @param w.attempt - Which attempt.
 * @param w.beforeMerge - The lines production cannot show.
 */
async function markFeatures(orgId: string, releaseId: number, requestIds: number[], w: { rows: LiveRow[]; blocking: LiveReason[]; checkedAt: string; attempt: number; beforeMerge: BeforeMergeLine[] }): Promise<void> {
  for (const requestId of requestIds) {
    const request = await readMeta(orgId, requestId);
    if (!request) {
      continue;
    }
    const own = w.rows.filter(r => r.requestId === requestId || r.requestId === null);
    const beforeMerge = w.beforeMerge.filter(b => b.requestId === requestId);
    const verdict = liveVerdict(own, w.blocking, beforeMerge);
    const shots = own.filter(r => r.status === 'reached' && r.artifactId !== null).map(r => r.artifactId!);
    const visuals = (request.meta.visuals && typeof request.meta.visuals === 'object' ? request.meta.visuals : {}) as Meta;
    const after = [...new Set([...ids(visuals.afterArtifactIds), ...shots])];
    await mergeMeta(orgId, requestId, {
      liveCheck: {
        state: verdict.state,
        line: verdict.line.slice(0, 500),
        releaseId,
        checkedAt: w.checkedAt,
        attempt: w.attempt,
        why: verdict.why,
        beforeMerge,
        // What it saw of each line, by its words: how the feature page reads a line QA left to it.
        lines: lineResults(own),
      },
      ...(shots.length > 0 ? { visuals: { ...visuals, afterArtifactIds: after } } : {}),
    });
    // Seen live, or shipped and not confirmed: the status says which.
    const { markStatus } = await import('@/services/objects/statusField');
    await markStatus(orgId, requestId, verdict.state === 'seen' ? 'live_seen' : 'shipped', { line: verdict.line.slice(0, 500) });
    const { noteOnRequest } = await import('./carry');
    await noteOnRequest(orgId, requestId, `${verdict.line} (release #${releaseId}, attempt ${w.attempt}).`).catch(() => undefined);
  }
}

/**
 * The live check's last word, when the attempts are spent and QA never saw
 * the change: written on the release and each feature, so nothing reads
 * healthy or simply shipped on the strength of a deploy alone.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param reason - Why it was not seen.
 * @param now - The clock.
 */
export async function liveCheckGaveUp(orgId: string, releaseId: number, reason: string, now: Date = new Date()): Promise<void> {
  const release = await readMeta(orgId, releaseId);
  if (!release) {
    return;
  }
  const { readReleaseLive } = await import('@/libs/factory/liveCheck');
  const live = readReleaseLive(release.meta);
  if (live?.state === 'seen' || live?.state === 'partial') {
    return;
  }
  const line = live?.line ?? notSeenLine(reason).slice(0, 500);
  const checkedAt = now.toISOString();
  if (!live) {
    await mergeMeta(orgId, releaseId, { liveState: 'not_seen', liveSummary: line, liveReason: reason.slice(0, 400), liveCheckedAt: checkedAt, liveProblems: [reason.slice(0, 400)] });
  }
  for (const requestId of ids(release.meta.requestIds)) {
    const request = await readMeta(orgId, requestId);
    const mark = (request?.meta.liveCheck && typeof request.meta.liveCheck === 'object' ? request.meta.liveCheck : {}) as Meta;
    if (!request || (mark.releaseId === releaseId && (mark.state === 'not_seen' || mark.state === 'seen'))) {
      continue;
    }
    await mergeMeta(orgId, requestId, { liveCheck: { ...mark, state: 'not_seen', line, releaseId, checkedAt } });
    const { markStatus } = await import('@/services/objects/statusField');
    await markStatus(orgId, requestId, 'shipped', { line });
    const { noteOnRequest } = await import('./carry');
    await noteOnRequest(orgId, requestId, `${line} (release #${releaseId}).`).catch(() => undefined);
  }
}

/**
 * QA's live-check fire ended (`automation_run.completed` / `.failed`, the
 * plugin's `release-live-check`): seen, checked once more carrying why the
 * first saw nothing, or — once the attempts are spent — "Live check could not
 * reach the change: <reason>" on the release and its features. A fire that
 * never called the check is a failure too, with that as its reason.
 * @param orgId - The workspace.
 * @param input - The event payload (`automationRunId`, `error` on a failure) and `attempts`.
 * @param now - The clock.
 */
export async function liveCheckEnded(orgId: string, input: Record<string, unknown>, now: Date = new Date()): Promise<{ releaseId: number | null; did: string; line: string | null }> {
  const runId = Number(input.automationRunId);
  if (!Number.isInteger(runId) || runId <= 0) {
    return { releaseId: null, did: 'skip', line: 'no fire named' };
  }
  const attempts = Number.isInteger(input.attempts) && Number(input.attempts) >= 1 ? Number(input.attempts) : undefined;
  const { automationRunSchema, automationSchema } = await import('@/models/Schema');
  const [run] = await db
    .select({ slug: automationRunSchema.slug, input: automationRunSchema.input, error: automationRunSchema.error, targetRunId: automationRunSchema.targetRunId, createdAt: automationRunSchema.createdAt })
    .from(automationRunSchema)
    .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.id, runId)))
    .limit(1);
  const fired = (run?.input ?? {}) as Meta;
  const releaseId = Number(fired.releaseId);
  if (!run || !Number.isInteger(releaseId) || releaseId <= 0) {
    return { releaseId: null, did: 'skip', line: 'no release on the fire' };
  }
  const release = await readMeta(orgId, releaseId);
  if (!release) {
    return { releaseId, did: 'skip', line: 'the release is gone' };
  }
  // WHY IT SAW NOTHING, from the fire itself: its error, else the check's own
  // last answer in the run, else that it never ran the check at all.
  let reason = typeof input.error === 'string' && input.error.trim() !== '' ? input.error.trim() : run.error ?? '';
  if (!reason && run.targetRunId) {
    const [auto] = await db.select({ doConfig: automationSchema.doConfig }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, run.slug))).limit(1);
    const tool = (auto?.doConfig as { requireTool?: string } | undefined)?.requireTool?.split(':')[0];
    if (tool) {
      const { lastToolAnswer } = await import('./mockupDefault');
      const last = await lastToolAnswer(orgId, run.targetRunId, tool);
      reason = last.called ? '' : `the QA run ended without calling ${tool}`;
    }
  }
  const { liveAfterRun } = await import('@/libs/factory/liveCheck');
  const next = liveAfterRun(release.meta, { startedAt: run.createdAt ?? now, reason: reason || null, attempt: Number(fired.attempt) || 1 }, attempts);
  if (next.do === 'done') {
    return { releaseId, did: 'done', line: next.why };
  }
  if (next.do === 'retry') {
    const { emitEvent, RELEASE_LIVE_CHECK_REQUESTED } = await import('@/services/EventService');
    const payload: import('@/services/EventService').ReleaseLiveCheckRequestedPayload = {
      releaseId,
      product: typeof release.meta.product === 'string' ? release.meta.product : null,
      userFacing: true,
      attempt: next.attempt,
      lastFailure: next.reason.slice(0, 600),
      requestIds: ids(release.meta.requestIds),
      taskIds: ids(release.meta.taskIds),
    };
    try {
      await emitEvent({ orgId, type: RELEASE_LIVE_CHECK_REQUESTED, payload, dedupeKey: `${RELEASE_LIVE_CHECK_REQUESTED}:${releaseId}:${next.attempt}`, invokedBy: 'job:live-check-ended', dispatchMode: 'auto' });
    } catch (err) {
      const why = `${next.reason}; the retry could not be started (${short(err)})`;
      await liveCheckGaveUp(orgId, releaseId, why, now);
      return { releaseId, did: 'gave-up', line: why };
    }
    return { releaseId, did: `retry:${next.attempt}`, line: next.reason };
  }
  await liveCheckGaveUp(orgId, releaseId, next.reason, now);
  return { releaseId, did: 'gave-up', line: next.reason };
}
