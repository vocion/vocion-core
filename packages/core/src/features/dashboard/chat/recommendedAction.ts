import type { RecommendedAction } from './types';

/**
 * The event boundary for `recommended_action`.
 *
 * A card is one tap away from `client.review.propose`, and at
 * `act-within-bounds` it fires that call the moment it renders — so a
 * malformed payload is not a rendering problem, it is an RPC the person never
 * asked for. On 2026-09-15 two of them went out with no `actionId` and came
 * back 400 ("expected string, received undefined"), which is the server
 * catching a mistake the client should never have been able to make.
 *
 * So the shape is checked once, here, where the event arrives — not in the
 * card, not in the router. A payload that cannot produce a valid call is
 * dropped with a reason the trace can show, and nothing downstream has to be
 * defensive about it.
 */

export type RecommendedActionCheck
  = | { ok: true; rec: RecommendedAction }
    | { ok: false; reason: string };

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Validate one `recommended_action` payload.
 *
 * Required: an `actionId` (what would be proposed) and a `label` (what the
 * person is being asked to agree to). `input` is normalised to an object,
 * because an action with no arguments is legitimate and an action with a
 * mangled one is not.
 * @param raw - `event.recommendation`, exactly as it arrived.
 */
export function readRecommendedAction(raw: unknown): RecommendedActionCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'the recommendation payload was missing' };
  }
  const r = raw as Record<string, unknown>;
  const actionId = text(r.actionId);
  if (!actionId) {
    return { ok: false, reason: 'the recommendation named no action, so there was nothing to prepare' };
  }
  const label = text(r.label);
  if (!label) {
    return { ok: false, reason: `the recommendation for "${actionId}" had no label, so there was nothing to agree to` };
  }
  const input = r.input && typeof r.input === 'object' && !Array.isArray(r.input)
    ? (r.input as Record<string, unknown>)
    : {};
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : undefined;
  const runId = typeof r.runId === 'number' && Number.isInteger(r.runId) ? r.runId : undefined;
  return {
    ok: true,
    rec: {
      actionId,
      label,
      input,
      ...(text(r.rationale) ? { rationale: text(r.rationale) } : {}),
      ...(confidence === undefined ? {} : { confidence }),
      ...(text(r.agentSlug) ? { agentSlug: text(r.agentSlug) } : {}),
      ...(runId === undefined ? {} : { runId }),
    },
  };
}
