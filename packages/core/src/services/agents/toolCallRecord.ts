/**
 * Tool-call activity record — one row per domain-tool invocation.
 *
 * Wraps every tool `buildDomainTools` returns, at the registry, so the
 * record is provider-agnostic: tools execute in core under all three
 * harness providers (local loop, AgentCore harness, BYOA runtime), and
 * the registry is the single choke point they share. LangChain's
 * `wrapToolCall` middleware would only catch the in-process loop.
 *
 * Attribution reuses the traceEmitter's checkpoint_ns convention: a ns
 * containing '|' belongs to the specialist dispatched by the `task`
 * call whose id precedes the first '|'. The per-request
 * `ctx.delegations` map (taskId → specialist name, fed by the stream
 * loop) resolves that id to the acting agent.
 *
 * A logging failure is caught and reported, never propagated — the row
 * is a record of the turn, not a participant in it.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from './types';
import { db } from '@/libs/DB';
import { stopReasonOfMessage } from '@/libs/llm/stopReason';
import { getCurrentWorkspaceSha } from '@/libs/workspace';
import { toolCallSchema } from '@/models/Schema';
import { noteTurnRead } from '@/services/gates/turnReads';
import { taskIdOf } from './traceEmitter';

/** Output rows stay readable, not exhaustive — full payloads live in the trace. */
const OUTPUT_CAP = 10_000;

/** Minimal view of the RunnableConfig a tool invocation receives. */
type InvokeConfig = {
  metadata?: { checkpoint_ns?: unknown } & Record<string, unknown>;
} & Record<string, unknown>;

function nsFromConfig(config: unknown): string {
  const cp = (config as InvokeConfig | undefined)?.metadata?.checkpoint_ns;
  if (typeof cp === 'string') {
    return cp;
  }
  if (Array.isArray(cp)) {
    return cp.join('|');
  }
  return '';
}

/**
 * The model's args, whether invoke got plain input or a full ToolCall object.
 * @param input
 */
function normalizeInput(input: unknown): Record<string, unknown> {
  const maybeToolCall = input as { type?: string; args?: unknown } | null | undefined;
  const raw = maybeToolCall?.type === 'tool_call' ? maybeToolCall.args : input;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * String view of a tool result: string, ToolMessage, Command, or anything else.
 * @param output
 */
function normalizeOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  const o = output as { content?: unknown; update?: { messages?: Array<{ content?: unknown }> } } | null | undefined;
  if (o && typeof o.content === 'string') {
    return o.content;
  }
  const cmdMsg = o?.update?.messages?.[0]?.content;
  if (typeof cmdMsg === 'string') {
    return cmdMsg;
  }
  try {
    return JSON.stringify(output) ?? '';
  } catch {
    return '';
  }
}

/**
 * Whether an error is the tool refusing its INPUT (schema validation), as
 * opposed to the tool's own work failing.
 * @param err - What the invocation threw.
 */
export function isSchemaMiss(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  return e?.name === 'ToolInputParsingException' || /did not match expected schema/i.test(e?.message ?? '');
}

/**
 * What a tool may say about its own arguments, beside its schema. Set on the
 * tool object (see {@link withArgumentRepair}); the wrapper reads both.
 */
export type ArgumentRepair = {
  /**
   * The call the model meant, from the call it sent — applied BEFORE the
   * schema reads the arguments, so LangChain's own validation sees the
   * repaired call. A zod transform would do the same job, but a transform
   * cannot be sent to the model as JSON Schema (#731).
   */
  normalizeArgs?: (args: unknown) => unknown;
  /** The refusal to send when a call still misses the schema, naming what is wrong; null for the generic one. */
  explainSchemaMiss?: (args: unknown) => string | null;
};

/**
 * Attach argument repair to a tool.
 * @param toolObj - The tool.
 * @param repair - Its normaliser and its refusal.
 */
export function withArgumentRepair<T extends object>(toolObj: T, repair: ArgumentRepair): T {
  return Object.assign(toolObj, repair);
}

/**
 * The same invocation input with the model's arguments repaired, whether it
 * is a full ToolCall or plain arguments.
 * @param input - What invoke was given.
 * @param normalize - The tool's normaliser.
 */
function repairedInput(input: unknown, normalize: (args: unknown) => unknown): unknown {
  const call = input as { type?: string; args?: unknown } | null | undefined;
  try {
    return call?.type === 'tool_call' ? { ...call, args: normalize(call.args) } : normalize(input);
  } catch {
    return input;
  }
}

/**
 * Why the model stopped writing the message that made this call —
 * `tool_use`, `end_turn`, `max_tokens` — read off the AI message in the
 * graph state the tool node hands down. Undefined when it cannot be read.
 *
 * Recorded because a propose_action call whose `action_input` stopped
 * mid-value (conversation 349, 2026-09-28) could not be explained after the
 * fact: the trace kept the tokens (800 of a 4,096 cap) and not the reason.
 * @param config - The invocation config.
 * @param callId - The tool call's id.
 */
export function stopReasonFor(config: unknown, callId: string | undefined): string | undefined {
  if (!callId) {
    return undefined;
  }
  const messages = (config as { state?: { messages?: unknown[] } } | undefined)?.state?.messages;
  if (!Array.isArray(messages)) {
    return undefined;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { tool_calls?: Array<{ id?: string }> } | null;
    if (m?.tool_calls?.some(c => c.id === callId)) {
      return stopReasonOfMessage(m);
    }
  }
  return undefined;
}

