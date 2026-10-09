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

/**
 * The model call, injectable for tests: system prompt + one human turn in,
 * prose out. `onDelta`, when given, receives the answer as it is written, so
 * the person watches it arrive instead of seeing it land whole.
 */
/** A call the pass made, handed back to be run as the real tool. */
export type AnswerPassCall = { id: string; name: string; args: Record<string, unknown> };

export type AnswerComposer = (input: {
  orgId: string;
  system: string;
  human: string;
  onDelta?: (delta: string) => void;
  /**
   * The graph's own messages for this turn (the model's calls and the tool
   * results, in the tool channel). When present the pass reads them instead
   * of the pasted evidence in `human`: conversation 384's answer continued
   * that pasted "What you already did and found:" block with tool results it
   * made up.
   */
  messages?: readonly unknown[];
  /** Tools the pass may call — the agent's card tools, so a card it means is a real call (conversation 384 wrote one out as text). */
  tools?: readonly import('@langchain/core/tools').StructuredToolInterface[];
  /** Receives each call the pass makes; the caller runs it through the real tool. */
  onToolCall?: (call: AnswerPassCall) => Promise<void>;
}) => Promise<string>;

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
  return `${systemPrompt ?? ''}\n\n${steps > 0 ? `You ran ${steps} tool step${steps === 1 ? '' : 's'} and ended your turn without answering the person; your reply so far is a sentence saying you would look. The results of those steps are below.` : 'You ended your turn without answering the person and ran no tool in it. The conversation so far and the page the person is on are below: they are what you know — never say the context is missing or that results came back empty when the conversation holds them.'} Answer the person NOW, from those results, in your own voice. Phone-length: the one thing to do first, then at most one screen of why; detail belongs to a follow-up. Do not call tools and do not narrate what you are about to do. If the results do not settle something, say exactly what you could not establish and what would — never guess. If the person asked for something to be filed, decided or recommended and you did not do it, say so plainly; ask them only for what the conversation does not already hold, never for what they just told you. Speak as yourself: never mention this pass, a "live tool turn", or how your turns work — the person sees one answer from one agent (2026-09-25: a reply said "I cannot file those from the ANSWER PASS").`.trim();
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
 * @param input.onDelta - Receives the answer as it streams.
 * @param input.history
 * @param input.messages
 * @param input.tools
 * @param input.onToolCall
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
  onDelta?: (delta: string) => void;
  /**
   * The conversation before this turn, oldest first. Conversation 378
   * (2026-09-29): a turn that thought and wrote nothing reached this pass
   * with no tool results, and the pass — handed only "write it" — answered
   * "I don't have enough context from the prior steps". The thread held all
   * of it. The pass reads what the turn could read.
   */
  history?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  /** The graph's own messages for the turn; the pass continues from them when present. */
  messages?: readonly unknown[];
  /** Tools the pass may call, and where its calls go. */
  tools?: readonly import('@langchain/core/tools').StructuredToolInterface[];
  onToolCall?: (call: AnswerPassCall) => Promise<void>;
}): Promise<string | null> {
  if (!owesAnswer(input.finalText, input.toolCalls, input.endedOnTool)) {
    return null;
  }
  if (input.messages && input.messages.length > 0) {
    // The real conversation carries the results; the instruction is all the pass adds.
    try {
      const answer = (await input.compose({ orgId: input.orgId, system: answerPassSystem(input.systemPrompt, input.toolCalls.length), human: `The person said:\n${input.request.trim()}\n\nAnswer them now, from what your steps above returned.`, messages: input.messages, tools: input.tools, onToolCall: input.onToolCall, onDelta: input.onDelta })).trim();
      return answer.length > 0 ? answer : null;
    } catch {
      return null;
    }
  }
  const convo = (input.history ?? []).slice(-6).map(t => `${t.role === 'user' ? 'Person' : 'You'}: ${t.content.slice(0, 3_000)}`).join('\n\n');
  const human = [
    ...(convo ? [`The conversation so far:\n\n${convo}`] : []),
    `The person said:\n${input.request.trim()}`,
    `Your reply so far (do not repeat it):\n${input.finalText.trim() || '(nothing)'}`,
    `What you already did and found:\n\n${input.toolCalls.length > 0 ? evidenceBlock(input.toolCalls) : '(no tool ran this turn — answer from the conversation and the page above)'}`,
  ].join('\n\n---\n\n');
  try {
    const answer = (await input.compose({ orgId: input.orgId, system: answerPassSystem(input.systemPrompt, input.toolCalls.length), human, onDelta: input.onDelta })).trim();
    return answer.length > 0 ? answer : null;
  } catch {
    return null;
  }
}

