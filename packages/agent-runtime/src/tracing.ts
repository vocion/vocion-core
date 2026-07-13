/**
 * Langfuse tracing inside the artifact — a slim port of vocion-core's
 * `libs/Langfuse.ts` LangChain adapter (see that file for the full
 * rationale; `langfuse-langchain` still peer-pins LangChain v0).
 *
 * Differences from the core version:
 *   - Budget charging doesn't happen here (no DB): each model turn's
 *     usage is surfaced through `onTurnEnd`, which the loop forwards as
 *     a `usage` event for the caller to charge.
 *   - Tracing is best-effort and OPTIONAL: when LANGFUSE_* env is
 *     absent the adapter degrades to usage-extraction only, so the
 *     deployed artifact works before a reachable Langfuse exists.
 */

import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs';
import process from 'node:process';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { Langfuse } from 'langfuse';

let singleton: Langfuse | null | undefined;

function client(): Langfuse | null {
  if (singleton !== undefined) {
    return singleton;
  }
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  singleton = publicKey && secretKey
    ? new Langfuse({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3200' })
    : null;
  return singleton;
}

function cleanUsage(input: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  return out;
}

export type TurnUsage = {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

export type RuntimeTrace = {
  handler: BaseCallbackHandler;
  traceId: string;
  end: (output: { response?: string; error?: string; toolCalls?: number }) => Promise<void>;
};

export function createRuntimeTrace(opts: {
  agentSlug: string;
  orgId?: string;
  userId?: string;
  sessionId?: string;
  input: unknown;
  onTurnEnd: (turn: TurnUsage) => void;
}): RuntimeTrace {
  const lf = client();
  const trace = lf?.trace({
    name: `agent.chat:${opts.agentSlug}`,
    input: opts.input,
    userId: opts.userId ?? 'system',
    sessionId: opts.sessionId,
    metadata: { orgId: opts.orgId, feature: 'agent.chat', slug: opts.agentSlug, runtime: 'byoa-artifact' },
    tags: ['feature:agent.chat', `org:${opts.orgId ?? 'unknown'}`, `slug:${opts.agentSlug}`],
  });

  type GenerationLike = NonNullable<ReturnType<NonNullable<typeof trace>['generation']>>;
  type SpanLike = NonNullable<ReturnType<NonNullable<typeof trace>['span']>>;
  const generations = new Map<string, GenerationLike>();
  const spans = new Map<string, SpanLike>();

  class Adapter extends BaseCallbackHandler {
    override name = 'RuntimeLangfuseAdapter';

    override async handleChatModelStart(
      llm: Serialized,
      messages: BaseMessage[][],
      runId: string,
      _parentRunId?: string,
      extraParams?: Record<string, unknown>,
    ): Promise<void> {
      if (!trace) {
        return;
      }
      const model = (extraParams?.invocation_params as { model?: string } | undefined)?.model
        ?? (llm.id?.[llm.id.length - 1] as string | undefined)
        ?? 'unknown';
      const flat = (Array.isArray(messages[0]) ? messages[0] : messages) as BaseMessage[];
      const gen = trace.generation({
        name: `chat:${model}`,
        model,
        input: flat.map(m => ({ role: m.getType?.() ?? 'unknown', content: m.content })),
      });
      generations.set(runId, gen);
    }

    override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
      const llmOutput = (output.llmOutput ?? {}) as {
        model?: string;
        tokenUsage?: { promptTokens?: number; completionTokens?: number };
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      const usage = llmOutput.tokenUsage;
      const anthropicUsage = llmOutput.usage;

      const gen = generations.get(runId);
      if (gen) {
        const firstGen = output.generations?.[0]?.[0] as ChatGeneration | undefined;
        const usageDetails = usage
          ? cleanUsage({ input: usage.promptTokens, output: usage.completionTokens })
          : anthropicUsage
            ? cleanUsage({
                input: anthropicUsage.input_tokens,
                output: anthropicUsage.output_tokens,
                cache_read_input_tokens: anthropicUsage.cache_read_input_tokens,
              })
            : undefined;
        gen.end({ output: firstGen?.text ?? output.generations, usageDetails });
        generations.delete(runId);
      }

      try {
        opts.onTurnEnd({
          model: llmOutput.model ?? 'unknown',
          inputTokens: usage?.promptTokens ?? anthropicUsage?.input_tokens,
          outputTokens: usage?.completionTokens ?? anthropicUsage?.output_tokens,
          cacheReadTokens: anthropicUsage?.cache_read_input_tokens,
        });
      } catch {
        /* usage forwarding must never break the run */
      }
    }

    override async handleLLMError(err: Error, runId: string): Promise<void> {
      const gen = generations.get(runId);
      if (gen) {
        gen.end({ level: 'ERROR', statusMessage: err.message });
        generations.delete(runId);
      }
    }

    override async handleToolStart(toolDef: Serialized, input: string, runId: string): Promise<void> {
      if (!trace) {
        return;
      }
      const toolName = (toolDef.id?.[toolDef.id.length - 1] as string | undefined) ?? 'tool';
      spans.set(runId, trace.span({ name: `tool:${toolName}`, input }));
    }

    override async handleToolEnd(output: string, runId: string): Promise<void> {
      spans.get(runId)?.end({ output });
      spans.delete(runId);
    }

    override async handleToolError(err: Error, runId: string): Promise<void> {
      spans.get(runId)?.end({ level: 'ERROR', statusMessage: err.message });
      spans.delete(runId);
    }
  }

  return {
    handler: new Adapter(),
    traceId: trace?.id ?? '',
    end: async (output) => {
      trace?.update({ output });
      await lf?.flushAsync().catch(() => {});
    },
  };
}
