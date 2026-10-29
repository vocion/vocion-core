import type { AIMessage, AIMessageChunk } from '@langchain/core/messages';
/**
 * Running the `agent-behaviour` eval (ADR 0009): one case, one tool-loading
 * mode, one level, against the real model with the agent's real tool
 * catalog, its real descriptions and schemas, loaded the way
 * `harness.ts` loads them, answered from made-up data (`stubs.ts`).
 *
 * The agent loop is this file's own: a few model calls, each answered with
 * tool results. It is not the deepagents graph, because the graph needs a
 * database, a workspace and connectors, and an eval of tool loading needs
 * none of them. What the model sees is what loading decides: the tools,
 * deferred or not, the search, and the search note. The platform's shared
 * prompt rules and the per-turn middleware are not here (ADR 0009, "what
 * the eval does not cover").
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { EvalAgent, EvalCase, EvalLevel } from './dataset';
import type { CaseRun } from './score';
import type { ToolLoading } from '@/services/agents/toolLoading';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { tool as makeTool } from '@langchain/core/tools';
import { z } from 'zod';
import { buildChatModel } from '@/libs/llm';
import { systemWithPrefixBreakpoint } from '@/libs/llm/promptCache';
import { modelIdOf, tokenUsageOf } from '@/libs/llm/usage';
import { tokenCostCents } from '@/libs/pricing';
import { emptyTurnToolStats, noteModelToolUse, planToolLoading, toolSearchNote } from '@/services/agents/toolLoading';
import { catalogContext } from '@/services/agents/toolMeasure';
import { expandGrants } from '@/services/agents/tools/grantGroups';
import { buildDomainTools } from '@/services/agents/tools/registry';
import { canonicalToolNames } from '@/services/agents/tools/toolAliases';
import { deferColdTools, namedInPrompt, TOOL_SEARCH } from '@/services/agents/toolTiers';
import { stubAnswer } from './stubs';

/** How many model calls a case may make. */
const MAX_STEPS = 6;

/**
 * The model each level runs on, as the platform picks it (`effort.ts`): Quick on the fast model with thinking off, Standard on the main model.
 * @param level - Quick or Standard.
 */
export function levelModel(level: EvalLevel): { role: 'classifier' | 'main'; thinking?: 'off' } {
  return level === 'quick' ? { role: 'classifier', thinking: 'off' } : { role: 'main' };
}

/**
 * The agent's tools, each answering from the stubs, with the real name,
 * description, schema and tags.
 * @param agent - The eval agent.
 */
export function evalTools(agent: EvalAgent): StructuredToolInterface[] {
  return buildDomainTools(catalogContext(agent)).map(t => makeTool(
    async (args: Record<string, unknown>) => stubAnswer(t.name, args ?? {}),
    { name: t.name, description: t.description ?? '', schema: t.schema as z.ZodObject, metadata: { ...(t as { metadata?: Record<string, unknown> }).metadata } },
  ) as unknown as StructuredToolInterface);
}

/**
 * The tools the model is handed in a mode, with the system prompt it reads.
 * The same plan `harness.ts` makes for a live turn on the direct Anthropic API.
 * @param agent - The eval agent.
 * @param mode - The tool-loading mode.
 * @param tools - `evalTools(agent)`.
 */
export function loadForMode(agent: EvalAgent, mode: ToolLoading, tools: StructuredToolInterface[]) {
  const names = tools.map(t => t.name);
  const plan = planToolLoading({
    mode,
    tools,
    hot: agent.history,
    grants: canonicalToolNames(expandGrants(agent.grantTools)),
    named: canonicalToolNames(namedInPrompt(agent.systemPrompt, names)),
  });
  if (!plan.keep) {
    return { plan, tools, systemPrompt: agent.systemPrompt };
  }
  const search = makeTool(async () => '', { name: TOOL_SEARCH.name, description: 'Server-side tool search.', schema: z.object({}), extras: { providerToolDefinition: TOOL_SEARCH } }) as unknown as StructuredToolInterface;
  return { plan, tools: deferColdTools(tools, plan.keep, search), systemPrompt: `${agent.systemPrompt}\n\n${toolSearchNote(plan)}` };
}

/** What the loop needs of a model: tools bound, a streamed reply. A test passes a scripted one. */
type StreamingModel = { bindTools: (tools: unknown[]) => { stream: (messages: unknown[]) => Promise<AsyncIterable<AIMessageChunk>> } };

