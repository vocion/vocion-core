/**
 * THE LIVE CHECK, run from Vocion: QA's flows for a release, on the live
 * product, signed in as the product's QA account, in the browser where the
 * agents' tools run (the app and the Temporal worker both carry Chromium).
 * The decisions are `libs/factory/liveCheck.ts`; the tool is `check_live`.
 *
 * Where the browser runs, decided 2026-10-01: here, not on a runner. The
 * runner's contract is an engineering task (a repo, a base sha, allowed
 * paths, a model to run); a QA-only run would be a second contract, a run
 * token that may reveal a sign-in, and a round trip of minutes the seat
 * cannot see from its turn. A check here answers inside QA's turn, so QA
 * can look at what the page said and try again with it. The capture code is
 * the runner's own (`packages/runner/src/qa.mjs` `shootFlow`), loaded from
 * disk, so both sides drive a page the one way.
 *
 * The password is read here and handed to the browser; it never reaches the
 * tool's answer, the record or a log line.
 */

import type { Buffer } from 'node:buffer';
import type { Browser, BrowserContext } from 'playwright';
import type { AcceptanceLine, BeforeMergeLine, LiveFlow, LiveReason, LiveRow, LiveVerdict, NotObservable, RunnerResponseProof, RunnerShot } from '@/libs/factory/liveCheck';
import type { Author } from '@/services/ArtifactService';
import type { EnvironmentAccess } from '@/services/factory/productAccess';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { acceptanceLines, keptShots, LIVE_LIMITS, LIVE_ROLE, liveVerdict, notSeenLine, orderedFlows, pickAnnouncementImage, resolveLines, SETUP_PAGE_VAR, stepReason, uncheckedRow } from '@/libs/factory/liveCheck';
import { businessObjectSchema } from '@/models/Schema';

type Meta = Record<string, unknown>;

/** The parts of the runner's QA module the check drives. */
export type RunnerQa = {
  shootFlow: (opts: {
    browser: Browser;
    base: string;
    flow: { name: string; path: string; steps: Array<Record<string, unknown>> };
    viewport: string;
    side: string;
    outDir: string;
    context: BrowserContext;
    stopAtFailure: boolean;
    vars: Record<string, string>;
    allow: (url: string) => boolean;
    withText: boolean;
  }) => Promise<{ shots: RunnerShot[]; stepFailures: Array<{ index: number; verb: string; target: string; error: string }>; httpStatus?: number | null; responses?: RunnerResponseProof[] }>;
  stepFailureText: (f: { index: number; verb: string; target: string; error: string }) => string;
  viewportContextOptions: (viewport: string) => Record<string, unknown>;
  isSignInPath: (pathname: string) => boolean;
};

/**
 * The runner's QA module, from disk. The path is only known at runtime, so
 * the build leaves it alone; `next.config.ts` traces the file into the image.
 */
async function loadRunnerQa(): Promise<RunnerQa> {
  const { fromRepoRoot } = await import('@/libs/repo-root');
  const file = fromRepoRoot('packages/runner/src/qa.mjs');
  return await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ pathToFileURL(file).href) as RunnerQa;
}

/** What the check needs from outside, so a test can stand in for the browser and the store. */
export type LiveCheckDeps = {
  browser: () => Promise<Browser>;
  qa: () => Promise<RunnerQa>;
  store: (orgId: string, png: Buffer) => Promise<{ url: string; filename: string; bytes: number; contentType: string }>;
  now: () => Date;
};

const defaultDeps: LiveCheckDeps = {
  browser: async () => (await import('@/libs/documents/render')).sharedBrowser(),
  qa: loadRunnerQa,
  store: async (orgId, png) => {
    const { saveArtifact } = await import('@/libs/tools/artifacts/store');
    const f = await saveArtifact({ orgId, data: png, ext: 'png', contentType: 'image/png' });
    return { url: f.url, filename: f.filename, bytes: f.bytes, contentType: f.contentType };
  },
  now: () => new Date(),
};

