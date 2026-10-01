/**
 * THE CORRECTION A REPLY OWES, typed (run 3, 2026-10-01).
 *
 * FE-303's filing reply ended: "The request was filed (request #303) —
 * 'Filing it now' was accurate, but the opening line 'I'll check what's there
 * before filing' implied the filing hadn't happened yet when it had." The
 * claim check (`applyTurnGuarantees`) had asked the agent's model, in free
 * text, for "one sentence on what did not happen, or nothing at all", and the
 * model answered with a critique of its own wording, which went to the person.
 *
 * So the pass answers through a tool: whether a correction is owed at all,
 * read against the steps, and the sentence for the person, about the work and
 * never about the reply. Code routes on `owed`: nothing is said when it is
 * false. The sentence is the agent's own, from its model; nothing edits it.
 */
import { z } from 'zod';

export const CorrectionSchema = z.object({
  owed: z.boolean().describe('True only when, read against the steps, something the reply says was done was not done, or a failed step goes unmentioned, AND the reply does not already tell the person so. False when the steps show the work done, whatever the reply\'s wording or order.'),
  sentence: z.string().max(400).describe('When owed: one sentence to the person about the work itself (what did not happen, and what happens next), in your own voice. Never about the reply, its wording, its tone, or what an earlier line implied. Empty when not owed.'),
});
export type Correction = z.infer<typeof CorrectionSchema>;

/** The pass, injectable in tests. */
export type CorrectionComposer = (input: { orgId: string; system: string; human: string }) => Promise<Correction>;

const NONE: Correction = { owed: false, sentence: '' };

/**
 * The agent's model, asked for the correction through a tool. Nothing on any failure.
 * @param input - What it reads.
 * @param input.orgId - The workspace.
 * @param input.system - The agent's prompt and what is owed.
 * @param input.human - The steps and the reply.
 */
export const composeCorrectionWithModel: CorrectionComposer = async ({ orgId, system, human }) => {
  try {
    const { buildChatModelForOrg } = await import('@/libs/llm');
    const { tool } = await import('@langchain/core/tools');
    const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
    const base = await buildChatModelForOrg('main', orgId, { temperature: 0, streaming: false, maxTokens: 400 });
    const report = tool(async () => 'recorded', { name: 'report_correction', description: 'Report whether the reply owes the person a correction, and the sentence when it does.', schema: CorrectionSchema as never });
    const bound = (base as unknown as { bindTools: (t: unknown[], o: unknown) => { invoke: (m: unknown[]) => Promise<unknown> } }).bindTools([report], { tool_choice: 'report_correction' });
    const res = await bound.invoke([new SystemMessage(system), new HumanMessage(human)]) as { tool_calls?: Array<{ name: string; args: unknown }> };
    const call = (res.tool_calls ?? []).find(c => c.name === 'report_correction');
    const parsed = call ? CorrectionSchema.safeParse(call.args) : null;
    return parsed?.success ? parsed.data : NONE;
  } catch (err) {
    console.warn('correction pass failed; nothing is said', { orgId, message: (err as Error).message });
    return NONE;
  }
};
