import { NextResponse } from 'next/server';
import { enqueue, listJobs } from '@/services/FeedbackWorkerService';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination } from '../_shared';

/** Sources the endpoint accepts. Anything else is a client mistake, not a new source. */
const ACCEPTED_SOURCES = ['api', 'manual', 'slack', 'drive'] as const;

type AcceptedSource = typeof ACCEPTED_SOURCES[number];

/**
 * GET /api/v1/feedback
 *
 * An org's feedback jobs, newest first. Filter with `status`
 * (`queued` | `processing` | `classified` | `applied` | `failed` | `ignored`)
 * and `source`; page with `limit` and `offset`.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  return NextResponse.json(await listJobs(caller.orgId, {
    status: url.searchParams.get('status') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    limit,
    offset,
  }));
}

/**
 * POST /api/v1/feedback
 *
 * Submit a reviewer's written feedback. Body:
 *
 *   { source?, externalId?, payload: { text, quotedText?, artifactTitle?, targetSlug? } }
 *
 * The job is queued; the background worker classifies it, and a classification
 * that proposes a rule becomes a pending learning candidate. Nothing changes
 * how an agent behaves until someone approves that candidate.
 *
 * `externalId` makes the call idempotent — posting the same one twice returns
 * the same job instead of queueing a duplicate. Supply the id of whatever the
 * feedback lives on in your own system. Without one, every call is a new job.
 *
 * `targetSlug` is the learning step a resulting rule would attach to. Feedback
 * that names no target is still classified, but cannot become a candidate.
 * Auth: tenant API token or dashboard session.
 * @param req
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const body = await readJsonBody(req);
  if (isErrorResponse(body)) {
    return body;
  }

  const source = (body.source as string | undefined) ?? 'api';
  if (!ACCEPTED_SOURCES.includes(source as AcceptedSource)) {
    return jsonError('VALIDATION_FAILED', `source must be one of ${ACCEPTED_SOURCES.join('|')}`, 400);
  }

  const payload = body.payload as { text?: unknown } | undefined;
  if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string' || !payload.text.trim()) {
    return jsonError('VALIDATION_FAILED', 'payload.text is required', 400);
  }

  const externalId = typeof body.externalId === 'string' && body.externalId.trim()
    ? body.externalId.trim()
    // No caller-supplied id means no idempotency to enforce, so mint a unique
    // one rather than colliding every submission onto a single row.
    : `${source}:${crypto.randomUUID()}`;

  const job = await enqueue({
    orgId: caller.orgId,
    source: source as AcceptedSource,
    externalId,
    payload: payload as Parameters<typeof enqueue>[0]['payload'],
  });
  return NextResponse.json(job);
}