/**
 * Text out of one streamed chunk: a string, or the text blocks of a content
 * array (a thinking block is not the answer).
 * @param content - The chunk's content.
 */
export function chunkText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return (content as Array<{ type?: string; text?: string }>).map(c => (c.type === 'text' ? c.text ?? '' : '')).join('');
}

/**
 * The real pass: the org's main model, no tools, one call, bounded — and
 * STREAMED. It used to be one `invoke`, so after "Working 40s" the whole
 * answer appeared at once (Chris, 2026-09-25: "After thinking the response
 * just pops in. It should stream in").
 * @param root0 - See {@link AnswerComposer}.
 * @param root0.orgId - The org the call is made for.
 * @param root0.system - The pass's system prompt.
 * @param root0.human - The turn laid out for the pass.
 * @param root0.onDelta - Receives the answer as it is written.
 * @param root0.messages
 * @param root0.tools
 * @param root0.onToolCall
 */
export const composeAnswerWithModel: AnswerComposer = async ({ orgId, system, human, onDelta, messages, tools, onToolCall }) => {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const base = await buildChatModelForOrg('main', orgId, { temperature: 0.2, streaming: true, maxTokens: 2_000 });
  const model = tools && tools.length > 0 && typeof (base as { bindTools?: unknown }).bindTools === 'function'
    ? (base as unknown as { bindTools: (t: unknown[]) => typeof base }).bindTools([...tools])
    : base;
  const stream = await model.stream([new SystemMessage(system), ...((messages ?? []) as never[]), new HumanMessage(human)], { signal: AbortSignal.timeout(60_000) });
  let text = '';
  type Gathered = { concat?: (c: unknown) => unknown; tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> };
  let whole: Gathered | undefined;
  for await (const chunk of stream) {
    const prev: Gathered | undefined = whole;
    whole = (prev?.concat ? prev.concat(chunk) : chunk) as Gathered;
    const delta = chunkText(chunk.content);
    if (delta) {
      text += delta;
      onDelta?.(delta);
    }
  }
  for (const [i, call] of ((whole as Gathered | undefined)?.tool_calls ?? []).entries()) {
    await onToolCall?.({ id: call.id ?? `answer-pass-${i}`, name: call.name, args: call.args ?? {} });
  }
  return text;
};

/* ------------------------------------------------------------------ */
/* The source check — specifics the answer states that its sources do  */
/* not carry. Kept in this module (the answer's other backstop), not a  */
/* module of its own: check:route-graph counts every module per route. */
/* ------------------------------------------------------------------ */

/**
 * On a hard question the most-missed rubric fact was "no invented facts" — at
 * every effort level, before and after thinking changes (#1305): an amount,
 * a date or a promise the threads never held, stated as fact. The answer has
 * already streamed by the time it can be checked, and an agent's words are
 * never edited after it writes them (CLAUDE.md), so the check MARKS rather
 * than rewrites: one small-model read of the answer against the snippets the
 * turn cited, returning typed flags, which land as a step on the turn
 * ("Checked the answer against its sources · 2 unverified") with each flagged
 * quote and why — persisted with the trace, one tap from the claim.
 */
export type GroundingFlag = {
  /** The answer's own words, verbatim. */
  quote: string;
  kind: 'name' | 'date' | 'amount' | 'promise' | 'other';
  /** `unsupported`: no source says it. `uncited`: a source may, but the sentence names none. */
  issue: 'unsupported' | 'uncited';
};

export type GroundingSource = { n: number; title: string; source: string; snippet?: string };

export const GROUNDING_SYSTEM = [
  'You check an assistant\'s answer against the sources it gathered. List only SPECIFIC claims about people, companies or records — names, dates and deadlines (including relative ones like "tomorrow" or "5 days ago", checked against NOW), amounts and quantities, commitments or promises made by anyone — that are either not supported by any source ("unsupported") or stated without a [n] citation although they come from a source ("uncited").',
  'Ignore advice, judgement, ranking, tone, and anything the person asked for. Do not flag a claim a cited source supports. Quote the answer\'s exact words (at most 120 characters).',
  'Answer with JSON only: {"flags": [{"quote": "...", "kind": "name" | "date" | "amount" | "promise" | "other", "issue": "unsupported" | "uncited"}]}. An empty list when everything checks out.',
].join(' ');

