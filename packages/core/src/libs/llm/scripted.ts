/**
 * The scripted model — a chat model that plays a written part.
 *
 * Every chat use case in this product is "a person says X, the agent calls
 * these tools with these arguments, then says Y". Proving one against a live
 * model costs a key, money and determinism; recording one (`VOCION_LLM_MODE=
 * record`) is keyed on the exact prompt, so a changed system prompt or a new
 * artifact id misses the cache. This provider is the third way: the SCRIPT
 * names the person's line, the tool calls to make, and the reply, and the
 * model matches the last human message against it. Tools really run — the
 * document really renders, the artifact really versions, the pane really
 * updates — only the reasoning is written down.
 *
 * That makes a chat use case a fixture: `e2e/documents/scripts/*.json` is
 * "draft the proposal → cut page 9 → price it per opening" as data, replayed
 * by Playwright with screenshots, on every pull request, with no model.
 *
 * On by `VOCION_LLM_PROVIDER=scripted`; refused in production. The script
 * comes from `VOCION_LLM_SCRIPT` (a JSON file). A turn with no matching line
 * answers with a fixed sentence that says so, so an unscripted prompt in a
 * test fails loudly rather than passing by accident.
 *
 * Script shape:
 *   {
 *     "turns": [
 *       {
 *         "match": "draft the proposal",            // substring of the person's message, case-insensitive
 *         "steps": [                                  // tool calls, in order; each waits for its result
 *           { "tool": "render_document", "args": { "title": "…", "html": { "$file": "northwind-v1.html" } } }
 *         ],
 *         "reply": "The proposal is open beside you: 6 sheets, verified."
 *       }
 *     ],
 *     "fallback": "This scripted model has no line for that."
 *   }
 * `{ "$file": "<path>" }` anywhere in args reads a file relative to the script,
 * at the moment the step is played — so a test can write the fixture after
 * the server has started and before the first turn.
 */

import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { z } from 'zod';

const StepSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});
const TurnSchema = z.object({
  match: z.string().min(1),
  steps: z.array(StepSchema).default([]),
  reply: z.string().default('Done.'),
});
export const ScriptSchema = z.object({
  turns: z.array(TurnSchema).min(1),
  fallback: z.string().default('This scripted model has no line for that message.'),
});
export type Script = z.infer<typeof ScriptSchema>;
export type ScriptTurn = z.infer<typeof TurnSchema>;

/**
 * Resolve `{ "$file": "…" }` markers to file contents, relative to `baseDir`.
 * @param value
 * @param baseDir
 */
export function resolveFileRefs(value: unknown, baseDir: string): unknown {
  if (Array.isArray(value)) {
    return value.map(v => resolveFileRefs(v, baseDir));
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$file === 'string' && Object.keys(obj).length === 1) {
      return readFileSync(path.resolve(baseDir, obj.$file), 'utf8');
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveFileRefs(v, baseDir)]));
  }
  return value;
}

/**
 * Load and validate a script file.
 * @param file
 */
export function loadScript(file: string): Script & { baseDir: string } {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  return { ...ScriptSchema.parse(raw), baseDir: path.dirname(path.resolve(file)) };
}

/**
 * The text of a message, whatever shape its content takes.
 * @param m
 */
function textOf(m: BaseMessage): string {
  const c = m.content as unknown;
  if (typeof c === 'string') {
    return c;
  }
  if (Array.isArray(c)) {
    return c.map(b => (b && typeof b === 'object' && 'text' in (b as object) ? String((b as { text: unknown }).text) : '')).join('\n');
  }
  return '';
}

/**
 * Where we are in the current turn: the person's last line, and how many
 * tool results have come back since it.
 * @param messages
 */
export function positionInTurn(messages: BaseMessage[]): { human: string; toolResults: number } {
  let lastHuman = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage || messages[i]?.getType() === 'human') {
      lastHuman = i;
      break;
    }
  }
  const human = lastHuman === -1 ? '' : textOf(messages[lastHuman]!);
  let toolResults = 0;
  for (let i = lastHuman + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (m instanceof ToolMessage || m.getType() === 'tool') {
      toolResults++;
    }
  }
  return { human, toolResults };
}

/**
 * The turn whose `match` appears in the person's line (case-insensitive);
 * the first one wins, so order specific lines before general ones.
 * @param script
 * @param human
 */
export function matchTurn(script: Script, human: string): ScriptTurn | null {
  const hay = personLine(human).toLowerCase();
  return script.turns.find(t => hay.includes(t.match.toLowerCase())) ?? null;
}

