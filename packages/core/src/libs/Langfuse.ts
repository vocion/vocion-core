import type { Serialized } from '@langchain/core/load/serializable';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs';
import type { LangfuseConfig } from './Langfuse/config';
import type { FeatureName } from './Langfuse/features';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { Langfuse } from 'langfuse';
import { resolveLangfuseConfig } from './Langfuse/config';

/* ------------------------------------------------------------------ */
/* Client — created on first use, never at import time                */
/* ------------------------------------------------------------------ */

/**
 * Importing this module must not construct a Langfuse client.
 *
 * It used to. The client was built at module scope with fallback
 * credentials, so any process that imported anything downstream of this
 * file — including a build step or a CLI script — opened a tracer
 * pointed at whatever `LANGFUSE_BASE_URL` happened to be, usually
 * `localhost:3200` in a container where nothing listens on that port.
 * Traces then failed silently for the life of the deployment.
 *
 * Now the client appears on the first traced call, and only when
 * `libs/Langfuse/config.ts` says tracing is on. Same treatment the
 * OpenAI client got in v0.5.0.
 */
const cachedState = globalThis as unknown as {
  vocionLangfuseClient?: Langfuse | null;
  vocionLangfuseConfig?: LangfuseConfig;
  vocionLangfuseLoggedState?: boolean;
};

/**
 * Log through a dynamic import.
 *
 * `libs/Logger` has a top-level await and this file sits in the import
 * chain of CLI scripts that tsx compiles as CommonJS, where that is
 * fatal. Same approach as `libs/retrieval/embedder.ts`.
 * @param level - Which logger method to call.
 * @param message - What happened, in plain words.
 * @param properties - Identifiers and context worth keeping.
 */
function log(
  level: 'info' | 'warn',
  message: string,
  properties: Record<string, unknown> = {},
): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}

/**
 * The resolved configuration for this process, computed once.
 *
 * Cached on `globalThis` so Next.js hot reloads and the several entry
 * points that import this module share one answer, and so the
 * "tracing is off" line is logged once rather than per call.
 */
export function langfuseConfig(): LangfuseConfig {
  if (!cachedState.vocionLangfuseConfig) {
    cachedState.vocionLangfuseConfig = resolveLangfuseConfig();
  }
  return cachedState.vocionLangfuseConfig;
}

/** Whether traced calls will actually reach Langfuse. */
export function isTracingEnabled(): boolean {
  return langfuseConfig().enabled;
}

/**
 * The Langfuse client, or null when tracing is off.
 *
 * Callers inside this module branch on null. Callers outside it should
 * use `traceFor`, `pushScore` or `flushTraces`, which already handle the
 * disabled case.
 */
export function getLangfuseClient(): Langfuse | null {
  if (cachedState.vocionLangfuseClient !== undefined) {
    return cachedState.vocionLangfuseClient;
  }

  const config = langfuseConfig();

  if (!config.enabled) {
    if (!cachedState.vocionLangfuseLoggedState) {
      cachedState.vocionLangfuseLoggedState = true;
      log('info', 'Langfuse tracing is off', { reason: config.reason });
    }
    cachedState.vocionLangfuseClient = null;
    return null;
  }

  const client = new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
  });

  if (!cachedState.vocionLangfuseLoggedState) {
    cachedState.vocionLangfuseLoggedState = true;
    log('info', 'Langfuse tracing is on', {
      baseUrl: config.baseUrl,
      projectId: config.projectId,
    });
  }

  cachedState.vocionLangfuseClient = client;
  return client;
}

/**
 * Flush queued traces and wait for the send to finish.
 *
 * The SDK batches in the background, so a short-lived process (a
 * serverless request, a script, a Temporal activity) has to flush before
 * it exits or the traces are lost. A no-op when tracing is off.
 *
 * This replaces the old exported `langfuse` singleton — flushing was the
 * only thing callers outside this module used it for.
 */
export async function flushTraces(): Promise<void> {
  const client = getLangfuseClient();
  if (!client) {
    return;
  }
  try {
    await client.flushAsync();
  } catch (error) {
    // Losing traces must never fail the work that produced them.
    log('warn', 'Langfuse flush failed; traces for this run may be missing', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Reset the cached client and config. Tests only — each case needs to
 * resolve configuration against its own environment variables.
 */
export function resetLangfuseForTests(): void {
  cachedState.vocionLangfuseClient = undefined;
  cachedState.vocionLangfuseConfig = undefined;
  cachedState.vocionLangfuseLoggedState = undefined;
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

export type TraceLike = ReturnType<Langfuse['trace']>;

/**
 * Drop undefined values from a usage map; Langfuse's
 * `usageDetails: { [k: string]: number }` schema rejects undefined.
 * @param input - Token counts, some of which may be undefined.
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
 * @param opts - The score to record.
 * @param opts.traceId - Trace the score attaches to; null skips the push.
 * @param opts.name - Which signal this is, by its source.
 * @param opts.value - 1 for positive, 0 for negative.
 * @param opts.comment - Free text the reviewer left, if any.
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
  const client = getLangfuseClient();
  if (!client) {
    return false;
  }
  try {
    client.score({
      traceId: opts.traceId,
      name: opts.name,
      value: opts.value,
      dataType: 'BOOLEAN',
      comment: opts.comment ?? undefined,
    });
    return true;
  } catch (error) {
    log('warn', 'Langfuse score push failed', {
      traceId: opts.traceId,
      scoreName: opts.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Disabled tracing — a stand-in with the same shape                  */
/* ------------------------------------------------------------------ */

/**
 * A trace that accepts every call and records nothing.
 *
 * Callers build spans and generations off whatever `traceFor` returns
 * and read `trace.id` to store alongside their rows. Handing back this
 * stand-in when tracing is off keeps all of that code branch-free, at
 * the cost of one cast: the object implements the members Vocion
 * actually uses, not the whole SDK surface.
 *
 * `id` is a real random identifier rather than a fixed string, so a
 * `traceId` column filled while tracing was off still has unique
 * values and does not collide across rows.
 */
function createDisabledTrace(): TraceLike {
  const disabledStep = {
    id: crypto.randomUUID(),
    end: () => disabledStep,
    update: () => disabledStep,
    generation: () => disabledStep,
    span: () => disabledStep,
    event: () => disabledStep,
    score: () => disabledStep,
  };

  const disabledTrace = {
    id: crypto.randomUUID(),
    update: () => disabledTrace,
    generation: () => disabledStep,
    span: () => disabledStep,
    event: () => disabledStep,
    score: () => disabledTrace,
    getTraceUrl: () => '',
  };

  return disabledTrace as unknown as TraceLike;
}

export function traceFor(opts: TraceFor): TraceLike {
  const client = getLangfuseClient();
  if (!client) {
    return createDisabledTrace();
  }
  return client.trace({
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
