/**
 * WHAT A POST IN A TEAM THREAD SAID ABOUT THE THREAD — read by a model,
 * never matched (CLAUDE.md, "Meaning is read by a model, never matched").
 *
 * The settle rule routes on two facts only a reading of the words can give:
 *
 *   - `readMemberPost` — did this member say its part is complete?
 *   - `readLeadReview` — did the lead declare the thread settled and write its
 *     outcome, rather than steer the team to another round?
 *
 * Each is one call to the small model bound to one tool whose schema is the
 * typed answer, the same shape as `agents/turnJudge.ts`. Code routes on the
 * field; nobody edits the post. Every read is charged, inside the thread's
 * cost scope, so it is counted on the thread's run with the turns.
 *
 * A read that fails says "no": the member is not complete, the lead has not
 * settled it. The thread then runs on to its next rule — every thread is
 * bounded by its round and budget caps — rather than ending on a guess.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';

type Model = Pick<BaseChatModel, 'bindTools'>;

export const MemberPostReadSchema = z.object({
  complete: z.boolean().describe('True when the post says the member\'s part of the question is answered and it has nothing further to add — whether or not the post also adds something. False when it asks a question, waits on someone, promises more, or simply contributes without saying it is done.'),
});

export const LeadReviewReadSchema = z.object({
  settled: z.boolean().describe('True when the lead declares the thread settled — closing the discussion and stating its outcome. False when the lead steers the team to another round, asks for more, or leaves the question open.'),
});

export type MemberPostRead = z.infer<typeof MemberPostReadSchema> & { unread?: true };
export type LeadReviewRead = z.infer<typeof LeadReviewReadSchema> & { unread?: true };

async function read<T>(orgId: string, agentSlug: string, model: Model | undefined, schema: z.ZodType<T>, name: string, system: string, human: string): Promise<T | null> {
  const { tool } = await import('@langchain/core/tools');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const report = tool(async () => 'recorded', { name, description: 'Report what the post says, as typed fields.', schema: schema as never });
  const m = model ?? await classifier(orgId);
  const bound = m.bindTools!([report], { tool_choice: name } as never);
  const res = await bound.invoke([new SystemMessage(system), new HumanMessage(human)]) as { tool_calls?: Array<{ name: string; args: unknown }> };
  // Charged where it was spent: inside the thread's cost scope, so the read is
  // counted on the thread's run beside the turns it read.
  const [{ chargeModelCall }, { FEATURES }] = await Promise.all([import('@/services/budget/chargeModelCall'), import('@/libs/Langfuse/features')]);
  await chargeModelCall({ orgId, agentSlug, feature: FEATURES.TEAM_THREAD_READ, role: 'classifier', response: res });
  const call = (res.tool_calls ?? []).find(c => c.name === name);
  const parsed = call ? schema.safeParse(call.args) : null;
  return parsed?.success ? parsed.data : null;
}

async function classifier(orgId: string): Promise<Model> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  return buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 200 }) as Promise<Model>;
}

/**
 * Did this member say its part is complete?
 * @param input - The post.
 * @param input.orgId - The workspace.
 * @param input.member - The member's slug, charged for the read.
 * @param input.question - The thread's question.
 * @param input.post - What the member posted.
 * @param model - Injected in tests.
 */
export async function readMemberPost(input: { orgId: string; member: string; question: string; post: string }, model?: Model): Promise<MemberPostRead> {
  try {
    const out = await read(input.orgId, input.member, model, MemberPostReadSchema, 'report_post', 'A specialist posted in a team thread about one question. You report, as typed fields, whether the post says the specialist\'s part is complete. Judge the meaning, not the wording. Answer only through the tool.', [
      `The thread's question: ${input.question.slice(0, 2_000)}`,
      `The post: ${input.post.slice(-6_000)}`,
    ].join('\n\n'));
    return out ?? { complete: false, unread: true };
  } catch (err) {
    console.warn('team thread: member post read failed', { orgId: input.orgId, member: input.member, message: (err as Error).message });
    return { complete: false, unread: true };
  }
}

/**
 * Did the lead declare the thread settled?
 * @param input - The review.
 * @param input.orgId - The workspace.
 * @param input.lead - The lead's slug, charged for the read.
 * @param input.question - The thread's question.
 * @param input.review - What the lead wrote after the round.
 * @param model - Injected in tests.
 */
export async function readLeadReview(input: { orgId: string; lead: string; question: string; review: string }, model?: Model): Promise<LeadReviewRead> {
  try {
    const out = await read(input.orgId, input.lead, model, LeadReviewReadSchema, 'report_review', 'The lead of a team thread wrote this after a round of posts. You report, as typed fields, whether the lead declared the thread settled and wrote its outcome, or steered the team to another round. Judge the meaning, not the wording. Answer only through the tool.', [
      `The thread's question: ${input.question.slice(0, 2_000)}`,
      `The lead wrote: ${input.review.slice(-6_000)}`,
    ].join('\n\n'));
    return out ?? { settled: false, unread: true };
  } catch (err) {
    console.warn('team thread: lead review read failed', { orgId: input.orgId, lead: input.lead, message: (err as Error).message });
    return { settled: false, unread: true };
  }
}
