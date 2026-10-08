/**
 * Dashboard routes for an account's engineering runners (Vocion 5.1): the runner tokens that let a
 * runner claim this account's runs, and which of the installation's targets builds each workspace.
 * Shown in Workforce › Settings › Developers, in its Software Factory section.
 *
 * Two rules, the same two `ApiTokens.ts` keeps:
 *
 * 1. **Account admins only.** A runner token claims every run of the account it names, across its
 *    workspaces, and a target decides where a company's repository code runs. Both are account
 *    decisions, so the account role is checked, not a workspace's.
 * 2. **Session only, never a token.** These run behind the dashboard session, so no credential can
 *    mint a runner token for itself.
 */

import type { EffectiveRunnerTarget } from '@/services/runners/workspaceTarget';
import { os } from '@orpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { isMultiTenant } from '@/libs/multiTenant';
import { runnersConfig } from '@/libs/runners/config';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';
import { listRunnerTokens, mintRunnerToken, revokeRunnerToken, RunnerTokenError } from '@/services/runners/runnerTokens';
import { RunnerTargetError, setAccountRunnerTarget, setWorkspaceRunnerTarget } from '@/services/runners/workspaceTarget';
import { ORG_ROLE } from '@/types/Auth';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/** Longest expiry a runner token may be minted with: ten years, "effectively never". */
const MAX_EXPIRY_YEARS = 10;

async function guardAccountAdmin() {
  const ctx = await guardAuth();
  if (!ctx.has({ role: ORG_ROLE.ADMIN }) || !ctx.accountId) {
    throw ApiError.forbidden();
  }
  return { accountId: ctx.accountId, projectId: ctx.projectId, userId: ctx.userId };
}

/**
 * Turn a typed refusal into a 400 carrying its sentence, which was written for a person; anything
 * else is logged and answered generically, because it may carry what the database said.
 * @param error - What the service threw.
 * @param doing - What was being done, as the generic answer says it ("save the target").
 */
function refusal(error: unknown, doing: string): never {
  if (error instanceof RunnerTokenError || error instanceof RunnerTargetError) {
    throw ApiError.badRequest(error.message);
  }
  console.error(`[runners] could not ${doing}`, error);
  throw ApiError.badRequest(`Could not ${doing}.`);
}

function readExpiry(raw: string | null): Date | null {
  if (raw === null) {
    return null;
  }
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw ApiError.badRequest('Expiry is not a valid date.');
  }
  const latest = new Date();
  latest.setFullYear(latest.getFullYear() + MAX_EXPIRY_YEARS);
  if (at.getTime() > latest.getTime()) {
    throw ApiError.badRequest(`Expiry cannot be more than ${MAX_EXPIRY_YEARS} years out. Choose "never" instead.`);
  }
  return at;
}

/** Everything the Software Factory section shows: targets, workspaces, tokens. */
export const overviewRoute = os
  .input(z.object({ includeRevoked: z.boolean().optional() }).optional())
  .handler(async ({ input }) => {
    const { accountId, projectId } = await guardAccountAdmin();
    const [[account], workspaces, tokens] = await Promise.all([
      db.select({ id: tenantAccountSchema.id, name: tenantAccountSchema.name, target: tenantAccountSchema.runnerTarget }).from(tenantAccountSchema).where(eq(tenantAccountSchema.id, accountId)).limit(1),
      db.select({ id: projectSchema.id, name: projectSchema.name, target: projectSchema.runnerTarget }).from(projectSchema).where(eq(projectSchema.accountId, accountId)).orderBy(asc(projectSchema.name)),
      listRunnerTokens(accountId, { includeRevoked: input?.includeRevoked ?? false }),
    ]);
    // The same precedence as `runnerTargetFor`, read off the rows already here.
    const own = workspaces.find(w => w.id === projectId)?.target ?? null;
    const current: EffectiveRunnerTarget = own ? { target: own, from: 'workspace' } : account?.target ? { target: account.target, from: 'account' } : { target: null, from: null };
    return {
      multiTenant: isMultiTenant(),
      targets: runnersConfig().targets.map(t => ({ name: t.name, kind: t.kind })),
      account: { id: accountId, name: account?.name ?? '', target: account?.target ?? null },
      currentWorkspaceId: projectId,
      current,
      workspaces,
      tokens,
    };
  });

/** Mint a runner token for the account. The plaintext is in this reply and nowhere else, ever. */
export const createTokenRoute = os
  .input(z.object({
    name: z.string().trim().min(1, 'Give the token a name.').max(80),
    /** Narrow it to these workspaces of the account; null or empty for every workspace. */
    projectIds: z.array(z.string().min(1)).max(200).nullable(),
    /** ISO datetime, or null for a token that never expires. */
    expiresAt: z.string().nullable(),
  }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAccountAdmin();
    const expiresAt = readExpiry(input.expiresAt);
    try {
      const { id, token } = await mintRunnerToken({ accountId, name: input.name, projectIds: input.projectIds, createdBy: userId, expiresAt });
      console.warn('[runners.createToken] runner token minted', { accountId, userId, tokenId: id, workspaces: input.projectIds?.length ?? 'all' });
      return { id, token, name: input.name };
    } catch (error) {
      refusal(error, 'create the runner token');
    }
  });

/** Revoke one of the account's runner tokens. */
export const revokeTokenRoute = os
  .input(z.object({ id: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAccountAdmin();
    // Scoped by account inside the service: another account's id is simply not found.
    const revoked = await revokeRunnerToken(accountId, input.id);
    if (!revoked) {
      throw ApiError.notFound();
    }
    console.warn('[runners.revokeToken] runner token revoked', { accountId, userId, tokenId: input.id });
    return { ok: true };
  });

/** Name the target that builds one of the account's workspaces, or null to follow the account. */
export const setWorkspaceTargetRoute = os
  .input(z.object({ projectId: z.string().min(1), target: z.string().min(1).max(32).nullable() }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAccountAdmin();
    const [project] = await db.select({ id: projectSchema.id }).from(projectSchema).where(and(eq(projectSchema.id, input.projectId), eq(projectSchema.accountId, accountId))).limit(1);
    if (!project) {
      throw ApiError.notFound();
    }
    try {
      await setWorkspaceRunnerTarget(project.id, input.target);
    } catch (error) {
      refusal(error, 'save the workspace\'s target');
    }
    console.warn('[runners.setWorkspaceTarget] runner target set', { accountId, userId, projectId: project.id, target: input.target });
    return { ok: true };
  });

/** Name the target that builds every workspace of the account that names none, or null for any. */
export const setAccountTargetRoute = os
  .input(z.object({ target: z.string().min(1).max(32).nullable() }))
  .handler(async ({ input }) => {
    const { accountId, userId } = await guardAccountAdmin();
    try {
      await setAccountRunnerTarget(accountId, input.target);
    } catch (error) {
      refusal(error, 'save the account\'s target');
    }
    console.warn('[runners.setAccountTarget] runner target set', { accountId, userId, target: input.target });
    return { ok: true };
  });