/** One flow at one viewport, as the tool tells QA what happened. */
export type LiveRunReport = {
  phase: LiveFlow['phase'];
  flow: string;
  viewport: string;
  /** Every step ran. */
  ok: boolean;
  /** The first step that failed, or why the flow could not run. */
  failure: string | null;
  shots: Array<{ label: string; at: string; status: 'reached' | 'not_reached'; reason: string | null; artifactId: number | null; pageText: string }>;
};

export type LiveCheckResult = {
  ok: boolean;
  releaseId: number;
  product: string | null;
  explore: boolean;
  attempt: number | null;
  verdict: LiveVerdict;
  runs: LiveRunReport[];
  problems: string[];
  /** What was written, in one line, or why nothing was. */
  written: string;
  /** Each request the release shipped and its acceptance lines, numbered: what a check flow cites. */
  acceptance: Array<{ requestId: number; lines: AcceptanceLine[] }>;
  /** The lines QA said production cannot show, as the release and the features now carry them. */
  beforeMerge: BeforeMergeLine[];
  /** Set when the flows cited a line the record does not have: nothing ran or was written. */
  refused?: string;
};

const short = (e: unknown, n = 240) => String((e as Error)?.message ?? e ?? '').split('\n')[0]!.slice(0, n);

/**
 * The environment a flow runs on: the one whose surface it names, else the
 * one that carries the QA sign-in, else the first with an address.
 * @param flow - The flow.
 * @param envs - The product's environments.
 */
