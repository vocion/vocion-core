/**
 * WHAT THE PERSON MEANT, AND HOW THE TURN ENDED — read by a model, never by
 * matching words (Chris, 2026-09-29: "we should be using LLM to determine or
 * route based on intent. NEVER HARD CODE WORD MATCHES … ANYWHERE.").
 *
 * The turn loop used to decide from regexes whether a message asked for a
 * change ("expand the scope" matched no verb, conversation 382), whether a
 * reply was only a promise, claimed a write, or wrote a tool call as text.
 * Each of those is a question about meaning. Here each is asked of a small
 * model once, bound to one tool whose schema is the typed answer, and the
 * loop routes on the fields:
 *
 *   - `readIntent` — at the start of the turn, in parallel with it: does the
 *     person want the record on their page changed, a new record filed, a
 *     decision taken on something waiting, an act rather than an answer?
 *   - `judgeAnswer` — when a pass ends: did it answer, or end on a promise;
 *     does it say it did something the tool log does not show; did it write
 *     a call out as text; did it stop mid-thought?
 *
 * A reader that fails returns "no signal" (every flag false), so the turn is
 * never held up by its own judge; the log says it failed.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';

export const TurnIntentSchema = z.object({
  changes_page_record: z.boolean().describe('The person wants the record on the page they are on changed: its fields, scope, acceptance, outcome, story, title — however they phrase it ("expand the scope", "get it into the spec", "add X to it").'),
  files_new_record: z.boolean().describe('The person wants a new or separate record filed or created (a request, a bug, a task, a ticket) — including splitting something out into its own.'),
  decides: z.boolean().describe('The person says what to do with something waiting on them — approve, reject, dismiss, build, merge, defer, send it back — in this message, or this message confirms one they named just before ("do it", "write it").'),
  wants_action: z.boolean().describe('The person wants something done rather than an answer to a question.'),
  changes_existing_record: z.boolean().describe('The person wants a record that already exists changed (on this page or elsewhere), not a new one.'),
  wants_to_choose: z.boolean().describe('The person wants to be handed a choice or options to decide themselves ("which one", "let me decide").'),
  wants_work_on_record: z.boolean().describe('The person wants work done on the record on the page — mockups, images, a design, attachments.'),
  changed_record_type: z.string().max(60).nullable().describe('When they want an existing record changed, its type as one lower-case slug (e.g. request); null otherwise.'),
  record_type: z.string().max(60).nullable().describe('When they want a record filed, its type as one lower-case slug from the types named below (e.g. request, bug); null otherwise.'),
  summary: z.string().max(200).describe('What they want, in one short line.'),
});
export type TurnIntent = z.infer<typeof TurnIntentSchema>;

export const NO_INTENT: TurnIntent = { changes_page_record: false, files_new_record: false, decides: false, wants_action: false, changes_existing_record: false, wants_to_choose: false, wants_work_on_record: false, changed_record_type: null, record_type: null, summary: '' };

export const AnswerJudgementSchema = z.object({
  answered: z.boolean().describe('The reply gives the person an actual answer or result — not only a promise, a fragment or nothing.'),
  ends_on_promise: z.boolean().describe('The reply ends by saying it will do or look at something it has not done yet in this turn.'),
  promise: z.string().max(300).nullable().describe('That closing promise, quoted exactly; null when there is none.'),
  claims_unrecorded_work: z.boolean().describe('The reply says something was filed, changed, withdrawn, sent, dispatched or put up as a card that the list of steps does not show as done. A step the reply itself says is waiting, queued or pending is not such a claim.'),
  claim: z.string().max(300).nullable().describe('That claim, quoted exactly; null when there is none.'),
  wrote_call_as_text: z.string().max(80).nullable().describe('The name of a tool the reply wrote out as text (its name, or a block of its arguments) instead of calling; null when none.'),
  cut_off: z.boolean().describe('The reply stops mid-sentence or mid-thought.'),
  hides_failure: z.boolean().describe('A step listed as failed is one the reply does not tell the person about.'),
});
export type AnswerJudgement = z.infer<typeof AnswerJudgementSchema>;

export const NO_JUDGEMENT: AnswerJudgement = { answered: true, ends_on_promise: false, promise: null, claims_unrecorded_work: false, claim: null, wrote_call_as_text: null, cut_off: false, hides_failure: false };

type Model = Pick<BaseChatModel, 'bindTools'>;

async function ask<T>(model: Model, schema: z.ZodType<T>, name: string, description: string, system: string, human: string): Promise<T | null> {
  const { tool } = await import('@langchain/core/tools');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const report = tool(async () => 'recorded', { name, description, schema: schema as never });
  const bound = model.bindTools!([report], { tool_choice: name } as never);
  const res = await bound.invoke([new SystemMessage(system), new HumanMessage(human)]) as { tool_calls?: Array<{ name: string; args: unknown }> };
  const call = (res.tool_calls ?? []).find(c => c.name === name);
  const parsed = call ? schema.safeParse(call.args) : null;
  return parsed?.success ? parsed.data : null;
}

async function classifier(orgId: string): Promise<Model> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  return buildChatModelForOrg('classifier', orgId, { temperature: 0, streaming: false, maxTokens: 500 }) as Promise<Model>;
}

/**
 * What the person wants from this turn.
 * @param input - The turn.
 * @param input.orgId - The workspace.
 * @param input.message - The person's message.
 * @param input.previous - The exchange just before it, when there is one.
 * @param input.previous.person - What the person said last.
 * @param input.previous.agent - What the agent answered.
 * @param input.page - The record the person is on, as they know it ("request #201"), when there is one.
 * @param input.waiting - What is waiting on them here, one line each.
 * @param input.recordTypes - The record types the agent can file, for `record_type`.
 * @param model - Injected in tests.
 */
