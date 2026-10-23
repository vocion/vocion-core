/**
 * THE SPEND LEDGER — one `model_call` row per paid model call.
 *
 * Written by `chargeUsage` (`services/BudgetService.ts`), the function every
 * charge already lands in, so there is one write path: a call that charges a
 * budget is a call in the ledger, and nothing else writes here. The row takes
 * what the charge knows (workspace, agent, feature, model, tokens, cost) and
 * what the call context knows (person, conversation, run, effort, trace;
 * `callContext.ts`), plus the run-cost scope's conversation or mission run.
 *
 * Best effort, like the run's cost: the call already happened and was paid for.
 * A lost row is logged with its cause and never fails the call.
 */

import type { RunCostTarget } from '@/services/budget/runCost';
import type { CallContext } from '@/services/spend/callContext';

/** What `chargeUsage` knows about one call. */
export type LedgerCharge = {
  orgId: string;
  agentSlug?: string | null;
  feature?: string | null;
  model: string;
  provider?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  microCents: number;
  latencyMs?: number | null;
  traceId?: string | null;
};

export type ModelCallRow = {
  orgId: string;
  accountId: string | null;
  agentSlug: string | null;
  feature: string;
  userId: string | null;
  conversationId: number | null;
  messageId: number | null;
  runKind: string | null;
  runId: string | null;
  provider: string | null;
  model: string;
  effortLevel: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  microCents: number;
  latencyMs: number | null;
  traceId: string | null;
};

/** The feature a call with only an agent to its name is filed under. */
export const AGENT_TURN_FEATURE = 'agent.turn';

/**
 * The row for one call. Pure.
 * @param charge - What the charge says.
 * @param context - The open call context.
 * @param run - The open run-cost scope's target, if any.
 * @param accountId - The workspace's Org, when known.
 */
export function ledgerRowOf(charge: LedgerCharge, context: CallContext, run: RunCostTarget | undefined, accountId: string | null): ModelCallRow {
  const missionRunId = run && 'missionRunId' in run ? run.missionRunId : undefined;
  const runConversation = run && 'conversationId' in run ? run.conversationId : undefined;
  const runKind = context.runKind ?? (missionRunId !== undefined ? 'mission_run' : null);
  const runId = context.runId ?? missionRunId;
  const agentSlug = charge.agentSlug ?? context.agentSlug ?? null;
  return {
    orgId: charge.orgId,
    accountId,
    agentSlug,
    feature: charge.feature ?? (agentSlug ? AGENT_TURN_FEATURE : 'unattributed'),
    userId: context.userId ?? null,
    conversationId: context.conversationId ?? runConversation ?? null,
    messageId: context.messageId ?? null,
    runKind,
    runId: runKind && runId !== undefined && runId !== null ? String(runId) : null,
    provider: charge.provider ?? null,
    model: charge.model,
    effortLevel: context.effortLevel ?? null,
    inputTokens: charge.inputTokens,
    outputTokens: charge.outputTokens,
    cacheReadTokens: charge.cacheReadTokens,
    cacheWriteTokens: charge.cacheWriteTokens,
    microCents: charge.microCents,
    latencyMs: charge.latencyMs ?? null,
    traceId: charge.traceId ?? context.traceId ?? null,
  };
}

/** Workspace → Org, read once per process: a workspace never changes Org. */
const accounts = new Map<string, string | null>();

async function accountOf(orgId: string): Promise<string | null> {
  if (accounts.has(orgId)) {
    return accounts.get(orgId)!;
  }
  const [{ db }, { projectSchema }, { eq }] = await Promise.all([
    import('@/libs/DB'),
    import('@/models/Schema'),
    import('drizzle-orm'),
  ]);
  const [row] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  const accountId = row?.accountId ?? null;
  if (accountId) {
    accounts.set(orgId, accountId);
  }
  return accountId;
}

/**
 * File one call in the ledger. Never throws.
 * @param charge - What was charged.
 */
export async function recordModelCall(charge: LedgerCharge): Promise<void> {
  try {
    const [{ currentCallContext }, { currentRunCost }] = await Promise.all([
      import('@/services/spend/callContext'),
      import('@/services/budget/runCost'),
    ]);
    const context = currentCallContext();
    const run = currentRunCost()?.target;
    const accountId = await accountOf(charge.orgId).catch(() => null);
    const row = ledgerRowOf(charge, context, run, accountId);
    const [{ db }, { modelCallSchema }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema')]);
    await db.insert(modelCallSchema).values(row);
  } catch (error) {
    import('@/libs/Logger')
      .then(({ logger }) => logger.error('a model call was not filed in the spend ledger', {
        orgId: charge.orgId,
        agentSlug: charge.agentSlug,
        feature: charge.feature,
        model: charge.model,
        microCents: charge.microCents,
        error: error instanceof Error ? error.message : String(error),
        cause: error instanceof Error && error.cause ? String(error.cause) : undefined,
      }))
      .catch(loggerError => console.error('a model call was not filed in the spend ledger, and the logger was unavailable', { orgId: charge.orgId, loggerError }));
  }
}
