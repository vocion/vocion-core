/**
 * THE PERSON ASKED FOR A RECORD; THE TURN ENDS WITH ONE.
 *
 * Conversation 349 (2026-09-28): "File a feature request for Stamp: …". The
 * product manager's one propose_action call arrived broken, it never called
 * again, and the turn ended "Nothing was saved in this turn". The person said
 * "You said nothing was saved. Please file it now." — and the second turn
 * called nothing at all and answered "Filed. The request card is on your
 * screen". Two turns, one plain instruction, no record.
 *
 * The "Nothing was saved" notice tells the truth about that; it does not do
 * the work. This does, the way `recommendActionBackstop` and the automations'
 * recording pass (`services/automations/requiredToolPass.ts`) do: when the
 * person's own words ask for something to be filed and the turn wrote
 * nothing, the conversation goes to the model once more with propose_action
 * bound and CHOSEN, so the only possible output is the call. The model
 * transcribes what the person asked for into the typed shape — it decides
 * nothing new — and the call rides every gate a turn's own call does
 * (schema, trust, the review queue, the tool-call row).
 *
 * Gated three ways, so it never fires on a turn that did its job: the
 * person's message asks for a filing, no write ran in the turn, and the agent
 * holds propose_action.
 *
 * A TYPED RECORD IS FILED WITH ITS OWN TOOL. Conversation 353 (2026-09-28):
 * this pass, bound to propose_action, hit the same wall the turn had — the
 * request type's proposal-ready bar, which free-form `fields` cannot see.
 * When the agent holds a `file_<type>` tool (`tools/fileRecord.ts`) the pass
 * is bound to THAT, so the schema the model fills is the type's own, with its
 * required fields marked ({@link owedWriteTool}).
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';

/** "file a feature request", "log a bug", "open a ticket for…", "create the record". */
const ASKS_TO_FILE_A_THING = /\b(?:file|log|open|raise|submit|create|record|capture)\s+(?:a|an|the|one|this|that|another)\s+(?:[\w-]+\s+){0,3}(?:request|ticket|bug|issue|feature|task|record|incident)s?\b/i;

/** "please file it now", "file this", "log that". */
const ASKS_TO_FILE_IT = /\b(?:file|log|raise|submit)\s+(?:it|this|that)\b/i;