export async function readIntent(input: { orgId: string; message: string; previous?: { person?: string; agent?: string }; page?: string | null; waiting?: string; recordTypes?: string[] }, model?: Model): Promise<TurnIntent> {
  try {
    const out = await ask(model ?? await classifier(input.orgId), TurnIntentSchema, 'report_intent', 'Report what the person wants from this turn.', 'You read one message a person sent to an agent in a work app and report, as typed fields, what they want. Judge the meaning, not the wording. Answer only through the tool.', [
      input.page ? `The person is on the page of ${input.page}.` : 'The person is not on a record\'s page.',
      input.waiting ? `Waiting on them here:\n${input.waiting}` : '',
      input.recordTypes && input.recordTypes.length > 0 ? `Record types this agent can file: ${input.recordTypes.join(', ')}` : '',
      input.previous?.person ? `They said just before: ${input.previous.person.slice(0, 1_500)}` : '',
      input.previous?.agent ? `The agent answered: ${input.previous.agent.slice(-1_500)}` : '',
      `Their message now: ${input.message.slice(0, 4_000)}`,
    ].filter(Boolean).join('\n\n'));
    return out ?? NO_INTENT;
  } catch (err) {
    console.warn('turn judge: intent read failed', { orgId: input.orgId, message: (err as Error).message });
    return NO_INTENT;
  }
}

/**
 * How a pass of the turn ended.
 * @param input - The pass.
 * @param input.orgId - The workspace.
 * @param input.message - The person's message.
 * @param input.reply - What the agent has written so far.
 * @param input.steps - What the turn did, one line per tool call with its outcome.
 * @param input.cards - How many cards were put up.
 * @param input.failed - Steps that failed (a hand-off that did not complete), one line each.
 * @param model - Injected in tests.
 */
export async function judgeAnswer(input: { orgId: string; message: string; reply: string; steps: string[]; cards: number; failed?: string[] }, model?: Model): Promise<AnswerJudgement> {
  try {
    const out = await ask(model ?? await classifier(input.orgId), AnswerJudgementSchema, 'report_reply', 'Report how the agent\'s reply ends and whether it matches what was done.', 'You check an agent\'s reply against the steps it actually took in this turn, and report as typed fields. Judge the meaning, not the wording. Quote the reply exactly where a field asks for a quote. Answer only through the tool.', [
      `The person said: ${input.message.slice(0, 2_000)}`,
      `Steps taken this turn (tool, outcome):\n${input.steps.length > 0 ? input.steps.slice(-30).join('\n') : '(none)'}`,
      `Cards put up for the person: ${input.cards}`,
      `Steps that failed: ${input.failed && input.failed.length > 0 ? input.failed.join('; ') : '(none)'}`,
      `The reply so far:\n${input.reply.slice(-6_000) || '(empty)'}`,
    ].join('\n\n'));
    return out ?? NO_JUDGEMENT;
  } catch (err) {
    console.warn('turn judge: reply judgement failed', { orgId: input.orgId, message: (err as Error).message });
    return NO_JUDGEMENT;
  }
}

/**
 * One line per step for the judge: the tool and what it answered. Whether a
 * step landed is the judge's reading of that answer, not a string check.
 * @param calls - The turn's tool calls.
 */
