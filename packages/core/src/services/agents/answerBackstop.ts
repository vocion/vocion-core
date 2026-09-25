/**
 * THE ANSWER BACKSTOP — a turn that worked and did not answer, answered.
 *
 * The shape, every time: "I'll read the records before answering.", two or
 * three tool calls, and then the turn ends. #644 taught the browser route to
 * store that honestly as `stalled` instead of `complete`, and to tell the
 * person why the spinner stopped. It did not answer the question. On
 * 2026-09-24 the four walk-throughs against production (a bug, a feature
 * bet, a question, an incident) stalled six turns out of eight: nothing
 * filed, nothing decided, a person left to ask again.
 *
 * This is the structural fix, in the repo's order of strength (CLAUDE.md,
 * Structural over prompting*): a gated pass that fires ONLY on the
 * violation. When a turn's finished text is shorter than what an answer is
 * (`stoppedShort`, the same rule the route classifies with) and tool calls
 * ran, one focused model call — no tools bound — is given the person's
 * message, what the turn already found, and the sentence it stopped on, and
 * asked to answer from that. The answer is appended and streamed as a
 * `response_delta`, so the transcript and the stored row say the same thing,
 * and the row stores as `complete` because it now is.
 *
 * Runs in `applyTurnGuarantees`, so it covers every harness target that
 * returns text and tool calls. Best-effort: a backstop that can fail the turn
 * it is rescuing is worse than the stall. When the pass cannot answer either,
 * it says what it could not establish, in one sentence — an honest sentence
 * beats a silent stop, and it still beats a confident guess.
 */
import { stoppedShort } from '@/services/chat/turnStatus';

export type AnswerBackstopToolCall = { tool: string; input?: Record<string, unknown>; output?: string };

/** How much of each tool's output the pass reads, and how much in all. */
const PER_TOOL_CHARS = 2_500;
const TOTAL_CHARS = 14_000;

/** The model call, injectable for tests: system prompt + one human turn in, prose out. */
export type AnswerComposer = (input: { orgId: string; system: string; human: string }) => Promise<string>;

/**
 * Does this finished turn owe an answer? Tool calls ran and the text is
 * shorter than an answer — the same rule the route classifies `stalled` with.
 * @param text - The turn's finished text.
 * @param toolCalls - The turn's tool calls.
 * @param endedOnTool
 */
export function owesAnswer(text: string, toolCalls: ReadonlyArray<AnswerBackstopToolCall>, endedOnTool = false): boolean {
  // A turn whose LAST event was a tool result owes an answer whatever its
  // length: the words it has are the words from before it went looking.
  return (endedOnTool && toolCalls.length > 0) || stoppedShort({ text, toolCalls: toolCalls.length });
}

/**
 * What the turn already found, laid out for the pass — tool by tool, each
 * output capped, the whole capped, newest last.
 * @param toolCalls - The turn's tool calls.
 */
export function evidenceBlock(toolCalls: ReadonlyArray<AnswerBackstopToolCall>): string {
  const lines: string[] = [];
  let used = 0;
  for (const call of toolCalls) {
    const input = call.input && Object.keys(call.input).length > 0 ? ` ${JSON.stringify(call.input).slice(0, 300)}` : '';
    const out = (call.output ?? '').trim();
    const body = out.length > PER_TOOL_CHARS ? `${out.slice(0, PER_TOOL_CHARS)}\n…[${out.length - PER_TOOL_CHARS} more characters]` : out || '(no output recorded)';
    const entry = `### ${call.tool}${input}\n${body}`;
    if (used + entry.length > TOTAL_CHARS) {
      lines.push(`### ${call.tool}${input}\n(output omitted — the pass is over its evidence budget)`);
      continue;
    }
    lines.push(entry);
    used += entry.length;
  }
  return lines.join('\n\n');
}

/**
 * The instruction for the pass. The agent's own prompt first, so the voice
 * and the rules hold; then the one job.
 * @param systemPrompt - The agent's system prompt, when known.
 * @param steps - How many tool steps ran.
 */
export function answerPassSystem(systemPrompt: string | undefined, steps: number): string {
  return `${systemPrompt ?? ''}\n\nYou ran ${steps} tool step${steps === 1 ? '' : 's'} and ended your turn without answering the person; your reply so far is a sentence saying you would look. The results of those steps are below. Answer the person NOW, from those results, in your own voice. Phone-length: the one thing to do first, then at most one screen of why; detail belongs to a follow-up. Do not call tools and do not narrate what you are about to do. If the results do not settle something, say exactly what you could not establish and what would — never guess. If the person asked for something to be filed, decided or recommended and you did not do it, say so plainly and say what you need from them to do it. Speak as yourself: never mention this pass, a "live tool turn", or how your turns work — the person sees one answer from one agent (2026-09-25: a reply said "I cannot file those from the ANSWER PASS").`.trim();
}

/**
 * Append the answer a stalled turn owes.
 * @param input - The finished turn.
 * @param input.orgId
 * @param input.request - The person's message.
 * @param input.finalText - The turn's finished text (the preamble).
 * @param input.toolCalls - The turn's tool calls, with their outputs.
 * @param input.systemPrompt - The agent's system prompt.
 * @param input.compose - The model call (injected in tests).
 * @param input.endedOnTool
 * @returns The text to append, or null when the turn already answered or the pass could not.
 */
export async function runAnswerBackstop(input: {
  orgId: string;
  request: string;
  finalText: string;
  toolCalls: ReadonlyArray<AnswerBackstopToolCall>;
  systemPrompt?: string;
  compose: AnswerComposer;
  endedOnTool?: boolean;
}): Promise<string | null> {
  if (!owesAnswer(input.finalText, input.toolCalls, input.endedOnTool)) {
    return null;
  }
  const human = [
    `The person said:\n${input.request.trim()}`,
    `Your reply so far (do not repeat it):\n${input.finalText.trim() || '(nothing)'}`,
    `What you already did and found:\n\n${evidenceBlock(input.toolCalls)}`,
  ].join('\n\n---\n\n');
  try {
    const answer = (await input.compose({ orgId: input.orgId, system: answerPassSystem(input.systemPrompt, input.toolCalls.length), human })).trim();
    return answer.length > 0 ? answer : null;
  } catch {
    return null;
  }
}

/**
 * The real pass: the org's main model, no tools, one call, bounded.
 * @param root0
 * @param root0.orgId
 * @param root0.system
 * @param root0.human
 */
export const composeAnswerWithModel: AnswerComposer = async ({ orgId, system, human }) => {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const model = await buildChatModelForOrg('main', orgId, { temperature: 0.2, streaming: false, maxTokens: 2_000 });
  const res = await model.invoke([new SystemMessage(system), new HumanMessage(human)], { signal: AbortSignal.timeout(60_000) });
  const content = res.content;
  if (typeof content === 'string') {
    return content;
  }
  return (content as Array<{ type?: string; text?: string }>).map(c => (c.type === 'text' ? c.text ?? '' : '')).join('');
};
