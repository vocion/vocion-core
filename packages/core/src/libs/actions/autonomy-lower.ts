import type { Action, ActionContext } from './types';
import type { DbTransaction } from '@/libs/DbTransaction';
import type { Rung } from '@/services/autonomy/rungs';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { rungIndex, RUNGS } from '@/services/autonomy/rungs';
import { adminCheck } from '@/services/connect/createSourceOnLogin';

/** What a person who is not an admin is told, here and at the Autonomy page's own demote. */
const NOT_ADMIN = {
  refusal: 'Only a workspace admin can lower what the factory does on its own',
  lookupFailure: 'Could not check who approved this, so nothing was lowered. Try again.',
};

const autonomyLowerInput = z.object({
  actionIds: z.array(z.string().min(1)).min(1).max(10),
  /** The rung each action may stand on at most. A target, not a step, so a retry never lowers twice. */
  to: z.enum(RUNGS),
});

/**
 * The autonomy service, loaded when a lowering runs rather than when the
 * registry builds: the service reads the registry to know each action, so a
 * static import here would make the two wait on each other at startup.
 */
function loadAutonomyService() {
  return import('@/services/autonomy/AutonomyService');
}

type AutonomyService = Awaited<ReturnType<typeof loadAutonomyService>>;
type Lowered = { actionId: string; from: Rung; to: Rung };

/**
 * Bring one action down to the target rung, a step at a time, on the caller's
 * transaction. A rung already at or below the target is left exactly where it
 * is. The loop stops at the target, so it never asks `demote` for a step below
 * Observe and the bottom-of-the-ladder refusal never reaches the person.
 * @param service - The autonomy service.
 * @param tx - The transaction every action's steps are written on.
 * @param ctx - The workspace and who is lowering.
 * @param ctx.orgId
 * @param ctx.by
 * @param actionId - The action to lower.
 * @param target - The highest rung it may stand on afterwards.
 * @returns Where it started and where it stands now.
 */
async function lowerOne(service: AutonomyService, tx: DbTransaction, ctx: { orgId: string; by: string }, actionId: string, target: Rung): Promise<Lowered> {
  const start = (await service.effectivePolicy(ctx.orgId, actionId, tx)).rung;
  let current = start;
  while (rungIndex(current) > rungIndex(target)) {
    current = (await service.demote(ctx.orgId, actionId, ctx.by, 'chosen during setup', tx)).to;
  }
  return { actionId, from: start, to: current };
}

/**
 * Every listed action, lowered one after another on the caller's transaction.
 * Sequential on purpose: one transaction is one connection.
 * @param tx - The transaction every step is written on.
 * @param service - The autonomy service.
 * @param ctx - The workspace and who is lowering.
 * @param ctx.orgId
 * @param ctx.by
 * @param input - The actions and the target rung.
 */
async function lowerInTransaction(tx: DbTransaction, service: AutonomyService, ctx: { orgId: string; by: string }, input: z.infer<typeof autonomyLowerInput>): Promise<Lowered[]> {
  const done: Lowered[] = [];
  for (const actionId of input.actionIds) {
    done.push(await lowerOne(service, tx, ctx, actionId, input.to));
  }
  return done;
}

/**
 * Lower every listed action in one transaction, so the set lands together or
 * not at all. The adoption events are recorded after it commits.
 * @param ctx - The workspace and who is lowering.
 * @param ctx.orgId
 * @param ctx.by
 * @param input - The actions and the target rung.
 */
async function lowerAll(ctx: { orgId: string; by: string }, input: z.infer<typeof autonomyLowerInput>): Promise<Lowered[]> {
  const service = await loadAutonomyService();
  const lowered = await db.transaction(tx => lowerInTransaction(tx, service, ctx, input));
  for (const move of lowered.filter(item => item.from !== item.to)) {
    await service.trackMove(ctx.orgId, ctx.by, 'autonomy.demoted', { ...move, automatic: false });
  }
  return lowered;
}

/**
 * Take trust down to a rung while setting up (#1028). The setup conversation
 * may ask "should I ask even before merging pipeline fixes?" and lower the
 * answer here; it never raises one. A rung is earned from the Autonomy page
 * with evidence, so this module does not reach the code that does that.
 */
export const autonomyLowerAction: Action<typeof autonomyLowerInput> = {
  id: 'autonomy.lower',
  name: 'Lower trust',
  description: 'Lower what the factory may do on its own to a chosen rung, for each listed action. An action already at or below that rung is left alone, so running it twice changes nothing. It never raises trust; that is earned from the Autonomy page.',
  inputSchema: autonomyLowerInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `autonomy.lower:${input.to}:${[...input.actionIds].sort().join(',')}`,
  async precheck(ctx: ActionContext) {
    // A member never gets a card that fails at Approve. An agent or token
    // proposer has no account role; the approver is checked at execute.
    const proposer = ctx.invokedBy;
    if (proposer && !proposer.startsWith('agent:') && !proposer.startsWith('token:')) {
      return (await adminCheck(ctx.orgId, proposer, NOT_ADMIN)) ?? undefined;
    }
    return undefined;
  },
  async reviewCard(_ctx, input) {
    return {
      title: 'Lower trust',
      system: 'Autonomy',
      summary: `Ask before ${input.actionIds.join(', ')} goes past ${input.to}.`,
      fields: [
        { label: 'Actions', value: input.actionIds.join(', ') },
        { label: 'No further than', value: input.to },
      ],
      nextAction: 'Approving lowers trust to this rung where it is higher today. It never raises it.',
      verbs: { approve: 'Lower', reject: 'Leave as is' },
    };
  },
  async execute(ctx: ActionContext, input) {
    const by = ctx.reviewedBy ?? ctx.invokedBy;
    const notAdmin = await adminCheck(ctx.orgId, by, NOT_ADMIN);
    if (notAdmin) {
      throw new Error(notAdmin);
    }
    return { lowered: await lowerAll({ orgId: ctx.orgId, by: by! }, input) };
  },
  async undo() {
    throw new Error('Raising autonomy is earned; promote it from the Autonomy page when its evidence supports it.');
  },
};
