/**
 * The judgement of one thread or approval: what the person was trying to do,
 * whether they got there, and what would have been better. A model reads the
 * thread with its structure — the facts code computed (`facts.ts`), every turn
 * with its effort level, model, time and spend — and answers through one
 * forced tool call in typed fields. It interprets; it never counts. The re-ask
 * count, the turns, the time and the money are code's, and the report prints
 * code's numbers, never the model's.
 *
 * Only ever called for an Org read with content (`privacy.ts`). The caller
 * decides; this module receives the transcript or it does not run.
 *
 * Bounded: the caller holds a spend cap and stops calling when it is reached.
 * A read that fails or answers out of shape is `null` — the item keeps its
 * structural reading, and the report says it was not judged.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ReviewMessage } from './facts';
import { z } from 'zod';
import { EFFORT_LEVELS } from '@/libs/llm/modelPrefs';
import { FRICTION_THEMES, OUTCOMES } from './facts';

/** How much of one message the judge reads. */
const MESSAGE_CHARS = 1_200;

/** How much transcript the judge reads in all. */
const TRANSCRIPT_CHARS = 14_000;

export const CAPABILITY_KINDS = ['connector', 'skill', 'tool'] as const;
export type CapabilityKind = typeof CAPABILITY_KINDS[number];

export const ThreadJudgementSchema = z.object({
  intent: z.string().max(240).describe('What the person was trying to do, in one plain clause. About the work, never personal details.'),
  goal: z.string().max(240).describe('The outcome they wanted when they were done, in one clause.'),
  outcome: z.enum(OUTCOMES).describe('reached: they got what they wanted. partial: some of it. not_reached: they did not. unclear: the thread does not show.'),
  outcome_reason: z.string().max(400).describe('One sentence from the thread that shows the outcome.'),
  reask_reason: z.string().max(300).nullable().describe('When the facts list re-asks: why the person had to ask again, in one sentence. Null when there were none.'),
  time_fit: z.enum(['reasonable', 'too_slow', 'too_costly', 'slow_and_costly']).describe('Were the time and spend reasonable for what was asked, given the facts?'),
  effort_fit: z.enum(['right', 'too_low', 'too_high']).describe('Did the effort level each turn ran at fit the request? too_low: the request needed more (e.g. Quick on something that needed Standard).'),
  effort_needed: z.enum(EFFORT_LEVELS).nullable().describe('With too_low or too_high: the level the request needed. Null otherwise.'),
  thinking: z.enum(['appropriate', 'too_little', 'too_much', 'unclear']).describe('Did the turns think as much as the request needed?'),
  missing: z.array(z.object({
    kind: z.enum(CAPABILITY_KINDS),
    name: z.string().min(1).max(80).describe('What was missing, named plainly: a connector ("HubSpot"), a skill ("contract review"), a tool ("calendar write").'),
    why: z.string().max(200).describe('What it would have let the agent do in this thread.'),
  })).max(3).describe('A connector, skill or tool the agent needed and did not have. Empty when nothing was missing.'),
  quality: z.enum(['good', 'acceptable', 'poor', 'unclear']).describe('The quality of what the agent produced.'),
  quality_reason: z.string().max(300).describe('One sentence: why that quality.'),
  themes: z.array(z.enum(FRICTION_THEMES)).max(4).describe('The friction this thread shows, from the list. Empty when it went well.'),
  better: z.string().max(240).describe('What would have been better, in one line a product team can act on. "Nothing" when it went well.'),
  rule: z.string().max(400).nullable().describe('A standing instruction to the agent that would have prevented the friction — general and imperative, never this case\'s specifics. Null when no rule would.'),
});

export type ThreadJudgement = z.infer<typeof ThreadJudgementSchema>;

/** What the judge is told about the workspace, so "missing" is read against what it has. */
export type WorkspaceContext = {
  name: string;
  /** Connectors the workspace has connected. */
  connectors: string[];
  /** Its agents, by name, with what each is for. */
  agents: Array<{ slug: string; name: string; description: string | null }>;
};

/** One thing to judge: a thread, or an approval read on its own. */
export type JudgeItem = {
  ref: string;
  kind: 'thread' | 'approval';
  agentSlug: string | null;
  /** The facts as `describeFacts` wrote them: code's numbers. */
  facts: string;
  /** The thread's messages, in content mode. */
  messages?: readonly ReviewMessage[];
  /** For an approval: what was proposed and why, and what the person decided. */
  approval?: { title: string; reason: string | null; decision: string; recommended: string | null };
};

type Model = Pick<BaseChatModel, 'bindTools'>;