export type ToolCallRecord = {
  ctx: RuntimeContext;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  durationMs: number;
  /** checkpoint_ns of the invocation, for specialist attribution. */
  ns: string;
};

/**
 * Persist one tool_call row. Never throws — a failed write is logged
 * and dropped so the turn is unaffected.
 * @param rec
 */
export async function persistToolCall(rec: ToolCallRecord): Promise<void> {
  try {
    const { ctx } = rec;
    const taskId = taskIdOf(rec.ns);
    const specialist = taskId ? ctx.delegations?.get(taskId) : undefined;
    const workspaceSha = await getCurrentWorkspaceSha(ctx.orgId).catch(() => null);
    await db.insert(toolCallSchema).values({
      orgId: ctx.orgId,
      agentSlug: taskId ? (specialist ?? 'specialist') : (ctx.agentSlug ?? 'unknown'),
      leadAgentSlug: taskId ? (ctx.agentSlug ?? null) : null,
      tool: rec.tool,
      input: rec.input,
      output: rec.output?.slice(0, OUTPUT_CAP) ?? null,
      error: rec.error ?? null,
      durationMs: rec.durationMs,
      conversationId: ctx.conversationId ?? null,
      missionRunId: ctx.missionRunId ?? null,
      provider: ctx.provider ?? 'local',
      langfuseTraceId: ctx.traceId ?? null,
      workspaceSha,
      createdBy: ctx.userId ?? null,
    });
  } catch (err) {
    // Reported, never propagated — and console rather than the LogTape
    // logger so the CLI scripts that import the harness stay loadable.
    console.error('[tool_call] record write failed', { error: (err as Error).message, tool: rec.tool, missionRunId: rec.ctx.missionRunId ?? null });
  }
}

/**
 * Wrap one tool so every invocation writes a tool_call row. Mutates the
 * instance's `invoke` in place — tools are freshly constructed per
 * `buildDomainTools` call, so nothing shared is patched.
 * @param toolObj
 * @param ctx
 */
export function withToolCallRecord(
  toolObj: StructuredToolInterface,
  ctx: RuntimeContext,
): StructuredToolInterface {
  const originalInvoke = toolObj.invoke.bind(toolObj);
  const repair = toolObj as ArgumentRepair;
  const wrapped = async (input: unknown, config?: unknown): Promise<unknown> => {
    const started = Date.now();
    const ns = nsFromConfig(config);
    // The model's arguments, repaired where the tool knows how, so the schema
    // reads what the model meant (a JSON string where an object belongs).
    const callInput = repair.normalizeArgs ? repairedInput(input, repair.normalizeArgs) : input;
    try {
      const result = await originalInvoke(callInput as never, config as never);
      // A read is evidence the moment it returns: a filing later in this
      // turn may be refused without it (`services/gates/turnReads.ts`).
      noteTurnRead(ctx, toolObj.name, normalizeInput(callInput), normalizeOutput(result));
      void persistToolCall({
        ctx,
        tool: toolObj.name,
        input: normalizeInput(callInput),
        output: normalizeOutput(result),
        durationMs: Date.now() - started,
        ns,
      });
      return result;
    } catch (err) {
      const call = input as { id?: string; type?: string; args?: unknown } | null;
      const schemaMiss = isSchemaMiss(err);
      // Why the model stopped writing the call, when a call arrives broken.
      const stopReason = schemaMiss ? stopReasonFor(config, call?.id ?? (config as { toolCallId?: string } | undefined)?.toolCallId) : undefined;
      void persistToolCall({
        ctx,
        tool: toolObj.name,
        // As the model sent it: the row is the evidence of what arrived.
        input: normalizeInput(input),
        error: `${(err as Error).message ?? 'unknown error'}${stopReason ? ` [stop_reason: ${stopReason}]` : ''}`,
        durationMs: Date.now() - started,
        ns,
      });
      // A CALL THAT MISSES THE TOOL'S SCHEMA IS AN ANSWER, NOT A CRASH. On
      // 2026-09-27 a review called read_object with no id; the schema threw,
      // and the throw ended the whole mission task 19 seconds in, so the
      // review recorded nothing (run 5631). Nothing ran, so the model is told
      // what was wrong and calls again — the tool's own work still throws.
      if (schemaMiss) {
        const args = call?.type === 'tool_call' ? call.args : input;
        let precise: string | null = null;
        try {
          precise = repair.explainSchemaMiss?.(args) ?? null;
        } catch {}
        const generic = `Not recorded: invalid arguments for ${toolObj.name}: ${(err as Error).message.replace(/^Error invoking tool '[^']+' with kwargs [\s\S]*? with error: /, '').slice(0, 600)}. Nothing ran. Fix the arguments and call ${toolObj.name} again.`;
        const limit = stopReason === 'max_tokens' ? ' Your message reached its output limit while writing this call, which is why it stops early: send a shorter one.' : '';
        const content = `${precise ?? generic}${limit}`;
        // The refusal never reached the rail: LangChain refuses the input
        // before a tool run starts, so no tool event is emitted and the
        // person saw nothing (conversation 349). Say it where they look.
        try {
          ctx.emit({ type: 'tool_error', tool: toolObj.name, message: content.slice(0, 300) });
        } catch {}
        if (call?.type === 'tool_call' && call.id) {
          const { ToolMessage } = await import('@langchain/core/messages');
          return new ToolMessage({ content, tool_call_id: call.id, name: toolObj.name });
        }
        return content;
      }
      throw err;
    }
  };
  (toolObj as { invoke: typeof wrapped }).invoke = wrapped;
  return toolObj;
}
