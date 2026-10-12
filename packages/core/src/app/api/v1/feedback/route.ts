import { NextResponse } from 'next/server';
import { readFieldEdits } from '@/services/feedback/editLearning';
import { enqueue, listJobs } from '@/services/FeedbackWorkerService';
import { authApi, isErrorResponse, jsonError, readJsonBody, readPagination } from '../_shared';

/** Sources the endpoint accepts. Anything else is a client mistake, not a new source. */
const ACCEPTED_SOURCES = ['api', 'manual', 'slack', 'drive', 'chat'] as const;

type AcceptedSource = typeof ACCEPTED_SOURCES[number];

/**
 * GET /api/v1/feedback
 *
 * An org's feedback jobs, newest first. Filter with `status`
 * (`queued` | `processing` | `classified` | `applied` | `failed` | `ignored`)
 * and `source`; page with `limit` and `offset`.
 * Auth: tenant API token or dashboard session.
 *
 * Query parameters:
 * - `status` — `queued`, `processing`, `classified`, `applied`, `failed` or
 *   `ignored`.
 * - `source` — only the jobs that arrived from one source.
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
 *   { source?, externalId?, payload: { text, quotedText?, artifactTitle?, targetSlug?, edits? } }
 *
 * The job is queued; the background worker classifies it, and a classification
 * that proposes a rule becomes a pending learning candidate. Nothing changes
 * how an agent behaves until someone approves that candidate.
 *
 * `edits` is the fields a reviewer corrected before approving, as
 * `[{ field, before, after }]` (at most 50), when your own screen is where
 * the review happens. The worker asks a model which corrections show a
 * pattern the agent should learn, skipping any the note already explains, and
 * each one that does becomes a pending candidate like any other. With `edits`
 * present `text` may be empty: the corrections are the feedback. Send
 * `quotedText` with the record as the agent proposed it, so a correction can
 * be read against what the agent was looking at.
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

  const payload = body.payload as { text?: unknown; edits?: unknown } | undefined;
  if (!payload || typeof payload !== 'object') {
    return jsonError('VALIDATION_FAILED', 'payload.text is required', 400);
  }
  const edits = readFieldEdits(payload.edits);
  if ('error' in edits) {
    return jsonError('VALIDATION_FAILED', edits.error, 400);
  }
  const hasText = typeof payload.text === 'string' && payload.text.trim() !== '';
  if (!hasText && edits.edits.length === 0) {
    return jsonError('VALIDATION_FAILED', 'payload.text is required unless payload.edits carries a correction', 400);
  }
  if (payload.text !== undefined && typeof payload.text !== 'string') {
    return jsonError('VALIDATION_FAILED', 'payload.text must be a string', 400);
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
    payload: {
      ...payload,
      text: hasText ? payload.text as string : '',
      ...(edits.edits.length > 0 ? { edits: edits.edits } : {}),
    } as Parameters<typeof enqueue>[0]['payload'],
  });
  return NextResponse.json(job);
}
