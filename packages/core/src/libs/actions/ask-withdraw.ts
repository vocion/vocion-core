/**
 * ask.withdraw — the thing an agent asked about went away before anyone
 * answered: the request was closed, the PR merged on its own, the batch was
 * re-ranked. Leaving the question open would cost a person a minute deciding
 * something that no longer needs deciding, so the asker takes it back.
 *
 * `supersedeAsk` already existed for exactly this; what was missing was a way
 * for an agent to reach it. Through the rail it is reversible (`undo`
 * reopens a superseded ask — never one a person answered) and low-risk, so it
 * runs on its own above the bar and shows with Undo. The tool that proposes
 * it (`withdraw_ask`) lets an agent withdraw only what it filed.
 */

import type { Action } from './types';
import { z } from 'zod';

const askWithdrawInput = z.object({
  askId: z.coerce.number().int().positive(),
  /** Why the question no longer needs answering. Written on the ask as its closing note. */
  reason: z.string().min(1).max(500),
});

export type AskWithdrawInput = z.infer<typeof askWithdrawInput>;

export const askWithdrawAction: Action<typeof askWithdrawInput> = {
  id: 'ask.withdraw',
  name: 'Withdraw an ask',
  description: 'Take back an open question on Needs you because the thing it asked about went away. Nobody is asked anything; the ask closes as superseded with the reason. Reversible while nobody has answered: Undo reopens it.',
  inputSchema: askWithdrawInput,
  grant: 'file_ask',
  external: false,
  dedupKeyFor: input => `ask.withdraw:${input.askId}`,
  async precheck(ctx, input) {
    const { getAsk } = await import('@/services/AskService');
    const ask = await getAsk(ctx.orgId, input.askId);
    if (!ask) {
      return `No ask #${input.askId} in this workspace.`;
    }
    if (ask.status !== 'open') {
      return `Ask #${input.askId} is already ${ask.status}; there is nothing to withdraw.`;
    }
    return undefined;
  },
  async reviewCard(ctx, input) {
    const { getAsk } = await import('@/services/AskService');
    const ask = await getAsk(ctx.orgId, input.askId);
    return {
      title: `Withdraw: ${ask?.title ?? `ask #${input.askId}`}`,
      system: 'Ask',
      summary: input.reason,
      fields: [
        { label: 'Ask', value: `#${input.askId}${ask ? ` · ${ask.kind}` : ''}`, href: `/dashboard/inbox/${input.askId}` },
        ...(ask?.agentSlug ? [{ label: 'Asked by', value: ask.agentSlug }] : []),
      ],
      nextAction: 'Approving closes the question as superseded, with the reason. Undo reopens it while nobody has answered.',
      verbs: { approve: 'Withdraw', reject: 'Keep asking' },
    };
  },
  async execute(ctx, input) {
    const { getAsk, supersedeAsk } = await import('@/services/AskService');
    const before = await getAsk(ctx.orgId, input.askId);
    if (!before) {
      throw new Error(`No ask #${input.askId} in this workspace.`);
    }
    if (before.status !== 'open') {
      // Somebody answered between the proposal and the approval. Their
      // answer stands; the run says nothing was withdrawn.
      return { askId: input.askId, withdrawn: false, status: before.status, title: before.title };
    }
    const ask = await supersedeAsk(ctx.orgId, input.askId, input.reason);
    return { askId: ask.id, withdrawn: true, status: ask.status, previousStatus: 'open', title: ask.title, withdrawnBy: ctx.invokedBy ?? null };
  },
  async undo(ctx, input, result) {
    if (result.withdrawn !== true) {
      return { askId: input.askId, reopened: false, reason: 'this run withdrew nothing' };
    }
    const { reopenAsk } = await import('@/services/AskService');
    const ask = await reopenAsk(ctx.orgId, input.askId);
    return { askId: ask.id, reopened: ask.status === 'open', status: ask.status };
  },
};
