/**
 * WHAT A RUN TOKEN MAY DO (Vocion 5.1). A run token (`runToken.ts`) is the only Vocion credential
 * a runner keeps while repository code runs beside it, so it is held to the calls one run needs
 * and to that run alone:
 *
 * - its own run's callbacks: heartbeat, checkpoint, complete, fail, and reading the run;
 * - writing the task record and the QA evidence the run produces (`POST /objects`, `/artifacts`,
 *   `/artifacts/video`), in the run's workspace;
 * - the QA sign-in of the product the run builds (`GET /products/:slug/access`), and no other.
 *
 * Anything else is refused, before any route runs: another run's callbacks, claiming (the queue
 * or a run by id), listing runs, search, the MCP server. A start token does none of these; it
 * only claims its own run at `/api/v1/runner/claim`.
 *
 * And it is refused once its run no longer needs it: when another runner holds the run's lease,
 * when the run was lost, and `RUN_TOKEN_AFTERLIFE_MS` after the run finished (the runner writes the
 * task record just after its terminal call). Those refusals are 409s, the status every runner
 * image already reads as "this run is not yours any more" and stops its engineer on. Together with
 * its two-hour expiry (a 401), renewed by each heartbeat, that is what keeps a token copied out of
 * a container from outliving the run.
 *
 * The routes are matched on the request path, which is API structure, not anyone's words.
 */

import type { RunTokenClaim } from '@/services/runners/runToken';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workerRunSchema } from '@/models/Schema';
import { verifyRunToken } from '@/services/runners/runToken';

/** How long after its run ends a run token still works, for the task record written last. */
export const RUN_TOKEN_AFTERLIFE_MS = 10 * 60 * 1000;

/** A run still being built. */
const LIVE = new Set(['running', 'paused']);

type RunRoute = { method: string; path: RegExp; kind: 'own-run' | 'workspace' | 'own-product' };

/** The calls one run makes. Paths are relative to `/api/v1`. */
const RUN_ROUTES: readonly RunRoute[] = [
  { method: 'POST', path: /^\/worker-runs\/(\d+)\/(?:heartbeat|checkpoint|complete|fail)$/, kind: 'own-run' },
  { method: 'GET', path: /^\/worker-runs\/(\d+)$/, kind: 'own-run' },
  { method: 'POST', path: /^\/objects$/, kind: 'workspace' },
  { method: 'POST', path: /^\/artifacts$/, kind: 'workspace' },
  { method: 'POST', path: /^\/artifacts\/video$/, kind: 'workspace' },
  { method: 'GET', path: /^\/products\/([^/]+)\/access$/, kind: 'own-product' },
];

export type RunTokenVerdict
  = | { ok: true; claim: RunTokenClaim }
    | { ok: false; status: 401 | 403 | 409; code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'CONFLICT'; message: string };

const CODE = { 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 409: 'CONFLICT' } as const;
const refuse = (status: 401 | 403 | 409, message: string): RunTokenVerdict => ({ ok: false, status, code: CODE[status], message });

/**
 * The part of a request path after `/api/v1`, or null when it is not an API path.
 * @param url - The request URL.
 */
function apiPath(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://vocion.invalid').pathname;
  } catch {
    return null;
  }
  const at = pathname.indexOf('/api/v1/');
  return at === -1 ? null : pathname.slice(at + '/api/v1'.length).replace(/\/+$/, '');
}

/**
 * Decide whether a run token may make this request.
 * @param raw - The bearer value (`vrt_…`).
 * @param req - The request: its method and URL.
 * @param req.method - The HTTP method.
 * @param req.url - The request URL.
 * @param now - The clock.
 */
export async function authorizeRunToken(raw: string, req: { method: string; url: string }, now: Date = new Date()): Promise<RunTokenVerdict> {
  const claim = verifyRunToken(raw);
  if (!claim) {
    return refuse(401, 'This run token is not valid or has expired.');
  }
  if (claim.use === 'start') {
    return refuse(403, 'A start token only claims the run it was minted for, at /api/v1/runner/claim.');
  }
  const path = apiPath(req.url);
  const method = req.method.toUpperCase();
  const route = path === null ? undefined : RUN_ROUTES.find(r => r.method === method && r.path.test(path));
  if (!route || path === null) {
    return refuse(403, `A run token makes only its own run's calls; ${method} ${path ?? req.url} is not one of them.`);
  }
  const match = route.path.exec(path)!;
  if (route.kind === 'own-run' && Number(match[1]) !== claim.runId) {
    return refuse(403, `This run token is for run ${claim.runId}, not run ${match[1]}.`);
  }

  const [run] = await db
    .select({
      orgId: workerRunSchema.orgId,
      status: workerRunSchema.status,
      workerId: workerRunSchema.workerId,
      completedAt: workerRunSchema.completedAt,
      // The task contract only for the one route that reads it, not on every heartbeat.
      product: route.kind === 'own-product' ? sql<string | null>`${workerRunSchema.input} -> 'task' ->> 'product'` : sql<null>`null`,
    })
    .from(workerRunSchema)
    .where(eq(workerRunSchema.id, claim.runId))
    .limit(1);
  if (!run || run.orgId !== claim.orgId) {
    return refuse(401, 'This run token names a run that does not exist.');
  }
  if (claim.workerId && run.workerId !== claim.workerId) {
    return refuse(409, `Run ${claim.runId} is held by another runner now; this token was for the one that held it before.`);
  }
  if (!LIVE.has(run.status)) {
    const ended = run.completedAt?.getTime();
    if (ended === undefined || now.getTime() - ended > RUN_TOKEN_AFTERLIFE_MS) {
      return refuse(409, `Run ${claim.runId} is ${run.status}; its token ended with it.`);
    }
  }
  if (route.kind === 'own-product') {
    let asked: string | null = null;
    try {
      asked = decodeURIComponent(match[1]!);
    } catch {}
    if (!run.product || asked !== run.product) {
      return refuse(403, `This run token reads the QA sign-in of the product its run builds${run.product ? ` (${run.product})` : ''}, and no other.`);
    }
  }
  return { ok: true, claim };
}