const SYSTEM = `You review how people used an AI agent workspace yesterday, one item at a time, so the product can get better. You are given FACTS the platform measured — turns, time, spend, the effort level and model each turn ran at, tool failures, and the re-asks code detected — and the TRANSCRIPT or the decision.

Judge it the way a careful product manager would:
- intent and goal: what the person was trying to get done, about the work, never personal details;
- outcome: did they get there; "unclear" beats a guess;
- time and spend: reasonable for what was asked?;
- effort: Quick is a fast small model with no thinking, Standard the agent's own model, Deep the strongest model with thinking. Did the level fit?;
- thinking: did the turns think as much as the request needed?;
- missing: a connector, skill or tool the agent needed and did not have — only when the thread shows it;
- quality of what the agent produced;
- the one thing that would have been better.

Never count: the facts are already counted and the report prints them. Argue only from what you are given. Write for the workspace's admins: plain words, no system names, no quotes of the person's words.`;

/**
 * The transcript as the judge reads it: each message with its id and role,
 * cut to fit. Pure.
 * @param messages - The thread, oldest first.
 */
export function transcriptOf(messages: readonly ReviewMessage[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') {
      continue;
    }
    const text = m.content.length > MESSAGE_CHARS ? `${m.content.slice(0, MESSAGE_CHARS)}…` : m.content;
    const line = `[${m.id}] ${m.role === 'user' ? 'PERSON' : 'AGENT'}: ${text}`;
    if (used + line.length > TRANSCRIPT_CHARS) {
      lines.push(`[… ${messages.length - lines.length} more messages not shown]`);
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

/**
 * What the judge reads for one item. Pure.
 * @param ws - The workspace.
 * @param item - The item.
 */
export function judgePrompt(ws: WorkspaceContext, item: JudgeItem): string {
  const parts = [
    `Workspace: ${ws.name}`,
    `Connected: ${ws.connectors.length > 0 ? ws.connectors.join(', ') : 'nothing yet'}`,
    `Agents: ${ws.agents.map(a => `${a.name} (${a.slug})${a.description ? ` — ${a.description.slice(0, 100)}` : ''}`).join('; ')}`,
    '',
    `ITEM ${item.ref} (${item.kind}${item.agentSlug ? `, agent ${item.agentSlug}` : ''})`,
    'FACTS:',
    item.facts,
  ];
  if (item.approval) {
    parts.push('', 'DECISION:', `proposed: ${item.approval.title}`, `why: ${item.approval.reason ?? 'not given'}`, `recommended: ${item.approval.recommended ?? 'nothing'}`, `the person decided: ${item.approval.decision}`);
  }
  if (item.messages && item.messages.length > 0) {
    parts.push('', 'TRANSCRIPT:', transcriptOf(item.messages));
  }
  return parts.join('\n');
}

export type JudgeCall = { judgement: ThreadJudgement | null; microCents: number };

/**
 * Judge one item. Never throws: a failed read is a null judgement, with what
 * it cost all the same.
 * @param input - What the judge reads.
 * @param input.orgId - The workspace: its model key, the trace and the charge.
 * @param input.workspace - The workspace's context.
 * @param input.item - The item.
 * @param injected - A model, for tests; the org's classifier otherwise.
 */
export async function judgeItem(input: { orgId: string; workspace: WorkspaceContext; item: JudgeItem }, injected?: Model): Promise<JudgeCall> {
  let response: unknown = null;
  let judgement: ThreadJudgement | null = null;
  const started = Date.now();
  try {
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const model = injected ?? await classifier(input.orgId);
    const report = tool(async () => 'recorded', { name: 'report_usage_review', description: 'Report the judgement of this item.', schema: ThreadJudgementSchema as never });
    const bound = model.bindTools!([report], { tool_choice: 'report_usage_review' } as never);
    response = await bound.invoke([new SystemMessage(SYSTEM), new HumanMessage(judgePrompt(input.workspace, input.item))]);
    const call = ((response as { tool_calls?: Array<{ name: string; args: unknown }> }).tool_calls ?? []).find(c => c.name === 'report_usage_review');
    const parsed = call ? ThreadJudgementSchema.safeParse(call.args) : null;
    judgement = parsed?.success ? parsed.data : null;
  } catch (error) {
    console.error(`[usageReview] the judge could not read ${input.item.ref} in ${input.orgId}`, (error as Error).message);
  }
  let microCents = 0;
  if (response) {
    const [{ modelIdOf, tokenUsageOf }, { tokenCostMicroCents }, { resolvedModelId }] = await Promise.all([import('@/libs/llm/usage'), import('@/libs/pricing'), import('@/libs/llm')]);
    const usage = tokenUsageOf(response);
    microCents = usage ? tokenCostMicroCents(modelIdOf(response) ?? resolvedModelId('classifier'), usage) : 0;
    if (!injected) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: input.orgId, feature: FEATURES.USAGE_REVIEW, role: 'classifier', response, latencyMs: Date.now() - started });
    }
  }
  return { judgement, microCents };
}

async function classifier(orgId: string): Promise<Model> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  return buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 1_500 }) as Promise<Model>;
}
