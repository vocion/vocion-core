/**
 * The one model call per changed document.
 *
 * Control flow is `services/agents/skillTurn.ts`, a caller-supplied zod
 * output schema, `{ signal }` on `.invoke`, fences tolerated, one corrective
 * retry, with two deliberate differences:
 *
 *   - **It binds no tools, ever.** `skillTurn` binds a read-only belt; an
 *     extractor reading an untrusted page must have nothing to call. A unit
 *     test asserts `bindTools` is never reached.
 *   - **It pins ONE retry.** `skillTurn` loops to `MAX_MODEL_TURNS = 6`
 *     because it may spend turns on tool calls. There are no tool calls here,
 *     so a second malformed answer is a skip, not a third try.
 *
 * Langfuse gets the RESOLVED model id, not the role name. Every other traced
 * call in the repo passes the role (`model: 'classifier'`), and
 * `langfuse-bootstrap` matches prices on the model name, so those generations
 * cost $0 in the dashboard. Fixing the other five sites is a follow-up; this
 * one is written correctly from the start.
 *
 * The budget slot is taken BEFORE the await. Eight documents run at once under
 * `MAX_CONCURRENT_INGESTS`, so deciding after the call returns is not a cap.
 *
 * How long a call may take is `budget.caps.modelTimeoutMs`, a cap like any
 * other: the default lives in `libs/processors/budget.ts` and a source may
 * only lower it. The outer per-document cap is the processor's own
 * `documentTimeoutMs`, 150s, not the generic 25s.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { SyncBudget } from '../budget';
import type { CandidateExtractorConfig } from './config';
import type { ExtractionPrompt } from './prompt';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModelForOrg, resolvedModelId } from '@/libs/llm/langchain';
import { SERIES_NOTE_CAP } from './prompt';

/** One record as the model returned it, before any validation. */
export type ExtractedRecord = {
  fields: Record<string, unknown>;
  confidence: number;
  sourceUrl?: string;
  imageUrl?: string;
  notes?: string;
  seriesOf?: number;
  duplicateOf?: number;
  /**
   * Why this occurrence does not follow the pattern of the rest of its series,
   * in a few words. Only meaningful alongside `seriesOf`, and dropped by
   * `validate.ts` when that id did not survive.
   */
  seriesNote?: string;
};

export type ExtractionResult
  = | { status: 'ok'; records: ExtractedRecord[]; calls: number; traceId: string | null }
  /** Nothing was extracted, and the reason is a counter name, not prose. */
    | { status: 'skipped'; reason: ExtractionSkip; calls: number; detail?: string; traceId: string | null };

/** Why a document produced nothing. Each is a `counts` key on the run. */
export type ExtractionSkip
  = | 'model_invalid'
    | 'model_timeout'
    | 'budget_model_calls'
    | 'budget_tokens'
    | 'budget_exceeded';

/**
 * A run id as the model may write it: `41`, `"41"`, `"#41"`. Anything else is
 * not an id, and a hallucinated one is caught later against the known block.
 * @param value - Whatever came back in `seriesOf` / `duplicateOf`.
 */
function toRunId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const match = /^#?(\d+)$/.exec(value.trim());
    if (match) {
      const id = Number.parseInt(match[1] as string, 10);
      return id > 0 ? id : undefined;
    }
  }
  return undefined;
}

/** A run reference the model may write in either shape. */
const runRef = z.union([z.number(), z.string()]).optional().transform(toRunId);

/**
 * The envelope the answer must fit.
 *
 * `maxRecordsPerDocument` is enforced HERE rather than by trimming afterwards:
 * a document that claims 400 records is a document that was misread, and the
 * corrective retry is a better answer than silently keeping the first 25.
 * @param maxRecords - The config's `maxRecordsPerDocument`.
 */
function envelopeSchema(maxRecords: number) {
  return z.object({
    records: z.array(z.object({
      fields: z.record(z.string(), z.unknown()).default({}),
      confidence: z.number().min(0).max(1).default(0),
      sourceUrl: z.string().optional(),
      imageUrl: z.string().optional(),
      notes: z.string().max(2000).optional(),
      seriesOf: runRef,
      duplicateOf: runRef,
      // Truncated, never rejected. `notes` above is a hard `.max(2000)`, and a
      // value one character over a hard bound costs the corrective retry and
      // can cost the whole document. A 141-character aside must never cost a
      // card, so this follows `runRef` and transforms instead.
      seriesNote: z.string().optional().transform(value => value?.slice(0, SERIES_NOTE_CAP)),
    })).max(maxRecords).default([]),
  });
}

/**
 * The message content as plain text, whichever shape the provider returned.
 * @param content - A LangChain message's content.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(c => (c as { text?: string }).text ?? '').join('');
  }
  return '';
}

/**
 * Whether a thrown error is the deadline rather than a bad answer.
 * @param error - Whatever `.invoke` threw.
 */
function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** LangChain's normalised usage, including Bedrock's cache breakdown. */
type UsageMetadata = {
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: { cache_read?: number };
};