function hasContent(chunk: AIMessageChunk): boolean {
  const c = chunk.content;
  return (typeof c === 'string' ? c.length > 0 : Array.isArray(c) && c.length > 0) || (chunk.tool_call_chunks?.length ?? 0) > 0;
}

function textOf(message: AIMessage | AIMessageChunk): string {
  const c = message.content;
  if (typeof c === 'string') {
    return c;
  }
  return (c as Array<{ type?: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text ?? '').join('');
}

/**
 * Run one case and say what it did. Never throws: a provider failure is
 * recorded as `crashed` and the run is not graded.
 * @param opts - The case, its agent, the mode and level, and the model to use.
 * @param opts.agent - The eval agent.
 * @param opts.evalCase - The case.
 * @param opts.mode - Tool loading.
 * @param opts.level - Quick or Standard.
 * @param opts.model - A model to use instead of the level's (tests pass a scripted one).
 */
export async function runCase(opts: { agent: EvalAgent; evalCase: EvalCase; mode: ToolLoading; level: EvalLevel; model?: StreamingModel }): Promise<CaseRun> {
  const { agent, evalCase, mode, level } = opts;
  const allTools = evalTools(agent);
  const { plan, tools, systemPrompt } = loadForMode(agent, mode, allTools);
  const byName = new Map(allTools.map(t => [t.name, t]));
  const known = new Set(allTools.map(t => t.name));
  const stats = emptyTurnToolStats();
  const spec = levelModel(level);
  const model = opts.model ?? buildChatModel(spec.role, { provider: 'anthropic', ...(spec.thinking ? { thinking: spec.thinking } : {}) });
  const bound = (model as unknown as StreamingModel).bindTools(tools);
  // The prefix breakpoint a live turn's system prompt carries, so a case's
  // first call reads the agent's prefix from the cache as production does.
  const messages: unknown[] = [systemWithPrefixBreakpoint(systemPrompt), new HumanMessage(evalCase.message)];
  const calls: CaseRun['calls'] = [];
  const startedAt = Date.now();
  let firstTokenMs = 0;
  let cents = 0;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let warm = false;
  let answer = '';
  const base = { caseId: evalCase.id, agent: agent.slug, kind: evalCase.kind, mode, level, loaded: plan.loaded, deferred: plan.deferred, overBudget: plan.overBudget };
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const callStarted = Date.now();
      let message: AIMessageChunk | undefined;
      for await (const chunk of await bound.stream(messages)) {
        if (step === 0 && !firstTokenMs && hasContent(chunk)) {
          firstTokenMs = Date.now() - callStarted;
        }
        message = message ? message.concat(chunk) : chunk;
      }
      if (!message) {
        break;
      }
      const usage = tokenUsageOf(message);
      if (usage) {
        // A streamed message may not name its model; the model built for the level does.
        const modelId = modelIdOf(message) ?? String((model as { model?: string }).model ?? '');
        cents += tokenCostCents(modelId, usage);
        inputTokens += usage.inputTokens ?? 0;
        cacheReadTokens += usage.cacheReadTokens ?? 0;
        if (step === 0) {
          warm = (usage.cacheReadTokens ?? 0) > 0;
        }
      }
      noteModelToolUse(stats, message, known);
      messages.push(message);
      const text = textOf(message);
      if (text.trim()) {
        answer = text;
      }
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        break;
      }
      for (const call of toolCalls) {
        const input = (call.args ?? {}) as Record<string, unknown>;
        const t = byName.get(call.name);
        if (!t) {
          stats.toolErrors += 1;
          calls.push({ tool: call.name, input, error: true });
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', name: call.name, status: 'error', content: `Error: ${call.name} is not a valid tool.` }));
          continue;
        }
        try {
          const out = await t.invoke(input);
          calls.push({ tool: call.name, input, error: false });
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', name: call.name, content: typeof out === 'string' ? out : JSON.stringify(out) }));
        } catch (error) {
          stats.toolErrors += 1;
          calls.push({ tool: call.name, input, error: true });
          messages.push(new ToolMessage({ tool_call_id: call.id ?? '', name: call.name, status: 'error', content: `Error: ${(error as Error).message}` }));
        }
      }
    }
    return { ...base, answer, calls, ...stats, firstTokenMs, totalMs: Date.now() - startedAt, cents, inputTokens, cacheReadTokens, warm };
  } catch (error) {
    return { ...base, answer, calls, ...stats, firstTokenMs, totalMs: Date.now() - startedAt, cents, inputTokens, cacheReadTokens, warm, crashed: (error as Error).message.slice(0, 300) };
  }
}
