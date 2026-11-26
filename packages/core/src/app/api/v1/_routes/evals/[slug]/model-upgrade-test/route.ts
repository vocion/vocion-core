import { NextResponse } from 'next/server';
import { runModelUpgradeTest } from '@/services/evals/modelUpgradeTest';
import { getDataset } from '@/services/EvalService';
import { authApi, isErrorResponse, jsonError, readJsonBody } from '../../../_shared';

const PROVIDERS = new Set(['anthropic', 'openai', 'bedrock']);

/**
 * `POST /api/v1/evals/:slug/model-upgrade-test` — run the dataset on a
 * baseline model and a candidate model, compare on cost per passed case,
 * publish the comparison as a briefing.
 *
 * Body: `{ baselineModel, candidateModel, baselineProvider?, candidateProvider?, publish? }`.
 * Returns `201 { baselineRunId, candidateRunId, briefingId, comparison }`.
 *
 * Auth: a tenant API token (`Bearer vcn_live_…`) or a dashboard session — the
 * same as every `/api/v1` route. Like `POST /evals/:slug/runs`, the handler
 * awaits both runs: datasets are small and the dashboard button is the
 * caller. Split kickoff from completion when datasets grow.
 * @param req - The request; JSON body as above.
 * @param context - Route context.
 * @param context.params - The dataset slug.
 */
export async function POST(req: Request, context: { params: Promise<{ slug: string }> }) {
  const auth = await authApi(req);
  if ('status' in auth) {
    return auth;
  }
  const { slug } = await context.params;

  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }
  const baselineModel = str(body.baselineModel);
  const candidateModel = str(body.candidateModel);
  if (!baselineModel || !candidateModel) {
    return jsonError('VALIDATION_FAILED', 'baselineModel and candidateModel are required', 400);
  }
  if (baselineModel === candidateModel) {
    return jsonError('VALIDATION_FAILED', 'baselineModel and candidateModel must differ', 400);
  }
  const baselineProvider = str(body.baselineProvider);
  const candidateProvider = str(body.candidateProvider);
  for (const p of [baselineProvider, candidateProvider]) {
    if (p && !PROVIDERS.has(p)) {
      return jsonError('VALIDATION_FAILED', `unknown provider "${p}"; expected anthropic | openai | bedrock`, 400);
    }
  }

  const dataset = await getDataset(auth.orgId, slug);
  if (!dataset) {
    return jsonError('NOT_FOUND', `No eval dataset found for slug "${slug}"`, 404);
  }

  try {
    const result = await runModelUpgradeTest({
      orgId: auth.orgId,
      datasetSlug: dataset.slug,
      baselineModel,
      candidateModel,
      baselineProvider: baselineProvider as 'anthropic' | 'openai' | 'bedrock' | undefined,
      candidateProvider: candidateProvider as 'anthropic' | 'openai' | 'bedrock' | undefined,
      publish: body.publish !== false,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError('MODEL_UPGRADE_TEST_FAILED', message, 500);
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