/**
 * The person's own words, without the page-context block the chat surface
 * appends (`--- where I am ---` …). That block quotes the page title and the
 * conversation title, which is the previous line the person typed — matching
 * on the whole message would replay the first turn forever.
 * @param human
 */
export function personLine(human: string): string {
  const cut = human.indexOf('\n\n--- ');
  return (cut === -1 ? human : human.slice(0, cut)).trim();
}

export type ScriptedChatModelParams = BaseChatModelParams & { script: Script; baseDir?: string };

export class ScriptedChatModel extends BaseChatModel {
  private readonly script: Script;
  private readonly baseDir: string;
  private boundTools: StructuredToolInterface[] = [];

  constructor(params: ScriptedChatModelParams) {
    super(params);
    this.script = params.script;
    this.baseDir = params.baseDir ?? process.cwd();
  }

  _llmType(): string {
    return 'scripted';
  }

  /**
   * deepagents binds its tools here; the names are remembered so a step that
   * names a tool the agent does not have fails with a readable message.
   * @param tools
   */
  override bindTools(tools: StructuredToolInterface[]): this {
    const next = new ScriptedChatModel({ script: this.script, baseDir: this.baseDir }) as this;
    next.boundTools = tools;
    return next;
  }

  /**
   * The loop reads the answer off `on_chat_model_stream` events, so the part
   * has to be spoken as chunks: one text chunk for a reply, one tool-call
   * chunk for a step. Same decision as `_generate`, streamed.
   * @param messages
   * @param _options
   * @param runManager
   */
  override async* _streamResponseChunks(messages: BaseMessage[], _options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): AsyncGenerator<ChatGenerationChunk> {
    const result = await this._generate(messages);
    const message = result.generations[0]!.message as AIMessage;
    const text = typeof message.content === 'string' ? message.content : '';
    const toolCalls = message.tool_calls ?? [];
    const chunk = new ChatGenerationChunk({
      text,
      message: new AIMessageChunk({
        content: text,
        tool_call_chunks: toolCalls.map((tc, i) => ({ name: tc.name, args: JSON.stringify(tc.args), id: tc.id, index: i, type: 'tool_call_chunk' as const })),
      }),
    });
    yield chunk;
    await runManager?.handleLLMNewToken(text);
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const { human, toolResults } = positionInTurn(messages);
    const turn = matchTurn(this.script, human);
    if (process.env.VOCION_SCRIPTED_DEBUG === '1') {
      console.warn(`[scripted] messages=${messages.length} types=${messages.map(m => m.getType()).join(',')} toolResults=${toolResults} turn=${turn?.match ?? '(none)'}\n[scripted] human=${JSON.stringify(human.slice(0, 600))}`);
    }
    if (!turn) {
      return reply(`${this.script.fallback} (heard: "${human.slice(0, 80)}")`);
    }
    const step = turn.steps[toolResults];
    if (step) {
      if (this.boundTools.length > 0 && !this.boundTools.some(t => t.name === step.tool)) {
        return reply(`Scripted step names tool "${step.tool}", which this agent does not have. Available: ${this.boundTools.map(t => t.name).join(', ')}.`);
      }
      const args = resolveFileRefs(step.args, this.baseDir) as Record<string, unknown>;
      const message = new AIMessage({
        content: '',
        tool_calls: [{ id: `scripted-${toolResults + 1}-${Date.now()}`, name: step.tool, args, type: 'tool_call' }],
      });
      return { generations: [{ text: '', message }] };
    }
    return reply(turn.reply);
  }
}

function reply(text: string): ChatResult {
  return { generations: [{ text, message: new AIMessage({ content: text }) }] };
}

/**
 * Build the scripted model from the environment. Throws in production and
 * when the script is missing, because a silent fallback here would be a
 * chatbot that says the same sentence to every customer.
 */
export function buildScriptedChatModel(): ScriptedChatModel {
  if (process.env.NODE_ENV === 'production' && process.env.VOCION_ALLOW_SCRIPTED_MODEL !== '1') {
    throw new Error('VOCION_LLM_PROVIDER=scripted is refused in production');
  }
  const file = process.env.VOCION_LLM_SCRIPT;
  if (!file) {
    throw new Error('VOCION_LLM_PROVIDER=scripted needs VOCION_LLM_SCRIPT=<path to a script JSON>');
  }
  const { baseDir, ...script } = loadScript(file);
  return new ScriptedChatModel({ script, baseDir });
}
