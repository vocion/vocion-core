/**
 * OVERTAKEN BY EVENTS — does a waiting recommendation still make sense?
 *
 * A recommendation is decided hours or days after it was proposed. In that
 * time the other side may have written again, the contact may have joined a
 * sequence, someone may have changed the field an update would overwrite.
 * Each action owns what that means for it (`Action.basisFor` records what the
 * recommendation assumed; `Action.stillHolds` says what changed since); this
 * module is the one place core asks, and it never names an action.
 *
 * Asked at three moments, through `checkStillHolds`:
 *
 *   approve  — `ActionService.executeAction` (and the review decide path just
 *              before it). A person is told what changed and may proceed
 *              anyway; an agent's approval does not run, and the run goes
 *              back to Review with the line.
 *   read     — the review item read path, cached a few minutes on the run so
 *              opening an item does not hammer the outside system.
 *   sweep    — `ReviewTruthService.sweepReviewQueue`, a bounded number per
 *              pass, oldest check first.
 *
 * Every read fails open: a hook that throws, or does not answer in time, is
 * logged and read as "still holds". One dead API never freezes the queue.
 *
 * What is stored, on the run's proposal jsonb (no migration):
 *   basis / basisAt   — what the recommendation assumed, and when it was read
 *   stale             — the last finding, with `checkedAt`, while it is stale
 *   staleCheckedAt    — when it was last checked, stale or not
 */

import type { Action, ActionContext, StaleFinding } from '@/libs/actions/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getAction } from '@/libs/actions/registry';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/** What a surface reads about a stale item. */
export type StaleView = StaleFinding & {
  /** When the check ran. */
  checkedAt: string;
  /** The action can redraft the item itself (`Action.regenerate`), so a Redraft button has somewhere to go. */
  canRedraft: boolean;
};

/** How long one check answers for, on the read path. */
export const STALE_CACHE_MS = 3 * 60_000;

/** A basis read this recently is the world a check would read again: approving at once does not ask twice. */
export const FRESH_BASIS_MS = 60_000;

/** How long a hook may take before it is read as "still holds". */
const HOOK_TIMEOUT_MS = 8_000;

/** The proposal keys this module owns. */
type StaleKeys = { basis?: unknown; basisAt?: unknown; stale?: unknown; staleCheckedAt?: unknown };

/**
 * The hook's promise, or a rejection when it takes too long.
 * @param work - The hook's answer.
 * @param what - What it is, for the error.
 */