/** The most sources and characters the check reads. */
const GROUNDING_SOURCES = 40;
const GROUNDING_ANSWER_CHARS = 8_000;
/** The most flags kept. */
const GROUNDING_MAX_FLAGS = 8;

/**
 * The check's user message: the sources by number, then the answer.
 * @param answer - The turn's answer.
 * @param sources - What the turn cited, with what it read of each.
 * @param now - The turn's clock line, so relative dates can be checked.
 */
export function groundingPrompt(answer: string, sources: GroundingSource[], now?: string): string {
  return [
    // Relative dates ("tomorrow", "5 days ago") are claims too, checkable only against today.
    ...(now ? [`NOW: ${now}`, ''] : []),
    'SOURCES:',
    ...sources.slice(0, GROUNDING_SOURCES).map(s => `[${s.n}] ${s.title} (${s.source})${s.snippet ? ` — ${s.snippet}` : ''}`),
    '',
    'ANSWER:',
    answer.slice(0, GROUNDING_ANSWER_CHARS),
  ].join('\n');
}

/**
 * The check's flags, kept only where the quote is really in the answer — a
 * flag pointing at words the answer does not contain is the checker's own
 * invention.
 * @param raw - The model's reply.
 * @param answer - The answer it checked.
 */
export function parseGroundingFlags(raw: string, answer: string): GroundingFlag[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { flags?: unknown };
    const flat = answer.replace(/\s+/g, ' ');
    return (Array.isArray(parsed.flags) ? parsed.flags : [])
      .filter((f): f is GroundingFlag => !!f && typeof (f as GroundingFlag).quote === 'string')
      .map(f => ({
        quote: f.quote.replace(/\s+/g, ' ').trim().slice(0, 160),
        kind: (['name', 'date', 'amount', 'promise'] as const).includes(f.kind as never) ? f.kind : 'other',
        issue: f.issue === 'uncited' ? 'uncited' as const : 'unsupported' as const,
      }))
      .filter(f => f.quote.length >= 3 && flat.includes(f.quote))
      .slice(0, GROUNDING_MAX_FLAGS);
  } catch {
    return [];
  }
}

/** Test seam: one small-model call. */
export type GroundingModel = (system: string, user: string) => Promise<{ text: string; response?: unknown }>;

/** How long the check may take before the turn ends without it. */
const GROUNDING_TIMEOUT_MS = 6_000;

/**
 * Check an answer against its sources. Never throws: no model, a slow one or
 * an unreadable reply returns no flags and says it did not run.
 * @param opts - The answer and its sources.
 * @param opts.orgId - Whose key pays, and whose budget it lands on.
 * @param opts.answer - The turn's answer.
 * @param opts.sources - What the turn cited.
 * @param opts.now - The turn's clock line.
 * @param opts.model - Test seam.
 */
export async function checkGrounding(opts: { orgId: string; answer: string; sources: GroundingSource[]; now?: string; model?: GroundingModel }): Promise<{ ran: boolean; flags: GroundingFlag[]; ms: number }> {
  const started = Date.now();
  try {
    const model = opts.model ?? await defaultGroundingModel(opts.orgId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = await Promise.race([
      model(GROUNDING_SYSTEM, groundingPrompt(opts.answer, opts.sources, opts.now)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('source check timed out')), GROUNDING_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    if (reply.response !== undefined) {
      const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
      const { FEATURES } = await import('@/libs/Langfuse/features');
      await chargeModelCall({ orgId: opts.orgId, feature: FEATURES.CHAT_GROUNDING, role: 'classifier', response: reply.response });
    }
    return { ran: true, flags: parseGroundingFlags(reply.text, opts.answer), ms: Date.now() - started };
  } catch {
    return { ran: false, flags: [], ms: Date.now() - started };
  }
}

async function defaultGroundingModel(orgId: string): Promise<GroundingModel> {
  const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 800, streaming: false });
  return async (system, user) => {
    const response = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: user }]);
    const c = response.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(part => (part as { text?: string }).text ?? '').join('') : '';
    return { text, response };
  };
}

/**
 * What the step on the turn says: how many claims the sources do not carry,
 * and each one with why.
 * @param flags - The check's flags.
 */
export function groundingStep(flags: GroundingFlag[]): { label: string; detail: string; resultDetail: string } {
  return {
    label: 'Checked the answer against its sources',
    detail: `${flags.length} unverified`,
    resultDetail: flags.map(f => `Unverified (${f.issue === 'uncited' ? 'no source cited' : 'not in the sources'}): “${f.quote}”`).join('\n'),
  };
}
