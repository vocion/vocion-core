import { NextResponse } from 'next/server';
import { apiListReviews, apiListReviewTypes } from '@/services/writeApi';
import { authApi, isErrorResponse, readPagination, writeApiErrorResponse } from '../_shared';

/**
 * GET /api/v1/reviews
 *
 * The unified pending-review queue — paused workflow runs, missions awaiting
 * review, and pending action proposals — for the caller's org.
 *
 * Query parameters:
 * - `kind` — `workflow` | `mission` | `action`, to see one plane only.
 * - `actionIds` — comma-separated registered action ids, to see one CARD TYPE
 *   (`personalization.enroll`) rather than one plane. `total` narrows with it.
 *   Pass `types=1` instead to get the types present with their counts.
 * - `suggestedDecision` — `approve` | `reject` | `snooze`, to see the items the
 *   AGENT recommended that outcome for. Composes with `actionIds` and
 *   `assignedTo`, so several lanes can be cut from one pending set: everything
 *   a screener wants turned down in one, what it wants approved in another.
 *   Only action runs carry a recommendation, so this returns the action plane
 *   alone. An unrecognised value is a 400, never a silent whole-queue read.
 *   Note the tense: these are the verbs `/reviews/decide` takes, so it is
 *   `reject`, not the `rejected` that a recorded decision reads as. The two
 *   vocabularies sit next to each other in the same response, and `rejected`
 *   here is the mistake worth expecting.
 * - `approvedByAgent` — `true`, `false` or `null`, to see the items by WHO
 *   made the approval call: the trust ladder, a person, or nobody yet. What
 *   this cuts is the failed lane — a run whose approval stood and whose
 *   execution threw stays in the queue, and "the agent released this and it
 *   broke" is a different triage job from "a person approved it and it broke".
 *   `true` and `false` return the action plane alone, since no workflow or
 *   mission can be approved by an agent; `null` keeps all three, because an
 *   item nobody has decided is exactly what a paused workflow is. Composes
 *   with `actionIds`, `suggestedDecision` and `assignedTo`. Any other value is
 *   a 400, never a silent whole-queue read.
 * - `types` — `1` answers with the review types present and their counts,
 *   instead of the queue itself, so a client can build its filter list from
 *   what is actually waiting.
 * - `include` — `input`, `proposal` or both, comma-separated, to have those
 *   payloads inlined on each item rather than fetched one detail request at a
 *   time. A client that buckets the queue by something inside the payload —
 *   a date, a venue, whether the record is complete — otherwise makes one
 *   request per item to build a single screen. Opt-in because the payload is
 *   unbounded: a page of thin rows is a few KB and the same page carrying
 *   inputs can be a megabyte. Only action items have either payload to give.
 *   An unrecognised value is a 400, never a silent fall back to thin rows.
 * - `assignedTo` — a user id for that person's queue, or `unassigned` for triage.
 * - `includeSnoozed` — `true` to include items delayed into the future.
 * - `limit`, `offset` — the page window. The response carries the real total.
 *
 * Auth: a tenant API token (`Authorization: Bearer vcn_live_…`) or a
 * signed-in dashboard session.
 * @param req
 */
export async function GET(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const url = new URL(req.url);
  const { limit, offset } = readPagination(url);
  const actionIds = url.searchParams.get('actionIds');
  const include = url.searchParams.get('include');
  try {
    if (url.searchParams.get('types') === '1') {
      return NextResponse.json({ types: await apiListReviewTypes(caller) });
    }
    return NextResponse.json(await apiListReviews(caller, {
      assignedTo: url.searchParams.get('assignedTo') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      actionIds: actionIds === null ? undefined : actionIds.split(',').map(s => s.trim()).filter(Boolean),
      include: include === null ? undefined : include.split(',').map(s => s.trim()).filter(Boolean),
      suggestedDecision: url.searchParams.get('suggestedDecision') ?? undefined,
      approvedByAgent: url.searchParams.get('approvedByAgent') ?? undefined,
      includeSnoozed: url.searchParams.get('includeSnoozed') === 'true',
      limit,
      offset,
    }));
  } catch (e) {
    return writeApiErrorResponse(e);
  }
}
