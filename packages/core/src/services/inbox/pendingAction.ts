import type { ActionRun } from '@/features/review/ReviewFocusView';
import { and, eq, inArray } from 'drizzle-orm';
import { policyKeyForRun } from '@/libs/actions/policyKey';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { actionRunSchema, reviewAssignmentSchema, userSchema } from '@/models/Schema';
import { scoreFor } from '@/services/alignment/AlignmentService';

/**
 * One proposal, loaded for its decision screen: the run row, the action's own
 * card (when it defines a `reviewCard` presenter) and the alignment score
 * beside the confidence meter — the same enrichment the `listPendingActions`
 * route applies to a page of the queue, for a single id. Server-side; the
 * inbox detail route renders the first paint from it and `router.refresh()`
 * re-runs it after a regenerate.
 *
 * `canRegenerate` is stamped here from the action's declared capability, never
 * by the presenter, so no card can claim what its action does not implement.
 * @param orgId
 * @param id
 * @returns The run, or null when the org does not own it.
 */
export async function loadPendingAction(orgId: string, id: number): Promise<ActionRun | null> {
  const [found] = await db
    .select({ run: actionRunSchema, assignedTo: reviewAssignmentSchema.assignedTo })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, and(
      eq(reviewAssignmentSchema.orgId, orgId),
      eq(reviewAssignmentSchema.kind, 'action'),
      eq(reviewAssignmentSchema.runId, actionRunSchema.id),
    ))
    .where(and(eq(actionRunSchema.id, id), eq(actionRunSchema.orgId, orgId)))
    .limit(1);
  if (!found) {
    return null;
  }
  const row = found.run;
  const agentSlug = row.invokedBy?.startsWith('agent:') ? row.invokedBy.slice('agent:'.length) : row.proposal?.agentSlug ?? null;
  // The ledger's key for this run — the action id, or the derived one when
  // the kind earns per class (`libs/actions/policyKey.ts`).
  const subjectKey = policyKeyForRun(row.actionId, row.input);
  const [alignment, card] = await Promise.all([
    scoreFor({ orgId, subjectKey, agentSlug }).catch(() => null),
    (async () => {
      const action = getAction(row.actionId);
      const presenter = action?.reviewCard;
      if (!presenter) {
        return undefined;
      }
      const built = await presenter({ orgId }, row.input).catch(() => undefined);
      return built ? { ...built, canRegenerate: action?.regenerate !== undefined } : undefined;
    })(),
  ]);
  // The agent-wide score stands in when this agent has no history of its own.
  const score = alignment && alignment.n === 0 ? await scoreFor({ orgId, subjectKey }).catch(() => alignment) : alignment;
  // The people the run names — who decided it, who it was routed to, and for
  // a hand-off who approved it and who marked it done — resolved to names in
  // one query, so the lifecycle under Run details reads "by Rowan Pike"
  // rather than a user id.
  const trail = (row.result ?? {}) as { handoff?: { releasedBy?: unknown }; executed?: { by?: unknown } };
  const people = await namesFor([row.decidedBy, found.assignedTo, trail.handoff?.releasedBy, trail.executed?.by]);
  return {
    id: row.id,
    actionId: row.actionId,
    status: row.status,
    input: row.input,
    invokedBy: row.invokedBy,
    createdAt: row.createdAt,
    proposal: (row.proposal as ActionRun['proposal']) ?? null,
    regeneratingSince: row.regeneratingSince ?? null,
    regenerateNote: row.regenerateNote ?? null,
    // The two columns the per-send walk reads: which sends carry a check, and
    // the history under each one. Both ride the run, so the surface needs no
    // new props and every surface that mounts it gets the walk.
    contentReview: row.contentReview ?? null,
    revisions: row.revisions ?? null,
    error: row.error ?? null,
    ...(card ? { card } : {}),
    typeLabel: getAction(row.actionId)?.name ?? undefined,
    alignment: score ? { agreementRate: score.agreementRate, n: score.n, window: score.window } : null,
    result: row.result ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ?? null,
    executedAt: row.executedAt ?? null,
    assignee: found.assignedTo ? people[found.assignedTo] ?? found.assignedTo : null,
    people,
  };
}

/**
 * Display names for a handful of user ids: the name, else the email, else
 * nothing — an id with no row (a token, the trust ladder) is left out so
 * the caller renders it as itself.
 * @param ids - Whatever the run recorded; non-strings and blanks are skipped.
 */
async function namesFor(ids: unknown[]): Promise<Record<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v !== ''))];
  if (wanted.length === 0) {
    return {};
  }
  const rows = await db
    .select({ id: userSchema.id, name: userSchema.name, email: userSchema.email })
    .from(userSchema)
    .where(inArray(userSchema.id, wanted))
    .catch(() => []);
  return Object.fromEntries(rows.map(r => [r.id, r.name || r.email]));
}
