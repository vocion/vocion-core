/**
 * file_ask / withdraw_ask — an agent puts a question in front of a person,
 * and takes it back when the thing it asked about went away.
 *
 * Both go through the action rail (`libs/actions/ask-file.ts`,
 * `libs/actions/ask-withdraw.ts`) rather than calling `AskService` directly,
 * because whether an agent may interrupt a person is a trust question, not a
 * plumbing one: the workspace's `trust.yaml` decides whether a filing lands
 * on Needs you at once or a person first sees "this agent wants to ask you
 * something". The default is done for you above the bar, with Undo.
 *
 * What the tool stamps that the model never types: who is asking
 * (`ctx.agentSlug`), the mission and the mission run or conversation the
 * question came up in — so a person opening the ask can reach the work that
 * raised it in one move, and an automation on `ask.decided` can filter on
 * the asking agent and the kind.
 */

import type { RuntimeContext } from '../types';
import type { AskFileInput } from '@/libs/actions/ask-file';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ActionError, proposeAction } from '@/services/ActionService';
import { ASK_KINDS, ASK_RISKS, getAsk } from '@/services/AskService';
import { checkProposalBudget, isAgentsOwnSchedule } from '@/services/proposals/ProposalBudgetService';
import { askInWords, whoHoldsTheAsk } from '../decisionHolder';

/**
 * The agent principal every tool-made proposal rides — working autonomy, judged by the ladder.
 * @param ctx
 */
function agentPrincipal(ctx: RuntimeContext) {
  return {
    kind: 'agent' as const,
    id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown',
    scope: { orgId: ctx.orgId },
    grants: ['*'],
    autonomy: 2 as const,
  };
}

/** An option as the model writes it. */
type ToolOption = string | { id?: string; label: string; description?: string; recommended?: boolean; confidence?: number; effect?: { action_id: string; input?: Record<string, unknown> } };

/**
 * An option as the ask stores it: the model's `effect` is the option's `action`.
 * @param o - The option as the model wrote it.
 */
function optionForAsk(o: ToolOption): NonNullable<AskFileInput['options']>[number] {
  if (typeof o === 'string') {
    return o;
  }
  const { effect, ...rest } = o;
  return { ...rest, ...(effect ? { action: { id: effect.action_id, input: effect.input ?? {} } } : {}) };
}

/**
 * Ask the person in this conversation, here: a Decision docked above their
 * composer. The turn ends at it (`agents/handOff.ts`), and their answer comes
 * back to this agent as a typed decision event — so nothing here tells the
 * model to wait, to ask in words, or that the question is on Needs you.
 * @param ctx - The turn.
 * @param args - The ask, as the model wrote it.
 * @param args.title - The question.
 * @param args.body - Why.
 * @param args.kind - What sort of thing.
 * @param args.risk - How much rides on it.
 * @param args.object_refs - What it is about.
 * @param args.allow_other - Offer a free-text answer.
 * @param args.multiple - Several options at once.
 * @param args.due_at - When it must be decided by.
 * @param args.context_md - The long form.
 * @param args.source_ref - The filer's idempotency key.
 * @param options - Its options, as the ask stores them.
 * @param held - Who holds it.
 */
async function raiseHere(
  ctx: RuntimeContext,
  args: { title: string; body?: string; kind?: AskFileInput['kind']; risk?: AskFileInput['risk']; object_refs?: Array<{ type: string; id: string | number }>; allow_other?: boolean; multiple?: boolean; due_at?: string; context_md?: string; source_ref?: string },
  options: NonNullable<AskFileInput['options']>,
  held: Extract<NonNullable<Awaited<ReturnType<typeof whoHoldsTheAsk>>>, { held: 'here' }>,
): Promise<string> {
  const { AskError, normaliseObjectRefs, normaliseOptions } = await import('@/services/AskService');
  const { raiseDecision } = await import('@/services/decisions/DecisionService');
  try {
    const { view, created } = await raiseDecision({
      orgId: ctx.orgId,
      conversationId: ctx.conversationId!,
      ownerUserId: ctx.userId!,
      agentSlug: ctx.agentSlug ?? null,
      kind: args.kind ?? 'approval',
      question: args.title,
      body: args.body ?? null,
      options: normaliseOptions(options),
      allowOther: args.allow_other ?? true,
      multiple: args.multiple ?? false,
      objectRefs: normaliseObjectRefs(args.object_refs),
      risk: args.risk ?? null,
      dueAt: args.due_at ? new Date(args.due_at) : null,
      contextMd: args.context_md ?? null,
      sourceRef: args.source_ref ?? null,
    });
    ctx.emit({ type: 'decision', decision: view });
    ctx.emit({ type: 'tool_progress', tool: 'file_ask', meta: { decisionId: view.id, docked: true, created } } as never);
    const who = held.name ?? 'The person';
    return [
      `Asked ${who} here: decision #${view.id} is docked above their composer${view.options.length > 0 ? `, ${view.options.length} options${view.options[0]?.recommended ? ', your recommendation first' : ''}` : ', answered in their words'}. Your turn ends now; their answer comes back to you as a typed decision event.`,
      'Do not ask it again in words, do not say it is on Needs you, and do not route it to "the owner" — they are the one deciding.',
      held.href ? `It is about ${held.about ?? 'the record'}: ${held.href}` : null,
      held.merge ? `What the records say: ${held.merge}` : null,
    ].filter(Boolean).join(' ');
  } catch (err) {
    if (err instanceof AskError) {
      return `Not asked (${err.code}): ${err.message}`;
    }
    return `Not asked: ${(err as Error).message}`;
  }
}

