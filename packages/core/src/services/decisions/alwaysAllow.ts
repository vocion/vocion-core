/**
 * "ALWAYS ALLOW" — AN APPROVAL THAT MOVES THE TRUST LADDER.
 *
 * The docked approval asks the way a permission prompt does: Allow once,
 * Always allow <this kind> in <workspace>, Deny. The middle option is the
 * trust ladder's own promotion (`autonomy/AutonomyService.promote`), offered
 * in the moment the person is already saying yes — and ONLY where the ladder
 * would take it: the person is an admin (moving a kind changes what runs
 * without a person), the next rung is earned on the alignment evidence, and
 * that rung automates. Anywhere else the option is simply not there; the
 * refusal is the product, as on the autonomy page.
 *
 * Choosing it promotes the kind, then runs this one as Allow once. Scoped to
 * the workspace.
 */

import type { DecisionOption, DecisionView } from '@/libs/decisions/decision';
import { ALLOW_ONCE_ID, ALWAYS_ALLOW_ID } from '@/libs/decisions/decision';

/**
 * The workspace's name, as the option says it.
 * @param orgId - The workspace.
 */
async function workspaceName(orgId: string): Promise<string> {
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { projectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ name: projectSchema.name }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.name?.trim() || 'this workspace';
}

/**
 * Whether this person may move this kind up the ladder now, and to where.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param actionId - The action kind.
 */
async function promotion(orgId: string, userId: string | null, actionId: string | null): Promise<{ to: string } | null> {
  if (!userId || !actionId) {
    return null;
  }
  try {
    const { memberWorkspace } = await import('@/services/WorkspaceAccessService');
    if ((await memberWorkspace(userId, orgId))?.accountRole !== 'admin') {
      return null;
    }
    const { eligibility } = await import('@/services/autonomy/AutonomyService');
    const { RUNG_LABEL, rungAutomates } = await import('@/services/autonomy/rungs');
    const e = await eligibility(orgId, actionId);
    return e.earned && e.nextRung && rungAutomates(e.nextRung) ? { to: RUNG_LABEL[e.nextRung] } : null;
  } catch {
    return null;
  }
}

/**
 * The "Always allow" option for this person on this kind, or null where the
 * ladder would not take it.
 * @param orgId - The workspace.
 * @param userId - The person who would choose it.
 * @param actionId - The action kind the approval runs.
 */
export async function alwaysAllowOption(orgId: string, userId: string | null, actionId: string | null): Promise<DecisionOption | null> {
  const can = await promotion(orgId, userId, actionId);
  if (!can) {
    return null;
  }
  const { actionLabel } = await import('@/libs/actions/undoable');
  const kind = actionLabel(actionId!);
  const plain = /^[A-Z][a-z]+(?=[\s,.:;]|$)/.test(kind) ? `${kind[0]!.toLowerCase()}${kind.slice(1)}` : kind;
  return {
    id: ALWAYS_ALLOW_ID,
    label: `Always allow "${plain}" in ${await workspaceName(orgId)}`,
    consequence: `Runs it now, and moves this kind to ${can.to}: next time it runs without asking.`,
  };
}

/**
 * An open approval with "Always allow" placed after "Allow once", where the
 * ladder would take it; any other Decision as it is.
 * @param orgId - The workspace.
 * @param userId - The person it is drawn for.
 * @param view - The Decision.
 * @param actionId - The action kind its Allow once runs, when it runs one.
 */
export async function withAlwaysAllow(orgId: string, userId: string | null, view: DecisionView, actionId: string | null): Promise<DecisionView> {
  const at = view.options.findIndex(o => o.id === ALLOW_ONCE_ID);
  if (view.kind !== 'approval' || view.state !== 'open' || at === -1 || view.options.some(o => o.id === ALWAYS_ALLOW_ID)) {
    return view;
  }
  const always = await alwaysAllowOption(orgId, userId, actionId);
  return always ? { ...view, options: [...view.options.slice(0, at + 1), always, ...view.options.slice(at + 1)] } : view;
}

/**
 * Take "Always allow": promote the kind, as the person. Refused — with why —
 * when the ladder would not take it (the option was never theirs to see).
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param actionId - The action kind.
 */
export async function takeAlwaysAllow(orgId: string, userId: string, actionId: string | null): Promise<void> {
  const { DecisionError } = await import('./DecisionService');
  if (!(await promotion(orgId, userId, actionId))) {
    throw new DecisionError('VALIDATION_FAILED', 'Always allow is not open here: the trust ladder would not move this kind for you now. Allow once or Deny.');
  }
  const { promote } = await import('@/services/autonomy/AutonomyService');
  await promote(orgId, actionId!, userId);
}
