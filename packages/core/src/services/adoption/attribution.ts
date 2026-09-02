import type { AdoptionActor } from './track';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, missionRunSchema } from '@/models/Schema';
import { track } from './track';

/**
 * Agent attribution for HITL events, plus the ONE choke point every
 * review-decision and review-feedback capture goes through — routers and
 * services call these instead of hand-rolling `track()` calls, so the
 * event shape and attribution rules can't drift between call sites.
 *
 * Attribution is honest-or-null: an event carries an `agentSlug` only
 * when the run maps to exactly one agent. Ambiguous cases (a capability shared
 * by several agents, multi-agent workflows) stay null rather than guess —
 * per-agent trust metrics must never count another agent's runs.
 */

export type ReviewRunKind = 'workflow' | 'mission' | 'action';

/**
 * Best-effort agent slug for a run. Never throws; returns null when the
 * run is missing or attribution would be a guess.
 *
 * - mission  → the run's `team.lead`
 * - action   → the proposing `invokedBy: 'agent:<slug>'`
 * - workflow → null (steps may span agents; no honest run-level owner)
 * @param orgId
 * @param kind
 * @param runId
 */
export async function resolveRunAgentSlug(
  orgId: string,
  kind: ReviewRunKind,
  runId: number,
): Promise<string | null> {
  try {
    switch (kind) {
      case 'mission': {
        const [run] = await db
          .select({ team: missionRunSchema.team })
          .from(missionRunSchema)
          .where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId)))
          .limit(1);
        return run?.team?.lead ?? null;
      }
      case 'action': {
        const [run] = await db
          .select({ invokedBy: actionRunSchema.invokedBy })
          .from(actionRunSchema)
          .where(and(eq(actionRunSchema.id, runId), eq(actionRunSchema.orgId, orgId)))
          .limit(1);
        return agentSlugFromPrincipal(run?.invokedBy);
      }
      case 'workflow':
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Parse an `'agent:<slug>'` principal (action proposals, learning
 * sources); anything else — user ids, 'web', tokens — is null.
 * @param principal
 */
export function agentSlugFromPrincipal(principal: string | null | undefined): string | null {
  const m = principal?.match(/^agent:([\w-]+)$/);
  return m?.[1] ?? null;
}

/**
 * Record one HITL decision on the adoption stream, with agent
 * attribution resolved off the caller's critical path. Fire-and-forget:
 * returns a promise that never rejects (await it only in tests).
 * @param actor
 * @param item
 * @param item.kind
 * @param item.id
 * @param decision
 * @param opts
 * @param opts.latencyMs
 */
export function trackReviewDecision(
  actor: AdoptionActor,
  item: { kind: ReviewRunKind; id: number },
  decision: 'approved' | 'rejected',
  opts: { latencyMs?: number } = {},
): Promise<void> {
  return (async () => {
    const agentSlug = await resolveRunAgentSlug(actor.orgId, item.kind, item.id);
    await track(actor, 'review.decided', {
      agentSlug,
      resource: [`${item.kind}_run`, item.id],
      meta: {
        kind: item.kind,
        decision,
        ...(opts.latencyMs != null ? { latencyMs: opts.latencyMs } : {}),
      },
    });
  })().catch(() => {});
}

/**
 * Record one run-feedback submission on the adoption stream, agent-
 * attributed the same way as decisions.
 * @param actor
 * @param item
 * @param item.kind
 * @param item.id
 * @param feedback
 * @param feedback.rating
 * @param feedback.hasNote
 */
export function trackReviewFeedback(
  actor: AdoptionActor,
  item: { kind: ReviewRunKind; id: number },
  feedback: { rating: 'up' | 'down' | null; hasNote: boolean },
): Promise<void> {
  return (async () => {
    const agentSlug = await resolveRunAgentSlug(actor.orgId, item.kind, item.id);
    await track(actor, 'review.feedback', {
      agentSlug,
      resource: [`${item.kind}_run`, item.id],
      meta: { kind: item.kind, rating: feedback.rating, hasNote: feedback.hasNote },
    });
  })().catch(() => {});
}
