/**
 * WHAT THE PERSON MEANT — read by a model, never by matching words (Chris,
 * 2026-09-29: "we should be using LLM to determine or route based on intent.
 * NEVER HARD CODE WORD MATCHES … ANYWHERE.").
 *
 * Two readings, each one call to a small model bound to one tool whose
 * schema is the typed answer:
 *
 *   - `readIntent` — once, before the turn runs: answer, change, file,
 *     decide or work. An answer turn is read-only (`turnScope.ts`).
 *   - `saidToDecide` — before a decide tool acts on one item for a person:
 *     did their own words say to take exactly that decision?
 *
 * A reader that fails returns "no signal", so the turn is never held up by
 * its own judge, and a failed intent read never makes a turn read-only.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';

export const TURN_ASKS = ['answer', 'change', 'file', 'decide', 'work'] as const;

export const TurnIntentSchema = z.object({
  asks: z.enum(TURN_ASKS).describe([
    'What the person wants from this turn, as ONE of:',
    'answer — to know or understand something: a question, an explanation, a status, how something works, how it would be done, what it would take, why it is so. Asking how a change would be made is still a question. This is the default when they ask rather than tell.',
    'change — an existing record changed (its fields, scope, acceptance, story, title), however they phrase it ("expand the scope", "add X to it").',
    'file — a new or separate record filed, or new work started that does not exist yet. A request phrased politely as a question ("can we add dark mode?") is a filing.',
    'decide — something waiting on them decided: approve, reject, dismiss, build, merge, defer, stop, cancel, send back; or this message confirms one named just before ("do it").',
    'work — some other act done on the record or for them: a mockup, a document, an image, a run, a send.',
  ].join(' ')),
  changed_record_type: z.string().max(60).nullable().describe('With change: the type of the record they want changed, as one lower-case slug (e.g. request); null otherwise.'),
  record_type: z.string().max(60).nullable().describe('With file: its type as one lower-case slug from the types named below (e.g. request, bug); null otherwise.'),
  summary: z.string().max(200).describe('What they want, in one short line.'),
});
export type TurnIntent = z.infer<typeof TurnIntentSchema>;

/**
 * No reading (the read failed, or there is no person's turn). `unread` keeps
 * a failed read from making a turn read-only: a judge that cannot read never
 * stops the person who asked.
 */
export const NO_INTENT: TurnIntent & { unread: true } = { asks: 'answer', changed_record_type: null, record_type: null, summary: '', unread: true };

/**
 * The person asked for an act, not an answer.
 * @param intent - The turn's reading.
 */
export function asksForAct(intent: Pick<TurnIntent, 'asks'>): boolean {
  return intent.asks !== 'answer';
}

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
export async function readIntent(input: { orgId: string; message: string; previous?: { person?: string; agent?: string }; page?: string | null; waiting?: string; recordTypes?: string[] }, model?: Model): Promise<TurnIntent & { unread?: true }> {
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

export const SaidToDecideSchema = z.object({
  said: z.boolean().describe('The person\'s own words (the latest message, or the one before it when the latest only confirms it) tell the agent to take exactly this decision — this action, on this target. Words about the same work that ask for a different action are not consent to this one.'),
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
    const out = await ask(model ?? await classifier(input.orgId), SaidToDecideSchema, 'report_consent', 'Report whether the person said to take this decision.', 'An agent is about to take a decision on a person\'s behalf. You decide from the person\'s own words only whether they told it to take exactly this decision: this action, on this target, with this effect. A question about it, a maybe, a different decision, or a decision about something else is not consent. Consent to one action is never consent to another on the same work: a person who asked to defer, close, file or change a record has not asked for a revert, a merge, a deploy, a delete or any other change to production unless they named that action themselves. Answer only through the tool.', [
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
