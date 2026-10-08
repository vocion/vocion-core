import { os } from '@orpc/server';
import { z } from 'zod';
import { setAccountCap } from '@/services/BudgetService';
import { accountExists, createAccount, inviteToAccount, isOperatorUser, OperatorInputError, operatorOverview } from '@/services/OperatorConsoleService';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * The operator console's routes (`/dashboard/operator`). Every one of them
 * reads or writes across accounts, so every one goes through
 * {@link guardOperator} first and nothing else.
 */

/**
 * The signed-in person, when they operate this deployment
 * (`VOCION_OPERATOR_EMAILS`, checked against the user row's email).
 *
 * Anyone else gets a 404, not a 403: the console is not a page that exists
 * for them, which is how a workspace a person cannot reach answers too
 * (`services/WorkspaceAccessService.ts`).
 * @returns The operator's user id, for `invitedBy`.
 */
export async function guardOperator(): Promise<{ userId: string }> {
  const { userId } = await guardAuth();
  if (!(await isOperatorUser(userId))) {
    throw ApiError.notFound();
  }
  return { userId };
}

/**
 * A refusal written for the operator becomes a 400 with its words; anything
 * else carries what the database said and stays a 500.
 * @param error - What was thrown.
 */
function asApiError(error: unknown): never {
  if (error instanceof OperatorInputError) {
    throw ApiError.badRequest(error.message);
  }
  throw error;
}

export const overviewRoute = os.handler(async () => {
  await guardOperator();
  return operatorOverview();
});

export const createAccountRoute = os
  .input(z.object({
    name: z.string().trim().min(1).max(120),
    workspaceName: z.string().trim().max(120).optional(),
    adminEmail: z.string().trim().email(),
  }))
  .handler(async ({ input }) => {
    const { userId } = await guardOperator();
    try {
      return await createAccount({ ...input, invitedBy: userId });
    } catch (error) {
      return asApiError(error);
    }
  });

export const inviteRoute = os
  .input(z.object({
    accountId: z.string().min(1),
    email: z.string().trim().email(),
    role: z.enum(['admin', 'member']),
  }))
  .handler(async ({ input }) => {
    const { userId } = await guardOperator();
    try {
      return await inviteToAccount({ ...input, invitedBy: userId });
    } catch (error) {
      return asApiError(error);
    }
  });

/**
 * Set, raise, lower or clear an account's monthly cap, in whole cents. The
 * only route to the account scope — the workspace budgets API refuses it.
 */
export const setAccountCapRoute = os
  .input(z.object({
    accountId: z.string().min(1),
    hardCentsLimit: z.number().int().nonnegative().nullable(),
  }))
  .handler(async ({ input }) => {
    await guardOperator();
    if (!(await accountExists(input.accountId))) {
      throw ApiError.badRequest('That account does not exist.');
    }
    return setAccountCap({ accountId: input.accountId, hardCentsLimit: input.hardCentsLimit });
  });