export function environmentFor(flow: Pick<LiveFlow, 'surface'>, envs: readonly EnvironmentAccess[]): EnvironmentAccess | null {
  const withUrl = envs.filter(e => e.url);
  if (flow.surface) {
    return withUrl.find(e => e.surface === flow.surface || e.slug === flow.surface) ?? null;
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
 * @param qa - The runner's module.
 */
async function signIn(context: BrowserContext, env: EnvironmentAccess, qa: RunnerQa): Promise<string> {
  const login = env.login!;
  const page = await context.newPage();
  try {
    await page.goto(login.signInUrl || `${String(env.url).replace(/\/+$/, '')}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByLabel('Email', { exact: true }).first().fill(login.email ?? '', { timeout: 15000 });
    await page.getByLabel('Password', { exact: true }).first().fill(login.password ?? '', { timeout: 15000 });
    await page.getByRole('button', { name: 'Sign in', exact: true }).or(page.locator('button[type=submit]')).first().click({ timeout: 15000 });
    try {
      await page.waitForURL(u => !qa.isSignInPath(u.pathname), { timeout: 30000 });
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
function signInProblem(env: EnvironmentAccess): string {
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
 * Run a release's live check: setup, check, cleanup, on the live product, and
 * — unless it only explores — write what it saw on the release and on each
 * feature it shipped. Never throws for something the product or the flow did:
 * every failure is a row or a problem with its reason.
 * @param orgId - The workspace.
 * @param input - The release and QA's flows.
 * @param input.releaseId - The release record.
 * @param input.flows - QA's flows, validated (`LiveFlowSchema`).
 * @param input.explore - Run and report; write nothing, attach nothing.
 * @param input.notObservable - The acceptance lines QA says the live product cannot show.
 * @param opts - Who ran it.
 * @param opts.author - Who the shots are recorded as.
 * @param opts.provenance - The run it ran in, for each shot's source line.
 * @param opts.provenance.agentSlug - The seat.
 * @param opts.provenance.missionRunId - The run.
 * @param deps - The browser, the runner's module and the store.
 */
export async function runLiveCheck(
  orgId: string,
  input: { releaseId: number; flows: LiveFlow[]; explore?: boolean; notObservable?: NotObservable[] },
  opts: { author: Author; provenance?: { agentSlug?: string | null; missionRunId?: number | null } },
  deps: Partial<LiveCheckDeps> = {},
): Promise<LiveCheckResult> {
  const d = { ...defaultDeps, ...deps };
  const explore = input.explore === true;
  const release = await readMeta(orgId, input.releaseId);
  const product = release ? (typeof release.meta.product === 'string' && release.meta.product.trim() ? release.meta.product.trim() : null) : null;
  const runs: LiveRunReport[] = [];
  const rows: LiveRow[] = [];
  const problems: string[] = [];
  // What stopped flows from running, typed where it happened (`LiveReason`).
  const blocking: Array<string | LiveReason> = [];
  const acceptance: LiveCheckResult['acceptance'] = [];
  const fail = (why: string): LiveCheckResult => {
    const verdict = liveVerdict([], [why]);
    return { ok: false, releaseId: input.releaseId, product, explore, attempt: null, verdict, runs, problems: [why], written: `nothing written: ${why}`, acceptance, beforeMerge: [] };
  };
  if (!release) {
    return fail(`release #${input.releaseId} does not exist in this workspace`);
  }
  if (!product) {
    return fail(`release #${input.releaseId} names no product, so there is no live product to check`);
  }
  const requestIds = ids(release.meta.requestIds);
  const onlyRequest = requestIds.length === 1 ? requestIds[0]! : null;
  // WHAT THE FEATURES PROMISED, from their records: a check flow cites one of these lines by its
  // number, and a line it cites that is not there is refused before anything runs.
  const linesByRequest = new Map<number, AcceptanceLine[]>();
  for (const id of requestIds) {
    const request = await readMeta(orgId, id);
    if (request) {
      linesByRequest.set(id, acceptanceLines(request.meta));
      acceptance.push({ requestId: id, lines: linesByRequest.get(id)! });
    }
  }
  const resolved = resolveLines(input.flows, input.notObservable ?? [], linesByRequest, { explore });
  if (!resolved.ok) {
    const verdict = liveVerdict([], [resolved.refusal]);
    return { ok: false, releaseId: input.releaseId, product, explore, attempt: null, verdict, runs, problems: [], written: 'nothing run or written: the flows cite a line the record does not have', acceptance, beforeMerge: [], refused: resolved.refusal };
  }
  const { beforeMerge, uncovered } = resolved;
  const { productAccess } = await import('@/services/factory/productAccess');
  const access = await productAccess(orgId, product, { reveal: true });
  const envs = access.environments;
  const flows = orderedFlows(resolved.flows);
  const vars: Record<string, string> = {};
  const origins = allowedOrigins(envs);
  const allow = (url: string) => {
    try {
      return origins.has(new URL(url).origin);
    } catch {
      return false;
    }
  };
  const started = d.now().getTime();
  let runsLeft = LIVE_LIMITS.runs;
  let setupFailed = '';
  let setupWhy: LiveReason | null = null;

  if (envs.length === 0) {
    problems.push(`no production environment is recorded for ${product}; an environment record names its product, stage, url and QA sign-in`);
    blocking.push(problems[0]!);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocion-live-'));
  const contexts = new Map<string, Promise<{ context: BrowserContext; error: string }>>();
  let browser: Browser | null = null;
  let qa: RunnerQa | null = null;
  try {
    if (envs.length > 0 && flows.length > 0) {
      try {
        qa = await d.qa();
        browser = await d.browser();
      } catch (e) {
        const why = `the live check could not start a browser on this installation: ${short(e)}`;
        problems.push(why);
        blocking.push(why);
      }
    }
    const contextFor = (env: EnvironmentAccess, viewport: string, signedIn: boolean) => {
      const key = `${env.slug}|${viewport}|${signedIn ? 'in' : 'out'}`;
      if (!contexts.has(key)) {
        contexts.set(key, (async () => {
          const context = await browser!.newContext(qa!.viewportContextOptions(viewport));
          // A confirm() is answered yes: a cleanup that deletes asks first.
          context.on('page', p => p.on('dialog', dlg => void dlg.accept().catch(() => {})));
          if (!signedIn) {
            return { context, error: '' };
          }
          const problem = signInProblem(env);
          if (problem) {
            return { context, error: problem };
          }
          const failed = await signIn(context, env, qa!);
          return { context, error: failed ? `signing in to ${env.slug} as the QA account failed: ${failed}` : '' };
        })());
      }
      return contexts.get(key)!;
    };

    for (const flow of browser && qa ? flows : []) {
      const env = environmentFor(flow, envs);
      for (const viewport of flow.viewports) {
        const report: LiveRunReport = { phase: flow.phase, flow: flow.name, viewport, ok: false, failure: null, shots: [] };
        runs.push(report);
        const requestId = flow.request_id ?? onlyRequest;
        const cites = flow.line !== undefined ? { line: flow.line } : {};
        const missRow = (reason: string, why: LiveReason) => rows.push({ requestId, flow: flow.name, ...cites, criterion: flow.criterion ?? null, viewport, artifactId: null, status: 'not_reached', reason: reason.slice(0, 400), why: { ...why, detail: why.detail.slice(0, 400) }, url: null });
        // Typed where it happened; a bare reason is a check that could not run.
        const note = (why: string, typed: Omit<LiveReason, 'detail'> = { kind: 'could_not_run' }) => {
          report.failure = why;
          if (flow.phase === 'check') {
            const reason = setupFailed ? `${why} (setup did not finish: ${setupFailed})` : why;
            missRow(reason, setupWhy ?? { ...typed, flow: flow.name, detail: reason });
          } else if (flow.phase === 'setup') {
            setupFailed ||= `"${flow.name}": ${why}`;
            const p = `setup "${flow.name}" (${viewport}) did not finish: ${why}`;
            const t: LiveReason = { ...typed, kind: typed.kind === 'sign_in_failed' ? 'sign_in_failed' : 'setup_failed', flow: flow.name, detail: p };
            setupWhy ??= t;
            problems.push(p);
            blocking.push(t);
          } else {
            problems.push(`cleanup "${flow.name}" (${viewport}) did not finish: ${why}; what setup made may still be on ${env?.slug ?? 'production'}`);
          }
        };
        // Cleanup always runs, past the limits too: what setup made must not be left behind.
        if (flow.phase !== 'cleanup' && (runsLeft <= 0 || (d.now().getTime() - started) / 1000 > LIVE_LIMITS.seconds)) {
          note(`not run: a live check stops at ${LIVE_LIMITS.runs} runs or ${LIVE_LIMITS.seconds}s`);
          continue;
        }
        runsLeft -= 1;
        if (!env) {
          note(flow.surface ? `no environment of ${product} serves the ${flow.surface} surface` : `no environment of ${product} has an address`);
          continue;
        }
        try {
          const { context, error } = await contextFor(env, viewport, flow.signed_in);
          if (error) {
            note(error, { kind: 'sign_in_failed' });
            continue;
          }
          const result = await qa!.shootFlow({ browser: browser!, base: String(env.url).replace(/\/+$/, ''), flow: { name: flow.name, path: flow.path, steps: flow.steps }, viewport, side: 'live', outDir, context, stopAtFailure: true, vars, allow, withText: true });
          const failure = result.stepFailures[0] ? qa!.stepFailureText(result.stepFailures[0]) : null;
          // The page itself was not there: production answered 404 for the flow's path.
          const missing = result.httpStatus === 404 ? { kind: 'page_not_found' as const, flow: flow.name, path: flow.path } : null;
          const typedFailure = (detail: string): LiveReason => (missing
            ? { ...missing, detail }
            : result.stepFailures[0] ? stepReason(flow.phase, flow.name, result.stepFailures[0], detail) : { kind: 'could_not_run', flow: flow.name, detail });
          report.ok = !failure;
          report.failure = failure;
          if (flow.phase !== 'check') {
            const last = result.shots.at(-1);
            // THE PAGE SETUP ENDED ON CARRIES ON (run 3, 2026-10-01): a check opens what setup
            // made by naming it, as {{setupPage}} (the last setup flow that finished), beside
            // anything setup remembered by its own name.
            if (flow.phase === 'setup' && !failure && last?.at) {
              vars[SETUP_PAGE_VAR] = `${new URL(String(env.url)).origin}${last.at}`;
            }
            report.shots.push({ label: last?.label ?? '', at: last?.at ?? '', status: failure ? 'not_reached' : 'reached', reason: failure, artifactId: null, pageText: last?.text ?? '' });
            if (failure) {
              const { detail: _d, ...typed } = typedFailure(failure);
              note(failure, typed);
            }
            continue;
          }
          // What the flow's expect_response steps saw answer as promised, said as a person reads it.
          const proved = (result.responses ?? []).map(r => `${r.method} ${r.path} returned ${r.status}${flow.signed_in ? ' signed in' : ' to a visitor'}`);
          for (const { shot, status, reason, kind } of keptShots(flow.path, result)) {
            let artifactId: number | null = null;
            const why = reason && status !== 'reached' && setupFailed ? `${reason} (setup did not finish: ${setupFailed})` : reason;
            const typed: LiveReason | null = !why || status === 'reached'
              ? null
              : setupWhy ?? (kind === 'not_visible' || missing ? typedFailure(why) : { kind: kind ?? 'could_not_run', flow: flow.name, detail: why });
            const pageUrl = `${new URL(String(env.url)).origin}${shot.at || ''}`;
            if (!explore) {
              artifactId = await attachShot(orgId, input.releaseId, d, { file: shot.file, flow, viewport, label: shot.label, status, reason: why ?? null, pageUrl, author: opts.author, provenance: opts.provenance, proved: status === 'reached' ? proved : [] }).catch((e) => {
                const p = `a live shot could not be stored on the release: ${short(e)}`;
                if (!problems.includes(p)) {
                  problems.push(p);
                }
                return null;
              });
            }
            rows.push({ requestId, flow: flow.name, ...cites, criterion: flow.criterion ?? null, viewport, artifactId, status, ...(why ? { reason: why.slice(0, 400) } : {}), ...(typed ? { why: { ...typed, detail: typed.detail.slice(0, 400) } } : {}), url: pageUrl, ...(shot.label ? { label: shot.label } : {}), ...(status === 'reached' && proved.length > 0 ? { proved } : {}) });
            report.shots.push({ label: shot.label, at: shot.at, status, reason: why ?? null, artifactId, pageText: shot.text ?? '' });
          }
        } catch (e) {
          note(`the flow could not run: ${short(e)}`);
        }
      }
    }
  } finally {
    for (const c of contexts.values()) {
      await c.then(x => x.context.close()).catch(() => {});
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  if (explore) {
    const verdict = liveVerdict(rows, blocking, beforeMerge);
    return { ok: verdict.state === 'seen', releaseId: input.releaseId, product, explore, attempt: null, verdict, runs, problems, written: 'nothing written: this was an exploring run', acceptance, beforeMerge };
  }
  // A line nothing checked on production stands unproven, said why: one QA never cited, and one QA
  // said production cannot show that its verdict did not prove before the merge.
  for (const u of uncovered) {
    rows.push(uncheckedRow(u.requestId, u.line, false));
  }
  for (const b of beforeMerge.filter(x => !x.proven)) {
    rows.push(uncheckedRow(b.requestId, { n: b.line, text: b.text, provenBeforeMerge: false }, true));
  }
  const verdict = liveVerdict(rows, blocking, beforeMerge);
  const attempt = (Number.isInteger(release.meta.liveAttempts) ? Number(release.meta.liveAttempts) : 0) + 1;
  const checkedAt = d.now().toISOString();
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
  await markFeatures(orgId, input.releaseId, requestIds, { rows, blocking, flows, checkedAt, attempt, beforeMerge });
  return {
    ok: verdict.state === 'seen',
    releaseId: input.releaseId,
    product,
    explore,
    attempt,
    verdict,
    runs,
    problems,
    written: `release #${input.releaseId}: ${verdict.line}${pick ? `; the announcement leads with artifact #${pick}` : ''}`,
    acceptance,
    beforeMerge,
  };
}

/**
 * Store one live shot and file it on the release as a `live-screenshot`, its
 * caption saying what it shows and whether the state was reached.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param d - The store.
 * @param s - The shot.
 * @param s.file - Where the runner wrote it.
 * @param s.flow - Its flow.
 * @param s.viewport - Its viewport.
 * @param s.label - The flow's own label for it.
 * @param s.status - Reached or not.
 * @param s.reason - Why not.
 * @param s.pageUrl - The page it was taken on.
 * @param s.author - Who it is recorded as.
 * @param s.provenance - The run it was taken in.
 * @param s.provenance.agentSlug - The seat.
 * @param s.provenance.missionRunId - The run.
 * @param s.proved - What its expect_response steps saw answer as promised.
 */
async function attachShot(orgId: string, releaseId: number, d: LiveCheckDeps, s: { file: string; flow: LiveFlow; viewport: string; label: string; status: 'reached' | 'not_reached'; reason: string | null; pageUrl: string; author: Author; provenance?: { agentSlug?: string | null; missionRunId?: number | null }; proved?: string[] }): Promise<number> {
  const stored = await d.store(orgId, fs.readFileSync(s.file));
  const what = s.flow.criterion ?? s.label ?? s.flow.name;
  const caption = `${what}${s.status === 'reached' ? (s.proved?.length ? ` (${s.proved.join('; ')})` : '') : ` (not reached: ${s.reason ?? 'unknown'})`}`.slice(0, 300);
  const { createArtifact } = await import('@/services/ArtifactService');
  const { artifact } = await createArtifact({
    orgId,
    conversationId: null,
    kind: 'file',
    title: `${s.flow.name} · ${s.viewport} · live`.slice(0, 120),
    spec: {
      filename: stored.filename,
      contentType: stored.contentType,
      bytes: stored.bytes,
      url: stored.url,
      caption,
      capturedFrom: s.pageUrl.slice(0, 2000),
      provenance: { by: s.author.id ?? null, releaseId, liveCheck: true, agentSlug: s.provenance?.agentSlug ?? null, missionRunId: s.provenance?.missionRunId ?? null },
    },
    url: null,
    record: { type: 'object', id: String(releaseId), role: LIVE_ROLE },
    author: s.author,
    changeSummary: `Live check of release #${releaseId}: ${caption}`.slice(0, 200),
    visibility: 'user',
  });
  return artifact.id;
}

/**
 * Each feature the release shipped hears what the live check saw: its
 * `liveCheck` (state, the line, the flows that checked it — kept to be
 * reused), its reached shots added to its after pictures (the carousel's
 * Live section), and a line on its timeline.
 * @param orgId - The workspace.
 * @param releaseId - The release.
 * @param requestIds - The features it shipped.
 * @param w - What the check saw.
 * @param w.rows - The check rows.
 * @param w.blocking - What stopped flows from running.
 * @param w.flows - The flows.
 * @param w.checkedAt - When.
 * @param w.attempt - Which attempt.
 * @param w.beforeMerge - The lines production cannot show.
 */
async function markFeatures(orgId: string, releaseId: number, requestIds: number[], w: { rows: LiveRow[]; blocking: Array<string | LiveReason>; flows: LiveFlow[]; checkedAt: string; attempt: number; beforeMerge: BeforeMergeLine[] }): Promise<void> {
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
        flows: w.flows.filter(f => f.request_id === undefined || f.request_id === requestId),
        why: verdict.why,
        beforeMerge,
      },
      ...(shots.length > 0 ? { visuals: { ...visuals, afterArtifactIds: after } } : {}),
    });
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
