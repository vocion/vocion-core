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
 * The reading of a turn that answers an open Decision. The answer is a typed
 * record, so the turn is not read again: the person decided, and the asking
 * agent acts on it — never read-only.
 * @param summary - The answer, in a line.
 */
export function answeredIntent(summary: string): TurnIntent {
  return { asks: 'decide', changed_record_type: null, record_type: null, summary: summary.slice(0, 200) };
}

/**
 * The person asked for an act, not an answer.
 * @param intent - The turn's reading.
 */
export function asksForAct(intent: Pick<TurnIntent, 'asks'>): boolean {
  return intent.asks !== 'answer';
}

type Model = Pick<BaseChatModel, 'bindTools'>;

async function ask<T>(orgId: string, model: Model, schema: z.ZodType<T>, name: string, description: string, system: string, human: string): Promise<T | null> {
  const { tool } = await import('@langchain/core/tools');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const report = tool(async () => 'recorded', { name, description, schema: schema as never });
  const bound = model.bindTools!([report], { tool_choice: name } as never);
  const res = await bound.invoke([new SystemMessage(system), new HumanMessage(human)]) as { tool_calls?: Array<{ name: string; args: unknown }> };
  const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
  await chargeModelCall({ orgId, feature: 'chat.judge', role: 'classifier', response: res });
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
    const out = await ask(input.orgId, model ?? await classifier(input.orgId), TurnIntentSchema, 'report_intent', 'Report what the person wants from this turn.', 'You read one message a person sent to an agent in a work app and report, as typed fields, what they want. Judge the meaning, not the wording. Answer only through the tool.', [
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
 * What the consent judge is told. Exported for tests that hold a recorded
 * reply against the prompt it answered.
 */
export const SAID_TO_DECIDE_SYSTEM = [
  'An agent is about to take a decision on a person\'s behalf. You decide from the person\'s own words only whether they told it to take exactly this decision: this action, on this target, with this effect.',
  'A question about it, a maybe, a different decision, or a decision about something else is not consent. Consent to one action is never consent to another on the same work: a person who asked to defer, close, file or change a record has not asked for a revert, a merge, a deploy, a delete or any other change to production unless they named that action themselves.',
  'A decision that only reads, changing nothing, is consented to when the person asked for the work it reads for or the answer it finds: someone who asks what a list or a site shows, or asks for work on everyone a list names, has asked for that list to be read. A decision that changes something needs the person to have asked for that change.',
  'A run of a saved automation is the work its purpose describes, with the changes it is approved to make as part of that work: a person who asks for that work for a set of people or items ("check the licenses for everyone who is ready") has asked for the automation to run for those rows, and the rows the agent found for their words are theirs.',
  'The agent\'s last message is shown when there is one. It is the agent\'s words, never the person\'s, and never consent by itself. When it offered or asked to do something and the person\'s latest message plainly accepts that offer ("yes", "go ahead", "do it"), the person has consented to what was offered, and only that: it counts for this decision only when the offer was this same decision — the same work, the same target, and an effect no larger (an offer to read is not consent to change anything; an offer to run one automation is not consent to run another). A "yes" or "thanks" that answers something else, or a reply that does not plainly accept, is not consent. When no agent message is shown, a reply that only says yes, ok or go accepts nothing: nothing is shown for it to accept.',
  'When a workflow step\'s declared work is shown, the person started that workflow run, and starting it is their word for the work the step declares and nothing beyond it: a decision that does that declared work (the same site, an effect no larger) is consented to; one that goes beyond it (another site, a change where the step declares a read) is not.',
  'Answer only through the tool.',
].join(' ');

export const SaidToDecideSchema = z.object({
  // The offer, read before the verdict on it: what it offered, and whether that is this decision.
  offered: z.string().nullable().optional().describe('What the agent\'s last message offered or asked to do, in a few words of your own (which work, on what); null when no agent message is shown or it offered nothing.'),
  offer_is_this_decision: z.boolean().optional().describe('The offer is this same decision: the same work (the same automation or action, not another one), on the same target, with an effect no larger (an offer to read is not this decision when this decision changes something). False when there is no offer.'),
  // How they said it, typed, so code can hold a "yes" to an offer that was never shown or was something else (2026-11-06).
  said_how: z.enum(['own_words', 'accepted_offer', 'declared_work', 'not_said']).optional().describe('own_words — their own words name this work (what to do, and on what), in the latest message or the one before it that the latest confirms; a bare "yes", "ok" or "go" names nothing. accepted_offer — the latest message plainly accepts the agent\'s last message, shown above, which offered exactly this decision. declared_work — the workflow step\'s declared work, shown above, is this decision. not_said — none of these.'),
  said: z.boolean().describe('The person\'s own words (the latest message, or the one before it when the latest only confirms it, or the latest accepting the agent\'s offer when that offer is exactly this decision) tell the agent to take exactly this decision — this action, on this target, with this effect. Words about the same work that ask for a different action are not consent to this one.'),
  // No length cap in the schema: a long request is quoted whole, and a cap here failed the parse
  // and read as no consent (2026-10-21, a 400-character "use the browser to …"). Cut after.
  quote: z.string().nullable().describe('Their words that say it, quoted exactly (the sentence that says it, not the whole message); null when they did not.'),
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
 * @param input.page - The record the person is on, so "build this" reads as that record (2026-10-02: "Plan this again and build it" on FE-224 read as no consent without it).
 * @param input.declared - The work a workflow run's current step declares, when a person started the run: starting it is their word for that work, and nothing beyond it.
 * @param input.offer - The agent's last message before the person's latest, marked as the agent's words: a reply that plainly accepts an offer of exactly this decision ("Shall I check these 12 licenses?" — "yes, go") is consent to it, and to nothing else.
 * @param model - Injected in tests.
 */
export async function saidToDecide(input: { orgId: string; messages: string[]; decision: string; page?: string | null; offer?: string | null; declared?: string | null }, model?: Model): Promise<{ said: boolean; quote: string | null }> {
  if (input.messages.length === 0 && !input.declared?.trim()) {
    return { said: false, quote: null };
  }
  try {
    const out = await ask(input.orgId, model ?? await classifier(input.orgId), SaidToDecideSchema, 'report_consent', 'Report whether the person said to take this decision.', SAID_TO_DECIDE_SYSTEM, [
      input.page ? `The person is on the page of ${input.page}; "this" or "it" in their words means that record.` : '',
      `The decision: ${input.decision}`,
      input.offer?.trim() ? `The agent's last message, just before the person's latest (the agent's words, not the person's):\n${input.offer.trim().slice(-1_500)}` : '',
      input.declared?.trim() ? `The person started a workflow run. The step running now declares this work, and starting the run is the person's word for it and nothing beyond it:\n${input.declared.trim().slice(0, 2_000)}` : '',
      input.messages[0] ? `The person, latest message: ${input.messages[0].slice(0, 2_000)}` : '',
      input.messages[1] ? `The person, message before: ${input.messages[1].slice(0, 2_000)}` : '',
    ].filter(Boolean).join('\n\n'));
    // An acceptance needs an offer to accept: with none shown, a "yes" is consent to nothing.
    const said = Boolean(out?.said) && out?.said_how !== 'not_said' && !(out?.said_how === 'accepted_offer' && (!input.offer?.trim() || out.offer_is_this_decision === false))
      && !(out?.said_how === 'declared_work' && !input.declared?.trim());
    return out && said ? { said: true, quote: out.quote ? out.quote.slice(0, 300) : null } : { said: false, quote: null };
  } catch (err) {
    console.warn('turn judge: consent read failed', { orgId: input.orgId, message: (err as Error).message });
    return { said: false, quote: null };
  }
}

/** What the automation match read is told. Exported for tests that hold a recorded reply against it. */
export const AUTOMATION_MATCH_SYSTEM = 'An agent is about to hand a task to a web browser. The workspace has saved automations: work a specialist taught once, approved, that runs one row at a time with its own rules. You decide whether the browser task is the work one of them already does — the same purpose, on the same site, with the same kind of change — so the agent should run that automation instead. Judge the meaning, not shared words. A task that only reads a list or a page to find out who or what to work on is not an automation\'s work, even on the same site. Answer only through the tool.';

export const AutomationMatchSchema = z.object({
  same_work_as: z.number().int().nullable().describe('The id, from the list, of the saved automation whose own work this browser task is: the same purpose on the same site, so running that automation for the task\'s rows would do it. Null when none is: a task that only reads a list or a page to find out what to do, or rows to run an automation for, is not that automation\'s work.'),
});

/** A saved automation, as the match read is told it. */
export type AutomationForMatch = { id: number; name: string; purpose: string; sites: string[]; changes: string };

/**
 * IS THIS BROWSER TASK A SAVED AUTOMATION'S WORK? Before an agent starts a
 * browser task, a model reads it against the automations the workspace has
 * approved; when one already does it, the agent is told to run that one
 * (its expert's rules, trust and read-back receipts) instead of improvising
 * the same work in a browser. Null on no match and on any failure, so the
 * read never stops a task.
 * @param input - The task and the automations.
 * @param input.orgId - The workspace.
 * @param input.task - The task, as the agent briefed it.
 * @param input.startUrl - Where it starts, when given.
 * @param input.automations - The approved automations.
 * @param model - Injected in tests.
 */
export async function readAutomationMatch(input: { orgId: string; task: string; startUrl?: string | null; automations: readonly AutomationForMatch[] }, model?: Model): Promise<number | null> {
  if (input.automations.length === 0) {
    return null;
  }
  try {
    const out = await ask(input.orgId, model ?? await classifier(input.orgId), AutomationMatchSchema, 'report_automation_match', 'Report which saved automation, if any, does this browser task\'s work.', AUTOMATION_MATCH_SYSTEM, [
      `Saved automations:\n${input.automations.map(a => `- [id ${a.id}] "${a.name}": ${a.purpose.replace(/\s+/g, ' ').slice(0, 300)}${a.sites.length > 0 ? ` Sites: ${a.sites.join(', ')}.` : ''}${a.changes ? ` Changes: ${a.changes.slice(0, 300)}` : ''}`).join('\n')}`,
      `The browser task: ${input.task.slice(0, 2_000)}${input.startUrl ? `\nIt starts at: ${input.startUrl.slice(0, 300)}` : ''}`,
    ].join('\n\n'));
    const id = out?.same_work_as ?? null;
    return id !== null && input.automations.some(a => a.id === id) ? id : null;
  } catch (err) {
    console.warn('turn judge: automation match read failed', { orgId: input.orgId, message: (err as Error).message });
    return null;
  }
}

/**
 * ANSWERS FIRST. While a Decision is open in a conversation, the person's
 * next message is read against it before it is routed or intent-read: did
 * they answer it — by number, by label, by meaning — in their own words, or
 * is this a new topic? A model returns the typed field; code routes on it
 * (`decisionAnswerFromReading`).
 */
export const DecisionAnswerReadSchema = z.object({
  answers_open_decision: z.object({
    kind: z.enum(['option', 'free_text', 'none']).describe([
      'option — the message picks one or more of the listed options, by number ("2", "the second"), by label, or by meaning ("go with the API repo").',
      'free_text — the message answers the question in their own words but is not one of the options: a different value, a condition, "neither, use X".',
      'none — the message is not an answer: a new topic, a different request, or a question ABOUT the decision rather than an answer to it.',
    ].join(' ')),
    option_ids: z.array(z.string().max(80)).max(8).describe('With option: the ids of every option the message picks, in the order said. Empty otherwise.'),
    free_text: z.string().max(2_000).nullable().describe('With free_text: their answer, in their words. Null otherwise.'),
  }),
});
export type DecisionAnswerReading = z.infer<typeof DecisionAnswerReadSchema>['answers_open_decision'];

/** No reading: the message is routed as it would have been, and the Decision stays docked. */
export const NO_DECISION_ANSWER: DecisionAnswerReading = { kind: 'none', option_ids: [], free_text: null };

/**
 * Does this message answer the open Decision? Fails to "none", so a judge
 * that cannot read never holds up the turn — the message routes as usual and
 * the Decision stays where it is.
 * @param input - The message and the Decision.
 * @param input.orgId - The workspace.
 * @param input.message - What the person typed.
 * @param input.decision - The open Decision.
 * @param input.decision.question - Its question.
 * @param input.decision.options - Its options, in the order the card numbers them.
 * @param input.decision.allowOther - Whether a free-text answer is accepted.
 * @param input.decision.multiple - Whether several options may be chosen.
 * @param model - Injected in tests.
 */
export async function readDecisionAnswer(input: { orgId: string; message: string; decision: { question: string; options: ReadonlyArray<{ id: string; label: string; consequence?: string }>; allowOther: boolean; multiple: boolean } }, model?: Model): Promise<DecisionAnswerReading> {
  try {
    const d = input.decision;
    const out = await ask(input.orgId, model ?? await classifier(input.orgId), DecisionAnswerReadSchema, 'report_decision_answer', 'Report whether the message answers the open decision.', 'An agent asked a person one question in a work app, shown as a card with numbered options. You read the person\'s next message and report, as typed fields, whether it answers that question. Judge the meaning, not the wording. Answer only through the tool.', [
      `Open decision: ${d.question}`,
      d.options.length > 0 ? `Options, numbered as the card shows them:\n${d.options.map((o, i) => `${i + 1}. [id ${o.id}] ${o.label}${o.consequence ? ` — ${o.consequence}` : ''}`).join('\n')}` : 'It has no options: it is answered in words.',
      d.multiple ? 'Several options may be chosen together.' : 'Exactly one option may be chosen.',
      d.allowOther ? 'An answer in their own words is accepted.' : 'Only the options are accepted.',
      `Their message now: ${input.message.slice(0, 4_000)}`,
    ].join('\n\n'));
    return out?.answers_open_decision ?? NO_DECISION_ANSWER;
  } catch (err) {
    console.warn('turn judge: decision answer read failed', { orgId: input.orgId, message: (err as Error).message });
    return NO_DECISION_ANSWER;
  }
}

/**
 * The answer code routes on, from the model's reading — or null when the
 * message is not an answer this Decision can take, and routes as usual.
 *
 * Options the Decision does not have are dropped. Two options on a Decision
 * that takes one ("1 and 3") is not a choice the card could make: it is the
 * person's words, so it goes to the asking agent as a free-text answer where
 * free text is accepted, and routes as usual where it is not.
 * @param decision - The open Decision.
 * @param decision.options - Its options.
 * @param decision.allowOther - Whether a free-text answer is accepted.
 * @param decision.multiple - Whether several options may be chosen.
 * @param reading - What the judge read.
 * @param message - What the person typed.
 */
export function decisionAnswerFromReading(decision: { options: ReadonlyArray<{ id: string }>; allowOther: boolean; multiple: boolean }, reading: DecisionAnswerReading, message: string): import('@/libs/decisions/decision').DecisionAnswer | null {
  const words = message.trim();
  const asText = (text: string) => (decision.allowOther && text.trim() ? { kind: 'free_text' as const, text: text.trim() } : null);
  if (reading.kind === 'none') {
    return null;
  }
  if (reading.kind === 'free_text') {
    return asText(reading.free_text?.trim() || words);
  }
  const known = [...new Set(reading.option_ids)].filter(id => decision.options.some(o => o.id === id));
  if (known.length === 0) {
    return asText(words);
  }
  if (known.length > 1 && !decision.multiple) {
    return asText(words);
  }
  return { kind: 'option', optionIds: known };
}

export const UnableClaimSchema = z.object({
  claims_unable: z.boolean().describe('The agent\'s reply tells the person it cannot, is unable to or has no way to do the act they asked for (update, send, publish, file, run, execute it), or tells them to do it themselves, instead of doing it.'),
  action_id: z.string().max(120).nullable().describe('With claims_unable: the id, from the list, of the action that does what they asked; null when none on the list does.'),
});
export type UnableClaim = z.infer<typeof UnableClaimSchema>;

/**
 * CAN BEFORE CAN'T (2026-10-28, a HubSpot deal update: "I can't execute the
 * CRM update directly in this session", then done at once when the person said
 * "yes you can"). Did the reply say it cannot do what was asked, and which of
 * the turn's actions does it? A model reads the reply against the catalog;
 * code routes on the typed fields (`services/agents/canDo.ts`). Never claims
 * on a failure.
 * @param input - The turn.
 * @param input.orgId - The workspace.
 * @param input.message - What the person asked.
 * @param input.reply - What the agent answered.
 * @param input.actions - The turn's action catalog, one line each (`id — what it does`).
 * @param model - Injected in tests.
 */
export async function readUnableClaim(input: { orgId: string; message: string; reply: string; actions: ReadonlyArray<{ id: string; line: string }> }, model?: Model): Promise<UnableClaim> {
  const none: UnableClaim = { claims_unable: false, action_id: null };
  if (!input.reply.trim() || input.actions.length === 0) {
    return none;
  }
  try {
    const out = await ask(input.orgId, model ?? await classifier(input.orgId), UnableClaimSchema, 'report_unable', 'Report whether the agent said it cannot do what was asked, and which action does it.', 'An agent in a work app answered a person. You report, as typed fields, whether its reply says it cannot do the act the person asked for, and which action from the list does that act. Judge the meaning, not the wording. A reply that did the act, started it, is waiting on the person to start, approve or decide something, or explains a real failure of a step it ran, is not a claim that it cannot. Name an action only when it does that very act for that kind of thing; an action that merely shares a word with the request (enrolling a sales lead in an email sequence is not enrolling a clinician with a health plan) is not it, and with none, action_id is null. Answer only through the tool.', [
      `Actions the agent has:\n${input.actions.map(a => `${a.id} — ${a.line}`).join('\n').slice(0, 8_000)}`,
      `The person asked: ${input.message.slice(0, 2_000)}`,
      `The agent answered: ${input.reply.slice(-3_000)}`,
    ].join('\n\n'));
    if (!out) {
      return none;
    }
    const known = out.action_id && input.actions.some(a => a.id === out.action_id) ? out.action_id : null;
    return { claims_unable: out.claims_unable, action_id: known };
  } catch (err) {
    console.warn('turn judge: unable-claim read failed', { orgId: input.orgId, message: (err as Error).message });
    return none;
  }
}