/** A request that is plainly about something else ("how do I file…", "don't file"). */
const NOT_AN_ASK = /\b(?:how (?:do|can|would) (?:i|we|you)|don'?t|do not|never|should (?:i|we))\s(?:[^.?!\n]{0,20}\s)?(?:file|log|open|raise|submit|create|record)\b/i;

/**
 * Does the person's message ask for something to be filed?
 * @param request - The person's message, as typed.
 */
export function asksToFile(request: string): boolean {
  const text = (request ?? '').split('\n\n--- ')[0] ?? '';
  return (ASKS_TO_FILE_A_THING.test(text) || ASKS_TO_FILE_IT.test(text)) && !NOT_AN_ASK.test(text);
}

/**
 * The tool the pass is bound to: the agent's typed filing tool when it has
 * one (the one whose type the conversation names, when it has several), else
 * propose_action.
 * @param tools - The agent's tools, as the registry built them.
 * @param text - The person's words and the conversation, to pick among typed tools.
 */
export function owedWriteTool(tools: readonly StructuredToolInterface[], text = ''): StructuredToolInterface | undefined {
  const typed = tools.filter(t => typeof (t as { filesType?: unknown }).filesType === 'string');
  if (typed.length === 1) {
    return typed[0];
  }
  if (typed.length > 1) {
    const words = text.toLowerCase();
    const named = typed.find(t => words.includes(String((t as { filesType?: string }).filesType).replace(/[_-]+/g, ' ')));
    if (named) {
      return named;
    }
  }
  return tools.find(t => t.name === 'propose_action');
}

/** One earlier message, as the pass reads it. */
export type OwedWriteTurn = { role: 'user' | 'assistant'; content: string };

/** A model that can be bound to the one tool, chosen. */
export type OwedWriteModel = {
  bindTools?: (tools: StructuredToolInterface[], opts?: unknown) => { invoke: (messages: BaseMessage[]) => Promise<{ tool_calls?: Array<{ id?: string; name: string; args: Record<string, unknown> }> } & BaseMessage> };
};

export type OwedWriteResult = {
  /** Whether a call was accepted (DONE, PENDING or refreshed). */
  filed: boolean;
  /** The arguments of the last call made, for the turn's tool log. */
  args?: Record<string, unknown>;
  /** The tool's last answer. */
  output: string;
  /** One sentence for the person, when a call was accepted. */
  line?: string;
};

/**
 * The sentence the person reads under the answer, from what the tool said.
 * @param output - The filing tool's answer (propose_action and file_<type> share it).
 */
export function owedWriteLine(output: string): string | null {
  const done = /is DONE: filed as (.+?) \(run #\d[^)]*\)(?:, open at (\S+?))?\.(?:\s|$)/.exec(output);
  if (done) {
    const name = done[1]!.trim();
    return `Filed from this conversation: ${done[2] ? `[${name}](${done[2]})` : name}.`;
  }
  const pending = /action run #(\d+) is PENDING/.exec(output);
  if (pending) {
    return `Filed from this conversation for approval: it is waiting in Review as action run #${pending[1]}. Nothing is recorded until a person approves it there.`;
  }
  const refreshed = /Action run #(\d+) for .+ was updated in place/.exec(output);
  if (refreshed) {
    return `This was already waiting in Review as action run #${refreshed[1]}; it now carries what was asked here.`;
  }
  const done2 = /is DONE \(run #(\d+)/.exec(output);
  if (done2) {
    return `Filed from this conversation (run #${done2[1]}).`;
  }
  return null;
}

/**
 * File what the person asked for, once, with the filing tool chosen.
 * @param opts - The turn, the tool and the model.
 * @param opts.request - The person's message this turn.
 * @param opts.history - Earlier messages in the conversation, oldest first.
 * @param opts.answer - What the turn answered.
 * @param opts.systemPrompt - The agent's own prompt, so the call follows its rules.
 * @param opts.tool - The agent's filing tool ({@link owedWriteTool}), as the registry built it (wrapped, so the call is recorded).
 * @param opts.model - A chat model for the pass.
 */
export async function fileOwedWrite(opts: {
  request: string;
  history: ReadonlyArray<OwedWriteTurn>;
  answer: string;
  systemPrompt?: string;
  tool: StructuredToolInterface;
  model: OwedWriteModel;
}): Promise<OwedWriteResult> {
  if (!opts.model.bindTools) {
    return { filed: false, output: 'the model cannot bind tools' };
  }
  const { HumanMessage, SystemMessage, ToolMessage } = await import('@langchain/core/messages');
  const model = opts.model.bindTools([opts.tool], { tool_choice: opts.tool.name });
  const convo = opts.history.slice(-8).map(t => `${t.role === 'user' ? 'Person' : 'You'}: ${t.content.slice(0, 4_000)}`).join('\n\n');
  const shape = opts.tool.name === 'propose_action'
    ? 'Send action_input as an OBJECT (never a JSON string), keep long text short enough to send whole, and put confidence, rationale, suggested_decision and suggested_decision_reason beside action_input.'
    : `The tool's arguments ARE the record's fields: fill every required one from the conversation — in the person's words where they gave them, yours where the thread settled it — and keep long text short enough to send whole.`;
  const messages: BaseMessage[] = [
    new SystemMessage(`${opts.systemPrompt ?? ''}\n\nFILING PASS: the person asked for something to be filed and this turn ended without the call, so nothing was saved. Your only job now is to call ${opts.tool.name} once, filing exactly what the person asked for, from the conversation below — the same content, in the typed shape your rules require. Do not decide anything new. ${shape}`),
    new HumanMessage(`${convo ? `The conversation so far:\n\n${convo}\n\n` : ''}The person, this turn: ${opts.request.slice(0, 4_000)}\n\nYour answer this turn:\n${opts.answer.slice(0, 6_000)}`),
  ];
  let output = '';
  let args: Record<string, unknown> | undefined;
  // Two tries: a refusal names what to fix and the second call fixes it.
  // A backstop, not a loop.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await model.invoke(messages);
    const call = (res.tool_calls ?? []).find(c => c.name === opts.tool.name);
    if (!call) {
      return { filed: false, args, output: output || 'the model returned no call' };
    }
    args = call.args;
    const id = call.id ?? `${opts.tool.name}-owed-${attempt}`;
    const result = await opts.tool.invoke({ type: 'tool_call', id, name: call.name, args: call.args } as never).then(
      r => (typeof r === 'string' ? r : String((r as { content?: unknown }).content ?? '')),
      (err: Error) => `Not recorded: ${err.message}`,
    );
    output = result;
    const line = owedWriteLine(result);
    if (line) {
      return { filed: true, args, output, line };
    }
    messages.push(res, new ToolMessage({ content: result, tool_call_id: id }));
  }
  return { filed: false, args, output };
}