async function inTime<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${HOOK_TIMEOUT_MS / 1000}s`)), HOOK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The vault credentials the action's source holds, or undefined.
 * @param orgId - Tenant.
 * @param action - The action.
 * @param input - Its input.
 */
async function credentialsFor(orgId: string, action: Action, input: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const { sourceSlugOf } = await import('@/services/ActionService');
  const slug = sourceSlugOf(action, input);
  if (!slug) {
    return undefined;
  }
  const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
  return (await getCredentialsForSource(orgId, slug)) ?? undefined;
}

/**
 * What the recommendation assumes, read now, for the proposal envelope. Null
 * when the action declares no `basisFor`, returns nothing, or cannot read it:
 * a failing read never blocks a proposal.
 * @param action - The action being proposed.
 * @param ctx - Who is proposing, in which workspace.
 * @param input - Its parsed input.
 */
export async function captureBasis(action: Action, ctx: ActionContext, input: Record<string, unknown>): Promise<{ basis: Record<string, unknown>; basisAt: string } | null> {
  if (!action.basisFor) {
    return null;
  }
  try {
    const credentials = ctx.credentials ?? await credentialsFor(ctx.orgId, action, input);
    const basis = await inTime(action.basisFor({ ...ctx, credentials }, input), `${action.id} basisFor`);
    return basis ? { basis, basisAt: new Date().toISOString() } : null;
  } catch (err) {
    console.warn(`[staleness] ${action.id}: could not read what the recommendation assumes; stored without a basis`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The finding stored on a run's proposal, when it is stale.
 * @param proposal - The run's proposal.
 */
export function storedStale(proposal: unknown): StaleView | null {
  const s = (proposal as StaleKeys | null)?.stale as Partial<StaleView> | undefined;
  return s && typeof s.line === 'string' && s.line.trim() ? s as StaleView : null;
}

/**
 * Was the basis read so recently that checking again would read the same world?
 * @param proposal - The run's proposal.
 * @param now - The clock.
 */
export function basisIsFresh(proposal: unknown, now: Date = new Date()): boolean {
  const at = (proposal as StaleKeys | null)?.basisAt;
  const t = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) && now.getTime() - t < FRESH_BASIS_MS;
}

export type RunForStaleness = {
  id: number;
  orgId: string;
  actionId: string;
  input: Record<string, unknown> | null;
  proposal: unknown;
  createdAt: Date;
  invokedBy?: string | null;
};

/**
 * Write what a check found onto the run's proposal: the finding while it is
 * stale (gone once it holds again), and when it was checked. Merged into the
 * jsonb, so nothing else on the envelope is touched, and only on an open run.
 * @param run - The run.
 * @param run.id - Its id.
 * @param run.orgId - Its tenant.
 * @param view - The finding, or null when it still holds.
 * @param checkedAt - When.
 */
export async function recordCheck(run: { id: number; orgId: string }, view: StaleView | null, checkedAt: string): Promise<void> {
  const patch = JSON.stringify({ staleCheckedAt: checkedAt, ...(view ? { stale: view } : {}) });
  await db
    .update(actionRunSchema)
    .set({ proposal: sql`(coalesce(${actionRunSchema.proposal}, '{}'::jsonb) - 'stale') || ${patch}::jsonb` })
    .where(and(eq(actionRunSchema.id, run.id), eq(actionRunSchema.orgId, run.orgId), inArray(actionRunSchema.status, ['pending', 'failed', 'approved'])));
}

/**
 * Does this waiting run still make sense? Null when it does, when its action
 * declares no `stillHolds`, or when the check could not be made (fail open);
 * else what changed. The result is written onto the run either way, so the
 * queue, the item and the sweep all read the same answer.
 * @param run - The run, as stored.
 * @param opts - The read path's cache.
 * @param opts.maxAgeMs - Answer from the last check when it is this recent.
 * @param opts.now - The clock.
 */
export async function checkStillHolds(run: RunForStaleness, opts: { maxAgeMs?: number; now?: Date } = {}): Promise<StaleView | null> {
  const action = getAction(run.actionId);
  if (!action?.stillHolds) {
    return null;
  }
  const now = opts.now ?? new Date();
  const proposal = (run.proposal ?? {}) as StaleKeys;
  if (opts.maxAgeMs !== undefined) {
    const last = typeof proposal.staleCheckedAt === 'string' ? Date.parse(proposal.staleCheckedAt) : Number.NaN;
    if (Number.isFinite(last) && now.getTime() - last < opts.maxAgeMs) {
      return storedStale(proposal);
    }
  }
  const input = run.input ?? {};
  const basis = proposal.basis && typeof proposal.basis === 'object' ? proposal.basis as Record<string, unknown> : null;
  const basisAt = typeof proposal.basisAt === 'string' && Number.isFinite(Date.parse(proposal.basisAt)) ? new Date(proposal.basisAt) : run.createdAt;
  let finding: StaleFinding | null;
  try {
    const credentials = await credentialsFor(run.orgId, action, input);
    finding = await inTime(action.stillHolds({ orgId: run.orgId, credentials, invokedBy: run.invokedBy ?? undefined, runId: run.id, proposedAt: basisAt }, input, basis), `${action.id} stillHolds`);
  } catch (err) {
    console.warn(`[staleness] ${action.id} run ${run.id}: could not check whether it still holds; treated as holding`, err instanceof Error ? err.message : err);
    return null;
  }
  const checkedAt = now.toISOString();
  const view = finding?.line?.trim() ? viewOf(action, finding, checkedAt) : null;
  await recordCheck(run, view, checkedAt).catch((err) => {
    console.warn(`[staleness] run ${run.id}: could not record the check`, err instanceof Error ? err.message : err);
  });
  return view;
}

/**
 * A finding as surfaces read it.
 * @param action - The run's action.
 * @param finding - What its check said.
 * @param checkedAt - When.
 */
export function viewOf(action: Action | undefined, finding: StaleFinding, checkedAt: string): StaleView {
  return {
    line: finding.line.trim(),
    ...(finding.href ? { href: finding.href } : {}),
    ...(finding.changed && finding.changed.length > 0 ? { changed: finding.changed } : {}),
    ...(finding.keepOpen ? { keepOpen: true } : {}),
    ...(finding.code ? { code: finding.code } : {}),
    checkedAt,
    canRedraft: action?.regenerate !== undefined,
  };
}

/**
 * The read path: the item's stale finding, from a check at most
 * `STALE_CACHE_MS` old. Only an open run is checked; anything else answers
 * null. Never throws.
 * @param run - The run, as stored, with its status.
 */
export async function staleForRead(run: RunForStaleness & { status: string }): Promise<StaleView | null> {
  if (run.status !== 'pending' && run.status !== 'failed') {
    return null;
  }
  return checkStillHolds(run, { maxAgeMs: STALE_CACHE_MS }).catch(() => null);
}
