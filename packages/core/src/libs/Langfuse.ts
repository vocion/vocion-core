import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs';
import type { FeatureName } from './Langfuse/features';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { Langfuse } from 'langfuse';

const globalForLangfuse = globalThis as unknown as {
  langfuse: Langfuse | undefined;
};

export const langfuse = globalForLangfuse.langfuse ?? new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY || 'pk-lf-vocion-demo',
  secretKey: process.env.LANGFUSE_SECRET_KEY || 'sk-lf-vocion-demo',
  baseUrl: process.env.LANGFUSE_BASE_URL || 'http://localhost:3200',
});

if (process.env.NODE_ENV !== 'production') {
  globalForLangfuse.langfuse = langfuse;
}

/* ------------------------------------------------------------------ */
/* traceFor — single helper that stamps the standard dimensions       */
/* ------------------------------------------------------------------ */

/**
 * Create a Langfuse trace with the standard Vocion tagging shape:
 *
 *   name      = `${feature}:${slug}`
 *   userId    = caller-supplied (never undefined — use 'system' /
 *               'worker' / 'eval-runner' / 'mcp' for non-interactive)
 *   metadata  = { orgId, feature, slug, ...callerMetadata }
 *   tags      = [`feature:${feature}`, `org:${orgId}`, `slug:${slug}`]
 *
 * The shape lets the Langfuse UI slice cost/volume by org, user,
 * feature, or specific agent/operation without per-feature query
 * gymnastics. Every new LLM path should go through this.
 */