const KIND_GUIDE = 'approval (approve, reject or mark done), input (you need a value or a decision only they have), ruling (choose between options), credential (paste a secret; the value never travels through the ask), merge (a PR for a person to merge), recommendation (you recommend an outcome; they authorise), gate (a run may not continue without a yes)';

export function fileAskTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      // THE PROPOSAL BUDGET (see ProposalBudgetService): an agent on its own
      // schedule with its share of Review already undecided files no new ask
      // until it withdraws one of its own.
      if (ctx.agentSlug && isAgentsOwnSchedule(ctx)) {
        const verdict = await checkProposalBudget({ orgId: ctx.orgId, agentSlug: ctx.agentSlug });
        if (!verdict.ok) {
          return verdict.message;
        }
      }
      const args = raw as {
        title: string;
        body?: string;
        kind?: AskFileInput['kind'];
        options?: ToolOption[];
        allow_other?: boolean;
        multiple?: boolean;
        risk?: AskFileInput['risk'];
        group_key?: string;
        group_title?: string;
        object_refs?: Array<{ type: string; id: string | number }>;
        decision_cost?: number;
        context_url?: string;
        context_md?: string;
        source_ref?: string;
        due_at?: string;
        confidence: number;
      };
      const options = args.options?.map(optionForAsk);
      // THE PERSON ASKING IS THE OWNER (backlog 044): a decision the person in
      // this turn holds is asked HERE, docked above their composer, not filed
      // for "the owner"; a merge that runs itself on its trust rule is asked
      // of nobody.
      const held = await whoHoldsTheAsk(ctx, { kind: args.kind, title: args.title, objectRefs: args.object_refs });
      if (held?.held === 'moot') {
        ctx.emit({ type: 'tool_progress', tool: 'file_ask', meta: { filed: false, reason: 'decision_moot' } } as never);
        return held.message;
      }
      if (held?.held === 'here' && ctx.conversationId && ctx.userId) {
        // In the app it docks above the composer; a Slack or email thread
        // reads only words, so there it is asked in one numbered line.
        if (!held.docked) {
          ctx.emit({ type: 'tool_progress', tool: 'file_ask', meta: { filed: false, reason: 'decision_held_here' } } as never);
          return askInWords(held);
        }
        return raiseHere(ctx, args, options ?? [], held);
      }
      const input: Record<string, unknown> = {
        title: args.title,
        body: args.body,
        kind: args.kind,
        options,
        risk: args.risk,
        groupKey: args.group_key,
        groupTitle: args.group_title,
        objectRefs: args.object_refs,
        decisionCost: args.decision_cost,
        contextUrl: args.context_url,
        contextMd: args.context_md,
        sourceRef: args.source_ref,
        dueAt: args.due_at,
        // Stamped from the run, never from the model.
        agentSlug: ctx.agentSlug,
        missionSlug: ctx.missionSlug,
        origin: ctx.missionRunId || ctx.conversationId
          ? { missionRunId: ctx.missionRunId, conversationId: ctx.conversationId }
          : undefined,
      };
      // The wiki pages that bear on a ruling travel with it as advice; the
      // check never refuses (`wikiDecision.ts`, Chris 2026-09-29).
      const { wikiPassagesUnread } = await import('../wikiDecision');
      const unread = await wikiPassagesUnread(ctx, 'ask.file', input as Record<string, unknown>);
      const wikiNote = unread ? `\n\nFor the record, these wiki pages may bear on it: ${unread.map(p => `${p.title} (wiki:${p.slug})`).join('; ')}. If one changes the question, say so in one line.` : '';
      try {
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: 'ask.file',
          input,
          principal: agentPrincipal(ctx),
          invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
          // No recommendation on the envelope: the agent asking for a
          // decision has no verdict on whether it should be allowed to ask.
          // A null pair stores nothing and stays out of the agreement rate.
          proposal: {
            confidence: args.confidence,
            rationale: args.body ?? args.title,
            agentSlug: ctx.agentSlug,
            suggestedDecision: null,
            suggestedDecisionReason: null,
          },
        });
        ctx.emit({ type: 'tool_progress', tool: 'file_ask', meta: { runId: res.runId, status: res.status, outcome: res.outcome } } as never);
        if (res.outcome === 'refreshed') {
          return `The proposal to ask "${args.title}" was already waiting for a person's go-ahead and now carries this wording (run #${res.runId}). Nothing new was asked. Do NOT say the question is on Needs you.`;
        }
        if (res.status === 'pending') {
          return `Asking "${args.title}" is PENDING a person's decision first (run #${res.runId}, confidence ${args.confidence} was under the bar for ask.file in this workspace). Do NOT say the question was asked — say it is queued in Review.`;
        }
        if (res.status !== 'done') {
          return `The ask was not filed (run #${res.runId} is ${res.status}${res.error ? `: ${res.error}` : ''}).`;
        }
        const r = (res.result ?? {}) as { askId?: number; url?: string | null; created?: boolean; kind?: string; groupKey?: string | null };
        const where = r.url ? ` It is on Needs you: ${r.url}` : ' It is on Needs you.';
        const group = r.groupKey ? ` Part of decision sheet "${r.groupKey}".` : '';
        if (r.created === false) {
          return `Ask #${r.askId} already existed for source_ref "${args.source_ref}" and was updated in place (run #${res.runId}).${where}${group} Its status was left as it was.`;
        }
        return `Ask #${r.askId} filed (${r.kind ?? args.kind ?? 'approval'}, run #${res.runId}).${where}${group} A person decides it there; you do not have the answer yet, so say the question was asked, not answered. Read the answer back from the ask.decided event or GET /api/v1/asks/${r.askId}.${wikiNote}`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Ask refused (${err.code}): ${err.message}`;
        }
        return `Ask failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'file_ask',
      description: `Put ONE question in front of a person when you need a ruling, an approval, an input, a credential, a merge, or want to recommend an outcome a person must authorise. In a person's own conversation it is asked THERE, as a card docked above their composer, and your turn ends at it: their answer comes back to you as a typed decision event. With nobody here (a mission, an automation) it lands on Needs you with a deadline and a default. An option's effect runs as the person the moment they choose it; otherwise the answer IS the outcome, and you (or an automation on ask.decided) read it back. Write it to be answered from a phone: a title that is the question (≤ 80 chars), a body of two to four lines (≤ 400 chars) saying why and what happens on each answer, and options whose description is the consequence of picking each, and the long form goes in context_md. Name the records it is about in object_refs so the answer can be written back onto them. Several questions decided together share a group_key, and so does ONE question asked about several records: if a person would answer all of them with a single rule, it is one decision sheet, not one ask per record. Kinds: ${KIND_GUIDE}. Done for you above the confidence bar (the ask is filed at once, and a person can withdraw it with Undo); below it, or where the workspace holds ask.file at approval, a person first decides whether you may ask.`,
      schema: z.object({
        title: z.string().min(1).max(200).describe('The question, as a person would ask it aloud. One line, ≤ 80 characters reads best.'),
        body: z.string().max(4_000).optional().describe('Two to four lines: why, and what happens on each answer. Markdown. ≤ 400 characters reads best; put the rest in context_md.'),
        kind: z.enum(ASK_KINDS).optional().describe(`What sort of thing is waiting. Default "approval". ${KIND_GUIDE}.`),
        options: z.array(z.union([
          z.string().min(1).max(200),
          z.object({
            id: z.string().min(1).max(80).optional().describe('Stable id; defaults to a slug of the label.'),
            label: z.string().min(1).max(200),
            description: z.string().max(400).optional().describe('The consequence of picking it, one line.'),
            recommended: z.boolean().optional().describe('At most one option. Pre-selected and drawn as the obvious choice.'),
            confidence: z.number().min(0).max(1).optional().describe('How sure you are of THIS option, 0–1. For the recommended one.'),
            effect: z.object({
              action_id: z.string().min(1).max(120).describe('A registered action id from ACTIONS in your instructions.'),
              input: z.record(z.string(), z.unknown()).default({}).describe('Its input, exactly as propose_action would take it.'),
            }).optional().describe('What choosing it DOES: this action runs as the person who chose it, the moment they choose. Omit for an answer that only informs you.'),
          }),
        ])).max(8).optional().describe('Named answers, at most 8. Bare strings work. A free-text answer and Skip are always there on top; an approval with no options answers Approve or Reject.'),
        allow_other: z.boolean().optional().describe('Offer "Something else" — an answer in their own words. Default true.'),
        multiple: z.boolean().optional().describe('Several options may be chosen together. Default false.'),
        risk: z.enum(ASK_RISKS).optional().describe('How much rides on the answer, shown as a chip on the row.'),
        group_key: z.string().min(1).max(200).optional().describe('Several asks under one key are answered as one decision sheet, one question per screen. Use one key per batch AND whenever one question is being asked about several records: four asks that a person answers with one rule are one decision, not four, and filing them ungrouped is four screens of the same question.'),
        group_title: z.string().min(1).max(200).optional().describe('What the sheet is called.'),
        object_refs: z.array(z.object({
          type: z.string().min(1).max(100).describe('An object type slug, e.g. "request".'),
          id: z.union([z.string().min(1).max(200), z.number().int()]).describe('The record\'s id.'),
        })).max(20).optional().describe('The records this question is about. They ride the ask.decided event so the answer can be written back onto them.'),
        decision_cost: z.number().int().min(0).max(100_000).optional().describe('Minutes of the person\'s attention this decision takes — 1 for a yes/no with the evidence in hand, 60 for an architecture call.'),
        context_url: z.string().url().optional().describe('The long form — the record, the PR, the run. Defaults to the mission run this turn belongs to.'),
        context_md: z.string().max(20_000).optional().describe('Collapsed Details, markdown: evidence, alternatives considered, what you could not establish.'),
        source_ref: z.string().min(1).max(200).optional().describe('Your own idempotency key. Filing it again updates the open ask instead of asking twice; a decided ask is never reopened.'),
        due_at: z.string().datetime().optional().describe('ISO timestamp: when this must be decided by. If nobody answers by then, your recommended option applies by default where the trust ladder allows it (else it stays and is escalated). Omit it and a window by risk applies — a day low, three days medium, a week high.'),
        confidence: z.number().min(0).max(1).describe('Your confidence this is worth a person\'s minute NOW — that only they can decide it and you have given them what they need. An honest number decides whether it is asked at once or a person first sees the proposal to ask.'),
      }),
    },
  );
}