export function stepLines(calls: ReadonlyArray<{ tool: string; output?: string }>): string[] {
  return calls.map(c => `${c.tool} → ${(c.output ?? '(no output)').replace(/\s+/g, ' ').slice(0, 200)}`);
}

export const SaidToDecideSchema = z.object({
  said: z.boolean().describe('The person\'s own words (the latest message, or the one before it when the latest only confirms it) tell the agent to take exactly this decision.'),
  quote: z.string().max(300).nullable().describe('Their words that say it, quoted exactly; null when they did not.'),
});

/**
 * THE AUTHORIZATION A DECISION TAKEN FOR A PERSON NEEDS: did they say to do
 * exactly this? A decide tool acts on a person's behalf only when a model
 * reading their own words says yes — never on a word match, and never on the
 * agent's own reading of the thread. False on any failure.
 * @param input - The decision and the person's words.
 * @param input.orgId - The workspace.
 * @param input.messages - The person's recent messages, newest first (the latest, then the one before).
 * @param input.decision - The decision, as a sentence ("approve proposal #5201: Build vanity links").
 * @param model - Injected in tests.
 */
export async function saidToDecide(input: { orgId: string; messages: string[]; decision: string }, model?: Model): Promise<{ said: boolean; quote: string | null }> {
  if (input.messages.length === 0) {
    return { said: false, quote: null };
  }
  try {
    const out = await ask(model ?? await classifier(input.orgId), SaidToDecideSchema, 'report_consent', 'Report whether the person said to take this decision.', 'An agent is about to take a decision on a person\'s behalf. You decide from the person\'s own words only whether they told it to take exactly this decision. A question about it, a maybe, a different decision, or a decision about something else is not consent. Answer only through the tool.', [
      `The decision: ${input.decision}`,
      `The person, latest message: ${input.messages[0]!.slice(0, 2_000)}`,
      input.messages[1] ? `The person, message before: ${input.messages[1].slice(0, 2_000)}` : '',
    ].filter(Boolean).join('\n\n'));
    return out ?? { said: false, quote: null };
  } catch (err) {
    console.warn('turn judge: consent read failed', { orgId: input.orgId, message: (err as Error).message });
    return { said: false, quote: null };
  }
}

export const AskedSchema = z.object({
  asked: z.enum(['work', 'answer', 'hold']).describe('What the person asked for, from their own words: work — they tell the agent or the team to build, change or fix something, now; answer — they ask a question and want it answered: how something works, why, what was built, how to use or test it, or what they themselves need to do — not work started, even when the answer may later lead to work; hold — written down, but not started yet.'),
  quote: z.string().max(300).nullable().describe('Their words that say it, quoted exactly; null when there are none.'),
});
export type Asked = z.infer<typeof AskedSchema>;

/**
 * A QUESTION NEVER STARTS A BUILD (2026-10-01, CHAT-423: "how does FE-308 work
 * without manually registering an app with OpenAI?" was filed as a request,
 * and intake started a plan, a task and a run for it, because the only thing
 * it asked of the person's words was whether they said "hold"). What the
 * person asked for — work, an answer, or work held — is read by a model from
 * their own words, typed, and code routes on it. Null when the read fails or
 * there are no words, so a caller keeps its own default.
 * @param input - The person's words and what was filed.
 * @param input.orgId - The workspace.
 * @param input.messages - The person's recent messages, newest first.
 * @param input.filed - What was filed from them, as a person reads it ("request FE-324: Explain how …").
 * @param model - Injected in tests.
 */
export async function readAsked(input: { orgId: string; messages: string[]; filed?: string }, model?: Model): Promise<Asked | null> {
  if (input.messages.length === 0) {
    return null;
  }
  try {
    return await ask(model ?? await classifier(input.orgId), AskedSchema, 'report_asked', 'Report what the person asked for.', 'You read what a person said to an agent in a work app and report, as typed fields, whether they asked for work, for an answer, or for work to be written down and held. Judge the meaning, not the wording: a question is a request for an answer unless they also tell someone to build, change or fix something. Asking what they should do, or how to build, use or test something themselves, is a question. Answer only through the tool.', [
      input.filed ? `What the agent filed from it: ${input.filed.slice(0, 400)}` : '',
      `The person, latest message: ${input.messages[0]!.slice(0, 2_000)}`,
      input.messages[1] ? `The person, message before: ${input.messages[1].slice(0, 2_000)}` : '',
    ].filter(Boolean).join('\n\n'));
  } catch (err) {
    console.warn('turn judge: asked read failed', { orgId: input.orgId, message: (err as Error).message });
    return null;
  }
}
