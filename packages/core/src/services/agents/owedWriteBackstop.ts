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

/**
 * Does the answer already name the record the filing call made? Journey 4
 * (2026-09-28): the pass appended "Filed from this conversation: request
 * #214." and the answer pass then wrote "Filed as request #214." under it —
 * the same record announced twice. The line is a receipt for an answer that
 * did not give one; an answer that names the record needs none.
 * @param text - The answer as it stands.
 * @param output - The filing tool's answer.
 */
export function answerNamesFiled(text: string, output: string): boolean {
  const href = /open at (\S+?)\.(?:\s|$)/.exec(output)?.[1];
  if (href && (text ?? '').includes(href)) {
    return true;
  }
  const filed = /filed as [^#\n]{0,40}#(\d+)/i.exec(output);
  return filed !== null && new RegExp(`#${filed[1]}(?!\\d)`).test(text ?? '');
}

/*
 * THE PERSON ASKED TO CHANGE THE RECORD ON THEIR SCREEN; THE TURN ENDS WITH
 * IT CHANGED.
 *
 * Journey 4 (2026-09-28): on request #214's feature page the person wrote
 * "Change this request: also include which pages each viewer read, and the
 * CSV filename should be the document title plus today's date." The product
 * manager read the record, wrote "Updated request #214 — two changes …",
 * called nothing, and the card backstop put up an approval card; the
 * record's acceptance stayed five lines. The claim check said "Nothing was
 * saved" — true, and still not the change.
 *
 * The same backstop as a filing, for an update: when the page names a record,
 * the message asks to change it, and no write to THAT record ran, the
 * conversation goes to the model once more with update_object bound and
 * CHOSEN, the record's current fields in front of it, and the id and type
 * fixed from the page — the model transcribes the change into the typed
 * shape and decides nothing new. The call rides every gate a turn's own call
 * does: the type's schema, the `objects.update_meta` trust rule (done for you
 * with Undo above the bar, a card in Review below it), the tool-call row, and
 * the record's history (the action run IS the version, `recordBody.ts`).
 */

/** "change this request", "update the acceptance", "add … to it", "rename it". */
const CHANGE_VERB = '(?:change|update|edit|amend|revise|modify|add|append|remove|drop|delete|rename|retitle|rewrite|reword|replace|include|mark)';

/** The message opens on the change: "Change this request: …", "Please also add …". */
const OPENS_ON_CHANGE = new RegExp(`^\\s*(?:(?:please|ok(?:ay)?|and|also|now|then)[,\\s]+)*${CHANGE_VERB}\\b`, 'im');

/** The change names its target: "this request", "the acceptance", "it". */
const NAMES_THE_RECORD = new RegExp(`\\b${CHANGE_VERB}\\s+(?:(?:this|that|the|its|it|our)\\b|[\\w-]+\\s+(?:to|on|in|from)\\s+(?:this|that|the|it)\\b)`, 'i');

/** Asking about a change is not asking for one. */
const NOT_A_CHANGE = new RegExp(`\\b(?:how (?:do|can|would|should) (?:i|we|you)|don'?t|do not|never|should (?:i|we)|would it|could we|can we|what (?:would|if)|why)\\s(?:[^.?!\\n]{0,20}\\s)?${CHANGE_VERB}\\b`, 'i');

/**
 * Does the person's message ask for the record on their page to be changed?
 * Only meaningful with a record in page context: the pronoun is the page.
 * @param request - The person's message, as typed.
 */
export function asksToChange(request: string): boolean {
  const text = (request ?? '').split('\n\n--- ')[0] ?? '';
  if (asksToFile(text) || NOT_A_CHANGE.test(text) || /\bupdate (?:me|us)\b/i.test(text)) {
    return false;
  }
  return OPENS_ON_CHANGE.test(text) || NAMES_THE_RECORD.test(text);
}

/**
 * Did a write to this record run (or go to Review) in the turn — not a refusal?
 * @param toolCalls - The turn's tool calls.
 * @param id - The record.
 */
export function changedInTurn(toolCalls: ReadonlyArray<{ tool: string; input?: Record<string, unknown>; output?: string }>, id: number): boolean {
  return toolCalls.some((c) => {
    if (c.tool === 'update_object') {
      return Number(c.input?.id) === id
        && !/^\s*(?:update refused|refused|update failed|not written|update to \S+ #\d+ did not land)/i.test(c.output ?? '');
    }
    // The artifact path to the same record (backlog 035): update_artifact on
    // its body answers "<type> #<id> … changed" or "The change to <type> #<id>
    // … is PENDING".
    if (c.tool === 'update_artifact') {
      return new RegExp(`#${id}\\b[^\\n]*(?:changed —|is PENDING)|^Renamed to`).test(c.output ?? '');
    }
    // The same change as a card or a proposal (a call the model wrote as
    // text runs as one, `textToolCalls.ts`): it rides objects.update_meta's
    // trust rule already, so a second write would be the change twice.
    const input = c.input?.action_input as Record<string, unknown> | undefined;
    return (c.tool === 'recommend_action' || c.tool === 'propose_action')
      && c.input?.action_id === 'objects.update_meta'
      && Number(input?.id) === id
      && !/^\s*(?:\{"ok":false|proposal (?:failed|refused)|not proposed)/i.test(c.output ?? '');
  });
}

/**
 * The sentence the person reads under the answer, from update_object's answer.
 * @param output - update_object's answer.
 * @param label - The record, as the person knows it ("request #214").
 * @param href - Its page.
 * @param what - What changed, in one sentence (the call's `reason`).
 */
export function changeLine(output: string, label: string, href: string | null, what: string): string | null {
  const name = href ? `[${label}](${href})` : label;
  const said = what.trim().replace(/\.+$/, '');
  if (/ updated — .+ written \(run #\d+/.test(output)) {
    return `Changed ${name}: ${said}.`;
  }
  const pending = /is PENDING a person's decision \(run #(\d+)/.exec(output) ?? /now carries these values \(run #(\d+)\)/.exec(output);
  if (pending) {
    return `The change to ${name} is waiting in Review as action run #${pending[1]}: ${said}. Nothing is changed until a person approves it.`;
  }
  return null;
}

/**
 * The record a change on this page is owed to: the page's `object`, by id and,
 * once the page record is typed (`services/chat/pageRecord.ts`), its type —
 * `/dashboard/p/feature/124` is request 124. Null for a page about no record.
 * @param ref - The page context's record.
 * @param ref.type - Its ref type (`object` is a record).
 * @param ref.id - Its id.
 * @param ref.objectType - Its object type, once typed.
 */
export function owedChangeTarget(ref: { type: string; id: string; objectType?: string } | null | undefined): { id: number; objectType: string | null } | null {
  if (ref?.type !== 'object' || !/^\d+$/.test(ref.id)) {
    return null;
  }
  return { id: Number(ref.id), objectType: ref.objectType ?? null };
}

/** The record the change pass writes: the page's, with what it holds now. */
export type OwedChangeRecord = { id: number; typeSlug: string; label: string; href: string | null; fields: Record<string, unknown> };

/**
 * Change the record the person is looking at, once, with update_object chosen.
 * @param opts - The turn, the record, the tool and the model.
 * @param opts.request - The person's message this turn.
 * @param opts.history - Earlier messages in the conversation, oldest first.
 * @param opts.answer - What the turn answered.
 * @param opts.systemPrompt - The agent's own prompt.
 * @param opts.record - The page's record ({@link OwedChangeRecord}).
 * @param opts.tool - update_object, as the registry built it (wrapped, so the call is recorded).
 * @param opts.model - A chat model for the pass.
 */
export async function changeOwedRecord(opts: {
  request: string;
  history: ReadonlyArray<OwedWriteTurn>;
  answer: string;
  systemPrompt?: string;
  record: OwedChangeRecord;
  tool: StructuredToolInterface;
  model: OwedWriteModel;
}): Promise<OwedWriteResult> {
  if (!opts.model.bindTools) {
    return { filed: false, output: 'the model cannot bind tools' };
  }
  const { HumanMessage, SystemMessage, ToolMessage } = await import('@langchain/core/messages');
  const model = opts.model.bindTools([opts.tool], { tool_choice: opts.tool.name });
  const convo = opts.history.slice(-6).map(t => `${t.role === 'user' ? 'Person' : 'You'}: ${t.content.slice(0, 3_000)}`).join('\n\n');
  const { id, typeSlug, label } = opts.record;
  const messages: BaseMessage[] = [
    new SystemMessage(`${opts.systemPrompt ?? ''}\n\nCHANGE PASS: the person is on the page of ${label} and asked for it to be changed. This turn ended without writing the change, so the record is exactly as below. Your only job now is to call ${opts.tool.name} once, with object_type "${typeSlug}" and id ${id}, writing exactly the change the person asked for — the same content, in the record's own fields. Do not decide anything new. Put in \`set\` ONLY the fields the change touches, each with its WHOLE new value: a list field (acceptance criteria, tags) is written whole, so keep every existing item, then add, edit or remove what was asked. \`reason\` is one sentence saying what changed, in the person's terms. \`confidence\` is high when the person stated the change plainly.`),
    new HumanMessage(`${label} as it stands (${typeSlug} #${id}):\n${JSON.stringify(opts.record.fields).slice(0, 12_000)}\n\n${convo ? `The conversation so far:\n\n${convo}\n\n` : ''}The person, this turn: ${opts.request.slice(0, 4_000)}\n\nYour answer this turn:\n${opts.answer.slice(0, 4_000)}`),
  ];
  let output = '';
  let args: Record<string, unknown> | undefined;
  // Two tries, as the filing pass: a refusal names what to fix.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await model.invoke(messages);
    const call = (res.tool_calls ?? []).find(c => c.name === opts.tool.name);
    if (!call) {
      return { filed: false, args, output: output || 'the model returned no call' };
    }
    // The record is the page's, never the model's pick: the id and type are
    // fixed here, so the pass cannot write a different record.
    args = { ...call.args, object_type: typeSlug, id };
    const callId = call.id ?? `${opts.tool.name}-owed-change-${attempt}`;
    output = await opts.tool.invoke({ type: 'tool_call', id: callId, name: call.name, args } as never).then(
      r => (typeof r === 'string' ? r : String((r as { content?: unknown }).content ?? '')),
      (err: Error) => `Update failed: ${err.message}`,
    );
    const set = args.set && typeof args.set === 'object' ? Object.keys(args.set as object) : [];
    const what = typeof args.reason === 'string' && args.reason.trim() ? args.reason : `${set.join(', ') || 'fields'} updated`;
    const line = changeLine(output, label, opts.record.href, what);
    if (line) {
      return { filed: true, args, output, line };
    }
    messages.push(res, new ToolMessage({ content: output, tool_call_id: callId }));
  }
  return { filed: false, args, output };
}
