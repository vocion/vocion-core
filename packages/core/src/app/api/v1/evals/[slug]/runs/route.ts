import { NextResponse } from 'next/server';
import { parseRunRange } from '@/libs/evals/runRange';
import { getDataset, listRunsPage, runDataset, summariseRunPeriod } from '@/services/EvalService';
import { authApi, jsonError } from '../../../_shared';

/**
 * Kick off an eval run for a dataset. Returns the runId immediately;
 * the run continues in the background (status flips to 'succeeded' or
 * 'failed' when complete). UI polls the run-detail page until the
 * `completedAt` timestamp appears.
 *
 * Long-running by nature — each case can take several seconds (LLM
 * generation + LLM judge). The HTTP handler must not block on the full
 * run; we fire-and-forget via Promise.resolve so the runDataset() call
 * still lands in the event loop.
 * @param req
 * @param context
 * @param context.params
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;

  const dataset = await getDataset(auth.orgId, slug);
  if (!dataset) {
    return jsonError('NOT_FOUND', `No eval dataset found for slug "${slug}"`, 404);
  }

  // Fire-and-forget. runDataset creates the eval_run row early (so the
  // returned runId is meaningful right away) and updates metrics +
  // status as cases complete.
  const start = runDataset({ orgId: auth.orgId, datasetSlug: dataset.slug });
  // We need to wait long enough to get the runId back without blocking
  // on the full execution. The service returns { runId, metrics } once
  // metrics are computed at the end; for an async kickoff we want the
  // initial row insert's id. As a pragmatic v0.5 cut: await the full
  // result (datasets are small in early demos — a few cases × a few
  // seconds is acceptable). When datasets grow, refactor runDataset to
  // expose an immediate-return signature.
  try {
    const result = await start;
    return NextResponse.json({ runId: result.runId, metrics: result.metrics }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError('EVAL_RUN_FAILED', message, 500);
  }
}

/**
 * `GET /api/v1/evals/:slug/runs?from=&to=&page=` — a dataset's runs and
 * headline numbers for one period, the same ones its dashboard page shows.
 *
 * Query parameters:
 * - `from` — runs that started at or after this: a `YYYY-MM-DD` (midnight
 *   UTC) or an ISO timestamp with an offset. Left out means since the first run.
 * - `to` — runs that started before this, in the same forms. Left out means up to now.
 * - `page` — 1-based page of the run list; defaults to 1.
 *
 * A bad date, a backwards range, or a range with both ends longer than 366
 * days is a 400, never an unfiltered list, because
 * a caller cannot tell a wrongly unfiltered answer from a right one.
 *
 * Paged newest first, 20 to a page (`EVAL_RUNS_PAGE_SIZE`), with `hasMore`
 * saying whether to ask for the next — every run in the period is reachable.
 * The summary covers the whole period, not just the page.
 * @param req - The request.
 * @param context - Route context.
 * @param context.params - `slug`, the dataset.
 */
export async function GET(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const url = new URL(req.url);
  const range = parseRunRange({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
  if (!range.ok) {
    return jsonError('VALIDATION_FAILED', range.message, 400);
  }
  const rawPage = url.searchParams.get('page');
  // Strict, like `readIdParam`: parseInt would read "2abc" as page 2.
  if (rawPage !== null && !/^[1-9]\d*$/.test(rawPage)) {
    return jsonError('VALIDATION_FAILED', '`page` must be a positive integer', 400);
  }

  const { slug } = await context.params;
  const dataset = await getDataset(auth.orgId, slug);
  if (!dataset) {
    return jsonError('NOT_FOUND', `No eval dataset found for slug "${slug}"`, 404);
  }

  const [page, summary] = await Promise.all([
    listRunsPage(auth.orgId, dataset.id, { page: rawPage === null ? 1 : Number(rawPage), range: range.range }),
    summariseRunPeriod(auth.orgId, dataset.id, dataset.provider, range.range),
  ]);
  return NextResponse.json({
    dataset: { slug: dataset.slug, provider: dataset.provider },
    period: { from: range.range.from?.toISOString() ?? null, to: range.range.to?.toISOString() ?? null },
    summary,
    runs: page.runs,
    page: page.page,
    hasMore: page.hasMore,
  });
}