export type TraceFor = {
  feature: FeatureName;
  slug: string;
  orgId: string;
  userId: string;
  input?: unknown;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type TraceLike = ReturnType<typeof langfuse.trace>;

/**
 * Drop undefined values from a usage map; Langfuse's
 * `usageDetails: { [k: string]: number }` schema rejects undefined.
 * @param input
 */
export function cleanUsageDetails(input: Record<string, number | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Push a user-feedback score onto an existing trace. Used by
 * SkillService to forward thumbs-up/down + review approve/reject into
 * Langfuse so dashboards can filter low-quality runs and track trends
 * over time. Per the Langfuse "user-feedback" skill: score names
 * reflect the signal *source*, not what we hope it measures.
 *
 *   - `user-thumbs`     — 1 (up) / 0 (down). BOOLEAN.
 *   - `review-decision` — 1 (approved) / 0 (rejected). BOOLEAN.
 *
 * Errors are swallowed by design — observability should never fail a
 * write. Returns true when the call was dispatched (still subject to
 * background flush success), false on a recognized skip.
 */
export function pushScore(opts: {
  traceId: string | null | undefined;
  name: 'user-thumbs' | 'review-decision';
  value: 0 | 1;
  comment?: string | null;
}): boolean {
  if (!opts.traceId) {
    return false;
  }
  try {
    langfuse.score({
      traceId: opts.traceId,
      name: opts.name,
      value: opts.value,
      dataType: 'BOOLEAN',
      comment: opts.comment ?? undefined,
    });
    return true;
  } catch {
    return false;
  }
}

export function traceFor(opts: TraceFor): TraceLike {
  return langfuse.trace({
    name: `${opts.feature}:${opts.slug}`,
    input: opts.input,
    userId: opts.userId,
    sessionId: opts.sessionId,
    metadata: {
      orgId: opts.orgId,
      feature: opts.feature,
      slug: opts.slug,
      ...opts.metadata,
    },
    tags: [`feature:${opts.feature}`, `org:${opts.orgId}`, `slug:${opts.slug}`],
  });
}

/* ------------------------------------------------------------------ */
/* LangChain → Langfuse callback adapter                              */
/* ------------------------------------------------------------------ */

// `langfuse-langchain@3.x` peer-pins langchain v0.x and has not yet
// been updated for LangChain v1. We use LangChain v1 via deepagents.
// This adapter wraps the existing `langfuse@^3` core SDK with a small
// BaseCallbackHandler that speaks LangChain's callback events.
// Decision: docs/internal/adr/0001-langchain-deepagents.md.

type GenerationLike = ReturnType<TraceLike['generation']>;
type SpanLike = ReturnType<TraceLike['span']>;

export type CreateLangfuseCallbackOptions = TraceFor & {
  /**
   * Optional per-turn usage hook. Called from `handleLLMEnd` with the
   * model + token usage so callers (e.g. BudgetService) can charge
   * budgets without intercepting the LangChain runnable directly.
   */
  onTurnEnd?: (turn: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
  }) => void | Promise<void>;
};

export type LangfuseCallback = {
  handler: BaseCallbackHandler;
  trace: TraceLike;
};

export function createLangfuseCallback(
  opts: CreateLangfuseCallbackOptions,
): LangfuseCallback {
  const trace = traceFor(opts);

  const generations = new Map<string, GenerationLike>();
  const spans = new Map<string, SpanLike>();

  const messagesToInput = (msgs: BaseMessage[][] | BaseMessage[]): unknown => {
    const flat = Array.isArray(msgs[0]) ? (msgs[0] as BaseMessage[]) : (msgs as BaseMessage[]);
    return flat.map(m => ({
      role: m.getType?.() ?? 'unknown',
      content: typeof m.content === 'string' ? m.content : m.content,
    }));
  };

  class Adapter extends BaseCallbackHandler {
    override name = 'LangfuseAdapter';

    override async handleChatModelStart(
      llm: Serialized,
      messages: BaseMessage[][],
      runId: string,
      _parentRunId?: string,
      extraParams?: Record<string, unknown>,
    ): Promise<void> {
      const model = (extraParams?.invocation_params as { model?: string } | undefined)?.model
        ?? (llm.id?.[llm.id.length - 1] as string | undefined)
        ?? 'unknown';
      const gen = trace.generation({
        name: `chat:${model}`,
        model,
        input: messagesToInput(messages),
        // Langfuse modelParameters expects flat primitives; serialize
        // arbitrary invocation params through metadata instead.
        metadata: { ...opts.metadata, invocationParams: extraParams ?? undefined },
      });
      generations.set(runId, gen);
    }

    override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
      const gen = generations.get(runId);
      if (!gen) {
        return;
      }
      const firstGen = output.generations?.[0]?.[0] as ChatGeneration | undefined;
      const llmOutput = (output.llmOutput ?? {}) as {
        model?: string;
        tokenUsage?: { promptTokens?: number; completionTokens?: number };
        // Anthropic surfaces usage on llmOutput.usage with cache fields.
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      };
      const usage = llmOutput.tokenUsage;
      const anthropicUsage = llmOutput.usage;
      // Langfuse v3: `usage` is deprecated; `usageDetails` is the free-
      // form numeric map their cost engine reads. Stamp the canonical
      // keys (`input`, `output`, `cache_read_input_tokens`) so Anthropic
      // prompt-caching bills correctly (~10x discount on cached input).
      const usageDetails: Record<string, number> | undefined = usage
        ? cleanUsageDetails({
            input: usage.promptTokens,
            output: usage.completionTokens,
          })
        : anthropicUsage
          ? cleanUsageDetails({
              input: anthropicUsage.input_tokens,
              output: anthropicUsage.output_tokens,
              cache_read_input_tokens: anthropicUsage.cache_read_input_tokens,
            })
          : undefined;
      gen.end({
        output: firstGen?.text ?? output.generations,
        usageDetails,
      });
      generations.delete(runId);
      if (opts.onTurnEnd) {
        try {
          await opts.onTurnEnd({
            model: llmOutput.model ?? 'unknown',
            inputTokens: usage?.promptTokens ?? anthropicUsage?.input_tokens,
            outputTokens: usage?.completionTokens ?? anthropicUsage?.output_tokens,
            cacheReadTokens: anthropicUsage?.cache_read_input_tokens,
          });
        } catch {
          /* never let the budget hook break the agent run */
        }
      }
    }

    override async handleLLMError(err: Error, runId: string): Promise<void> {
      const gen = generations.get(runId);
      if (!gen) {
        return;
      }
      gen.end({
        level: 'ERROR',
        statusMessage: err.message,
      });
      generations.delete(runId);
    }

    override async handleToolStart(
      tool: Serialized,
      input: string,
      runId: string,
    ): Promise<void> {
      const toolName = (tool.id?.[tool.id.length - 1] as string | undefined) ?? 'tool';
      const span = trace.span({
        name: `tool:${toolName}`,
        input,
        metadata: opts.metadata,
      });
      spans.set(runId, span);
    }

    override async handleToolEnd(output: string, runId: string): Promise<void> {
      const span = spans.get(runId);
      if (!span) {
        return;
      }
      span.end({ output });
      spans.delete(runId);
    }

    override async handleToolError(err: Error, runId: string): Promise<void> {
      const span = spans.get(runId);
      if (!span) {
        return;
      }
      span.end({ level: 'ERROR', statusMessage: err.message });
      spans.delete(runId);
    }

    override async handleChainStart(
      chain: Serialized,
      _inputs: Record<string, unknown>,
      runId: string,
      parentRunId?: string,
    ): Promise<void> {
      // Pregel/runnable plumbing produces a noisy storm of chain
      // events. Filter to top-level chains and named subagent dispatches.
      const chainName = (chain.id?.[chain.id.length - 1] as string | undefined) ?? '';
      const isSubagent = chainName.toLowerCase().includes('subagent')
        || chainName.toLowerCase().includes('task');
      if (parentRunId && !isSubagent) {
        return;
      }
      const span = trace.span({
        name: `chain:${chainName || 'unnamed'}`,
        metadata: opts.metadata,
      });
      spans.set(runId, span);
    }

    override async handleChainEnd(outputs: Record<string, unknown>, runId: string): Promise<void> {
      const span = spans.get(runId);
      if (!span) {
        return;
      }
      span.end({ output: outputs });
      spans.delete(runId);
    }

    override async handleChainError(err: Error, runId: string): Promise<void> {
      const span = spans.get(runId);
      if (!span) {
        return;
      }
      span.end({ level: 'ERROR', statusMessage: err.message });
      spans.delete(runId);
    }
  }

  return { handler: new Adapter(), trace };
}