export function withdrawAskTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const { ask_id, reason, confidence } = raw as { ask_id: number; reason: string; confidence: number };
      // Only what this agent filed. Another agent's question, or a person's,
      // is not this agent's to take back.
      const ask = await getAsk(ctx.orgId, ask_id);
      if (!ask) {
        return `No ask #${ask_id} in this workspace.`;
      }
      if (ask.agentSlug && ctx.agentSlug && ask.agentSlug !== ctx.agentSlug) {
        return `Refused: ask #${ask_id} was filed by "${ask.agentSlug}", not by you. Only the asker withdraws a question; say why it is moot in your report instead.`;
      }
      if (ask.status !== 'open') {
        return `Ask #${ask_id} is already ${ask.status}; there is nothing to withdraw. ${ask.decision ? `The answer was "${ask.decision}"${ask.decisionNote ? ` — ${ask.decisionNote}` : ''}.` : ''}`.trim();
      }
      try {
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: 'ask.withdraw',
          input: { askId: ask_id, reason },
          principal: agentPrincipal(ctx),
          invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
          proposal: {
            confidence,
            rationale: reason,
            agentSlug: ctx.agentSlug,
            suggestedDecision: null,
            suggestedDecisionReason: null,
          },
        });
        ctx.emit({ type: 'tool_progress', tool: 'withdraw_ask', meta: { runId: res.runId, status: res.status, outcome: res.outcome } } as never);
        if (res.status === 'pending') {
          return `Withdrawing ask #${ask_id} is PENDING a person's decision (run #${res.runId}, confidence ${confidence} was under the bar). The question is still open; do NOT say it was withdrawn.`;
        }
        if (res.status !== 'done') {
          return `Ask #${ask_id} was not withdrawn (run #${res.runId} is ${res.status}${res.error ? `: ${res.error}` : ''}).`;
        }
        const r = (res.result ?? {}) as { withdrawn?: boolean; status?: string };
        if (r.withdrawn === false) {
          return `Ask #${ask_id} was answered (${r.status}) before it could be withdrawn. The person's answer stands; read it back.`;
        }
        return `Ask #${ask_id} withdrawn ("${ask.title}", run #${res.runId}). It is closed as superseded with your reason; a person can reopen it with Undo.`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Withdrawal refused (${err.code}): ${err.message}`;
        }
        return `Withdrawal failed: ${(err as Error).message}`;
      }
    },
    {
      name: 'withdraw_ask',
      description: 'Take back an open question YOU filed with file_ask because the thing it asked about went away — the request was closed, the PR merged on its own, the batch was re-ranked. The ask closes as superseded with your reason and nobody is asked anything. You cannot withdraw another agent\'s question or one a person has already answered.',
      schema: z.object({
        ask_id: z.number().int().positive().describe('The ask id file_ask returned.'),
        reason: z.string().min(1).max(500).describe('Why it no longer needs answering, in a sentence. Written on the ask.'),
        confidence: z.number().min(0).max(1).describe('Your confidence the question is moot, 0–1.'),
      }),
    },
  );
}
