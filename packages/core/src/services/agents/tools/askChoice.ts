import type { RuntimeContext } from '../types';
import type { Card, ChoiceOption } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getAction } from '@/libs/actions/registry';
import { CHOICE_OPTION_IDS, newCardId } from '@/libs/cards/card';
import { latestTurnIn } from '@/libs/streams/buffer';

const askChoiceInput = z.object({
  question: z.string().min(3).max(160),
  hint: z.string().max(200).optional(),
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    description: z.string().max(200).optional(),
    action: z.object({ actionId: z.string().min(1), input: z.record(z.string(), z.unknown()) }).optional(),
  })).min(2).max(4),
  allowOther: z.boolean().default(true),
});
type AskChoiceInput = z.infer<typeof askChoiceInput>;

/** A question asked longer ago than this belongs to a turn that is over, even when no newer turn is on record. */
const ASKED_EXPIRES_MS = 30 * 60_000;

type AskedRecord = { question: string; turnNumber: number | null; at: number };

/**
 * The first question each conversation asked in its current turn, keyed by
 * `${orgId}:${conversationId}`. It lives here, not on the runtime context:
 * an agent that runs on AgentCore builds a fresh context for every tool call
 * (`toolEndpoint`), so anything hung on one resets between two calls in the
 * same turn. Tool calls from AgentCore come back to this box, so one map sees
 * both ways of running.
 */
const askedThisTurn = new Map<string, AskedRecord>();

/**
 * Forget questions that are too old to matter, so the map cannot grow forever.
 * @param now - Epoch ms.
 */
function sweepExpired(now: number): void {
  for (const [key, record] of askedThisTurn) {
    if (now - record.at > ASKED_EXPIRES_MS) {
      askedThisTurn.delete(key);
    }
  }
}

/**
 * The question already asked in this turn, or undefined. A new turn is the
 * newest turn number in the stream buffer moving past the one recorded
 * (the person sent another message), or the record expiring.
 * @param key - `${orgId}:${conversationId}`.
 * @param turnNumber - The conversation's newest turn now.
 * @param now - Epoch ms.
 * @returns The first question's text.
 */
function questionAskedThisTurn(key: string, turnNumber: number | null, now: number): string | undefined {
  const record = askedThisTurn.get(key);
  if (!record || record.turnNumber !== turnNumber || now - record.at > ASKED_EXPIRES_MS) {
    return undefined;
  }
  return record.question;
}

/**
 * Check every action bound to an option now, while the agent can still fix it.
 * @param ctx - The turn's runtime context.
 * @param options - The options as the agent wrote them.
 * @returns A refusal sentence naming the option, or null when all are sound.
 */
async function boundActionProblem(ctx: RuntimeContext, options: AskChoiceInput['options']): Promise<string | null> {
  for (const [index, option] of options.entries()) {
    if (!option.action) {
      continue;
    }
    const letter = CHOICE_OPTION_IDS[index];
    const action = getAction(option.action.actionId);
    if (!action) {
      return `Option ${letter} can't be offered: there is no action "${option.action.actionId}".`;
    }
    const parsed = action.inputSchema.safeParse(option.action.input);
    if (!parsed.success) {
      const why = parsed.error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
      return `Option ${letter} can't be offered: ${action.id} rejects the input (${why}).`;
    }
    // Picking the option is the person's own approval, so the check runs as them.
    const refusal = await action.precheck?.({ orgId: ctx.orgId, invokedBy: ctx.userId, proposedBy: ctx.userId }, parsed.data);
    if (refusal) {
      return `Option ${letter} can't be offered: ${refusal}`;
    }
  }
  return null;
}

/**
 * Letter the options and attach each bound action as the card's own list.
 * @param options - The validated options.
 * @returns Card options A to D, in order.
 */
function lettered(options: AskChoiceInput['options']): ChoiceOption[] {
  return options.map((option, index) => ({
    id: CHOICE_OPTION_IDS[index]!,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
    ...(option.action ? { actions: [option.action] } : {}),
  }));
}

/**
 * Put one question in chat as a choice card, once per turn.
 * @param ctx - The turn's runtime context.
 * @param input - The question, its options and whether typing is allowed.
 * @returns The text the model reads.
 */
async function askChoice(ctx: RuntimeContext, input: AskChoiceInput): Promise<string> {
  if (ctx.conversationId === undefined) {
    return 'Refused: ask_choice is for chat. There is no conversation to ask in; put the question in your answer instead.';
  }
  const key = `${ctx.orgId}:${ctx.conversationId}`;
  const now = Date.now();
  sweepExpired(now);
  const turnNumber = latestTurnIn(ctx.orgId, ctx.conversationId);
  const first = questionAskedThisTurn(key, turnNumber, now);
  if (first !== undefined) {
    return `You already asked "${first}" this turn. Stop and wait for the answer; ask the next question after it.`;
  }
  const problem = await boundActionProblem(ctx, input.options);
  if (problem) {
    return problem;
  }
  const card: Card = {
    id: newCardId(),
    kind: 'choice',
    title: input.question,
    ...(input.hint ? { body: input.hint } : {}),
    options: lettered(input.options),
    allowOther: input.allowOther,
    actions: [],
    state: 'proposed',
    source: { agentSlug: ctx.agentSlug, tool: 'ask_choice' },
  };
  askedThisTurn.set(key, { question: input.question, turnNumber, at: now });
  ctx.emit({ type: 'card', card });
  return 'Asked. Stop here: the person\'s answer arrives as their next message, as Answered "<question>": <answer>.';
}

/**
 * `ask_choice` (#1028): one setup question per turn, as a card of two to four
 * lettered options plus a typed answer.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function askChoiceTool(ctx: RuntimeContext) {
  return tool(
    async (input: AskChoiceInput) => askChoice(ctx, input),
    {
      name: 'ask_choice',
      description: 'Ask the person you\'re talking to one question, as a card with two to four lettered options built from what you already know, plus "Type your own answer". Use it for every setup question. An option can carry an action (actionId + input): picking it is the person\'s approval and runs it. One question per turn; end your turn after asking.',
      schema: askChoiceInput,
    },
  );
}