/**
 * Extract the records one document describes.
 * @param opts - Everything the call needs.
 * @param opts.orgId - Org the call is billed to.
 * @param opts.sourceSlug - Source slug, for the Langfuse trace.
 * @param opts.config - The source's processor config.
 * @param opts.prompt - The two messages (see `prompt.ts`).
 * @param opts.budget - The sync's shared caps.
 * @param opts.signal - The document's own deadline, from the runner.
 * @param opts.trace - What the trace says about the document, never its body.
 * @param opts.trace.uri - Document URL.
 * @param opts.trace.bytes - Document size.
 * @param opts.trace.jsonLdBlocks - How many JSON-LD blocks it carried.
 * @param opts.trace.knownCards - How many known cards the prompt carried.
 */
export async function extractRecords(opts: {
  orgId: string;
  sourceSlug: string;
  config: CandidateExtractorConfig;
  prompt: ExtractionPrompt;
  budget: SyncBudget;
  signal: AbortSignal;
  trace: { uri?: string; bytes: number; jsonLdBlocks: number; knownCards: number };
}): Promise<ExtractionResult> {
  const schema = envelopeSchema(opts.config.maxRecordsPerDocument);
  const modelId = resolvedModelId('extractor');

  // Both slots before anything is awaited, so eight concurrent documents
  // cannot each see the same unspent budget.
  if (!opts.budget.take('maxModelCalls')) {
    return { status: 'skipped', reason: 'budget_model_calls', calls: 0, traceId: null };
  }
  if (!opts.budget.take('maxInputTokensPerSync', opts.prompt.estimatedTokens)) {
    return { status: 'skipped', reason: 'budget_tokens', calls: 0, traceId: null };
  }

  const { preflightCheck, chargeUsage } = await import('@/services/BudgetService');
  const preflight = await preflightCheck({ orgId: opts.orgId, agentSlug: opts.config.agentSlug });
  if (!preflight.ok) {
    return { status: 'skipped', reason: 'budget_exceeded', calls: 0, detail: preflight.reason, traceId: null };
  }

  const model: BaseChatModel = await buildChatModelForOrg('extractor', opts.orgId, {
    temperature: 0,
    // 4096, not 2048: `maxRecordsPerDocument` is 25 and a record carries a
    // description, so a full answer does not fit 2048 tokens. A truncated one
    // is invalid JSON, which costs the corrective retry and then the document.
    maxTokens: 4096,
    streaming: false,
  });

  const trace = traceFor({
    feature: FEATURES.PROCESSOR_EXTRACT,
    slug: opts.sourceSlug,
    orgId: opts.orgId,
    userId: 'sync',
    input: opts.trace,
  });

  // The document's own deadline AND the model's. Either one aborting stops the
  // call: without the context signal an abandoned document keeps spending.
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.budget.caps.modelTimeoutMs)]);

  const messages: Array<SystemMessage | HumanMessage> = [
    new SystemMessage(opts.prompt.system),
    new HumanMessage(opts.prompt.human),
  ];

  let calls = 0;
  let lastFailure: ExtractionSkip = 'model_invalid';
  let lastDetail: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0 && !opts.budget.take('maxModelCalls')) {
      break;
    }
    const generation = trace.generation({
      name: attempt === 0 ? 'extract' : 'extract-retry',
      // The resolved id, never the role: Langfuse prices on the model name.
      model: modelId,
      input: { ...opts.trace, attempt },
    });
    calls += 1;
    try {
      const res = await model.invoke(messages as never, { signal });
      const raw = contentText(res.content);
      const usage = (res as unknown as { usage_metadata?: UsageMetadata }).usage_metadata;
      generation.end({
        output: raw.slice(0, 4000),
        usageDetails: usage
          ? cleanUsageDetails({
              input: usage.input_tokens,
              output: usage.output_tokens,
              cache_read_input_tokens: usage.input_token_details?.cache_read,
            })
          : undefined,
      });
      if (usage) {
        // `input_tokens` already includes the cached tokens, and `pricing.ts`
        // only subtracts `cacheReadTokens` when it is given, without this,
        // cached input is billed at the full rate.
        await chargeUsage({
          orgId: opts.orgId,
          agentSlug: opts.config.agentSlug,
          model: modelId,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.input_token_details?.cache_read,
          },
        });
      }

      const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
      const parsed = schema.parse(JSON.parse(stripped));
      trace.update({ output: { records: parsed.records.length, calls } });
      return { status: 'ok', records: parsed.records as ExtractedRecord[], calls, traceId: trace.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      generation.end({ output: `(failed: ${message})` });
      if (isTimeout(error)) {
        // A timed-out call will time out again: the deadline is shared.
        lastFailure = 'model_timeout';
        lastDetail = message;
        break;
      }
      lastFailure = 'model_invalid';
      lastDetail = message;
      if (attempt === 0) {
        messages.push(new HumanMessage(
          `Your answer did not validate: ${message}. Answer again with ONLY the JSON object, no prose and no code fences.`,
        ));
      }
    }
  }

  trace.update({ output: { skipped: lastFailure, calls } });
  return { status: 'skipped', reason: lastFailure, calls, detail: lastDetail, traceId: trace.id };
}
