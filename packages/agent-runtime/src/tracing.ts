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
  /**
   * Every input token the turn was billed for, cached ones included. Both the
   * vendors this runtime talks to report the UNCACHED remainder under their own
   * `input_tokens`, so the reader below adds the cache counts back; core's
   * pricing takes this field to mean the whole input side and subtracts them
   * off it again.
   */
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens served from the vendor's prompt cache, billed at 0.1x. */
  cacheReadTokens?: number;
  /**
   * Input tokens written into the vendor's prompt cache, billed at 1.25x.
   * Carried separately because a write costs MORE than a plain input token, so
   * folding it into `inputTokens` undercharges the first turn of every run.
   */
  cacheWriteTokens?: number;
};

/**
 * Usage as LangChain normalises it onto a model response message.
 *
 * The same shape core reads in `libs/llm/usage.ts`, for the same reason: it is
 * the only one every provider fills in. Bedrock returns no `llmOutput` at all
 * on a non-streamed generation, so a reader that looks only at `llmOutput`
 * sees nothing on the very path this runtime is deployed for, and the turn goes
 * out with no usage at all.
 */
type LangChainUsageMetadata = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number; cache_creation?: number };
};

/**
 * Usage off a model response message, or null when it carries none.
 *
 * `input_tokens` here already includes both cache counts — LangChain's Bedrock
 * adapter adds them onto the uncached remainder Converse reports — so nothing
 * is summed on this path.
 * @param message - The generation's message, whatever shape it arrived in.
 */
function normalisedUsageOf(message: unknown): TurnUsage | null {
  const usage = (message as { usage_metadata?: LangChainUsageMetadata } | undefined)?.usage_metadata;
  if (!usage || (usage.input_tokens === undefined && usage.output_tokens === undefined)) {
    return null;
  }
  return {
    model: 'unknown',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.input_token_details?.cache_read,
    cacheWriteTokens: usage.input_token_details?.cache_creation,
  };
}

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
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      };
      const usage = llmOutput.tokenUsage;
      const anthropicUsage = llmOutput.usage;
      const firstGen = output.generations?.[0]?.[0] as ChatGeneration | undefined;
      // Normalised first, the two llmOutput shapes as the fallback. Same order
      // core's adapter settled on, and for the same reason — see
      // `normalisedUsageOf` above.
      const normalised = normalisedUsageOf(firstGen?.message);
      // Anthropic's `input_tokens` is the uncached remainder, so the cache
      // counts are added back to make this mean the whole input side.
      const anthropicInputTokens = anthropicUsage?.input_tokens === undefined
        ? undefined
        : anthropicUsage.input_tokens
          + (anthropicUsage.cache_read_input_tokens ?? 0)
          + (anthropicUsage.cache_creation_input_tokens ?? 0);

      const gen = generations.get(runId);
      if (gen) {
        const usageDetails = normalised
          ? cleanUsage({
              input: normalised.inputTokens,
              output: normalised.outputTokens,
              cache_read_input_tokens: normalised.cacheReadTokens,
              cache_creation_input_tokens: normalised.cacheWriteTokens,
            })
          : usage
            ? cleanUsage({ input: usage.promptTokens, output: usage.completionTokens })
            : anthropicUsage
              ? cleanUsage({
                  input: anthropicInputTokens,
                  output: anthropicUsage.output_tokens,
                  cache_read_input_tokens: anthropicUsage.cache_read_input_tokens,
                  cache_creation_input_tokens: anthropicUsage.cache_creation_input_tokens,
                })
              : undefined;
        gen.end({ output: firstGen?.text ?? output.generations, usageDetails });
        generations.delete(runId);
      }

      try {
        opts.onTurnEnd({
          model: llmOutput.model ?? 'unknown',
          inputTokens: normalised?.inputTokens ?? usage?.promptTokens ?? anthropicInputTokens,
          outputTokens: normalised?.outputTokens ?? usage?.completionTokens ?? anthropicUsage?.output_tokens,
          cacheReadTokens: normalised?.cacheReadTokens ?? anthropicUsage?.cache_read_input_tokens,
          cacheWriteTokens: normalised?.cacheWriteTokens ?? anthropicUsage?.cache_creation_input_tokens,
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
