/**
 * The one model call per changed or retried document.
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
import type { BaseMessage } from '@langchain/core/messages';
import type { SyncBudget } from '../budget';
import type { CandidateExtractorConfig } from './config';
import type { ExtractionPrompt } from './prompt';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import { HumanMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModelForOrg, resolvedModelId } from '@/libs/llm/langchain';
import { cachedThroughPrefix } from '@/libs/llm/promptCache';
import { logger } from '@/libs/Logger';
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
   * What the model thinks a reviewer should do with this record, judged
   * against the operator's own extraction rules. Required of the model: a
   * card nobody recommended anything about cannot be scored against what the
   * reviewer then did, and that comparison is the only read we have on
   * whether the criteria are working.
   */
  suggestedDecision: SuggestedDecision;
  /**
   * One short sentence for why that recommendation, in the model's words.
   * Required alongside it: a verdict a reviewer cannot check is one they can
   * only take on faith.
   */
  suggestedDecisionReason: string;
  /**
   * Why this occurrence does not follow the pattern of the rest of its series,
   * in a few words. Only meaningful alongside `seriesOf`, and dropped by
   * `validate.ts` when that id did not survive.
   */
  seriesNote?: string;
  /**
   * The model's verdict on each object this record points at — the venue an
   * event names, the employer a posting names — one entry per `objectType` the
   * config's `relatedProposals` rules ask about.
   *
   * Asked for in the same call that reads the document, because the model is
   * already looking at the line that names the object and a second call would
   * buy nothing. `resolve.ts` files those objects as their own review cards,
   * and this is what lets such a card carry a verdict somebody actually made
   * rather than a sentence core wrote for it.
   *
   * Absent when the config asks about nothing, and absent per type when the
   * model declined to judge one; the card then carries no recommendation,
   * which is the honest reading and stays out of the agreement rate.
   */
  referencedObjects?: ReferencedObjectVerdict[];
  /** Raw from the model; `validate.ts` keeps only configured names in 0..1. */
  scores?: Record<string, unknown>;
  /** The adopted rules the model says decided its verdict; `validate.ts` keeps only rules the call carried. */
  matchedRules?: MatchedRuleAnswer[];
};

export type MatchedRuleAnswer = { id: string; title?: string; evidence?: string };

/** What the model thinks of one object a record points at. */
export type ReferencedObjectVerdict = {
  /** The `relatedProposals` rule's `objectType`, as the prompt named it. */
  objectType: string;
  suggestedDecision: SuggestedDecision;
  suggestedDecisionReason: string;
};

export type ExtractionResult
  = | { status: 'ok'; records: ExtractedRecord[]; calls: number; traceId: string | null }
  /** Nothing was extracted, and the reason is a counter name, not prose. */
    | { status: 'skipped'; reason: ExtractionSkip; calls: number; detail?: string; traceId: string | null };

/** Why a document produced nothing. Each is a `counts` key on the run. */
export type ExtractionSkip
  = | 'model_invalid'
    | 'model_timeout'
    | 'model_throttled'
    | 'budget_model_calls'
    | 'budget_tokens'
    | 'budget_exceeded';

/** What the runner does with a skip: a refused call or a spent budget cost no work, so it does not use a try. */
export const SKIP_OUTCOME: Record<ExtractionSkip, 'finished' | 'retry' | 'defer'> = {
  model_invalid: 'finished',
  model_timeout: 'retry',
  model_throttled: 'defer',
  budget_model_calls: 'defer',
  budget_tokens: 'defer',
  budget_exceeded: 'defer',
};

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
 * a document claiming more records than the config allows was probably misread
 * — a navigation index, a repeated feature block — and the corrective retry is
 * a better answer than silently keeping a prefix of it. The cap it enforces is
 * 200 by default rather than the old 25, so an honest season page passes.
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
      // Required, unlike every optional field around it. A record the model
      // declined to judge is a record the agreement metric cannot see, so this
      // is worth the corrective retry that a missing value costs — the same
      // trade `maxRecords` above makes. The reason carries no length bound:
      // the prompt asks for one short sentence, and a model that writes two
      // should not have the second one cut off mid-word — the card clamps
      // what it shows instead.
      suggestedDecision: z.enum(SUGGESTED_DECISIONS),
      suggestedDecisionReason: z.string().transform(value => value.trim()),
      // Truncated, never rejected. `notes` above is a hard `.max(2000)`, and a
      // value one character over a hard bound costs the corrective retry and
      // can cost the whole document. A 141-character aside must never cost a
      // card, so this follows `runRef` and transforms instead.
      seriesNote: z.string().optional().transform(value => value?.slice(0, SERIES_NOTE_CAP)),
      // Optional, unlike the record's own verdict above, and deliberately so:
      // the prompt only asks for these when the config names related objects,
      // and a model that judged the record but not the venue should still get
      // its records stored. A malformed entry is dropped rather than failing
      // the document — `resolve.ts` treats a missing verdict as "nothing
      // judged this", which is exactly what a malformed one means.
      referencedObjects: z.array(z.object({
        objectType: z.string().min(1),
        suggestedDecision: z.enum(SUGGESTED_DECISIONS),
        suggestedDecisionReason: z.string().transform(value => value.trim()),
      }).nullable().catch(null)).optional().transform(entries => entries?.filter(entry => entry !== null)),
      // Forgiving like `referencedObjects`: a malformed value is dropped, never retried.
      scores: z.record(z.string(), z.unknown()).optional().catch(undefined),
      matchedRules: z.array(z.object({
        id: z.string().min(1),
        title: z.string().optional().catch(undefined),
        evidence: z.string().optional().catch(undefined),
      }).nullable().catch(null)).optional().catch(undefined).transform((entries) => {
        const kept = entries?.filter(entry => entry !== null);
        // A list the model filled with nothing usable says nothing, not "no rule decided it".
        return entries && entries.length > 0 && kept?.length === 0 ? undefined : kept;
      }),
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
 * Where the object opened at `start` closes, or -1 when it never does.
 * @param text - The answer, already stripped of fences.
 * @param start - Index of the opening brace.
 */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * The JSON object an answer carries, whichever reasoning a model wrote first.
 *
 * Only an object that ENDS the answer is taken, so one quoted mid sentence is
 * still refused.
 * @param raw - The answer as the provider returned it.
 */
function jsonAnswer(raw: string): string {
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  for (let start = stripped.indexOf('{'); start !== -1; start = stripped.indexOf('{', start + 1)) {
    if (objectEnd(stripped, start) === stripped.length - 1) {
      return stripped.slice(start);
    }
  }
  return stripped;
}

/**
 * Whether the provider refused the call rather than answering it badly.
 *
 * Read the two shapes `libs/retrieval/embedder.ts` already reads: the AWS SDK
 * marks a throttle on `$retryable` and carries the status on
 * `$metadata.httpStatusCode`, while an OpenAI-shaped client puts it on
 * `status`. Verified against a live Bedrock refusal, which arrives unwrapped as
 * `ThrottlingException` with `httpStatusCode: 429`.
 * @param error - Whatever `.invoke` threw.
 */
function isThrottled(error: unknown): boolean {
  const candidate = error as {
    status?: number;
    $metadata?: { httpStatusCode?: number };
    $retryable?: { throttling?: boolean };
  } | null;
  if (candidate?.$retryable?.throttling) {
    return true;
  }
  return (candidate?.status ?? candidate?.$metadata?.httpStatusCode) === 429;
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
  input_token_details?: { cache_read?: number; cache_creation?: number };
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
    // One bounded reading task. Models that think by default would bill the
    // thinking as output and spend the call's deadline on it.
    thinking: 'off',
    // The answer's ceiling, and in practice the real limit on how many records
    // one document can yield: at roughly 250 tokens a record — fields, a
    // verdict, the sentence explaining it, a verdict per referenced object —
    // 16,000 holds about 60. A truncated answer is invalid JSON, which costs
    // the corrective retry and then the whole document, so this is the number
    // to raise when a source genuinely lists more than that on one page.
    //
    // Not higher, because this is not ours to choose alone: the extractor's
    // model is per org, and a vendor whose own output ceiling is lower (16,384
    // on several OpenAI models) refuses the call outright rather than
    // returning less.
    maxTokens: 16_000,
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

  const { messages, callOptions }: { messages: BaseMessage[]; callOptions: Record<string, unknown> } = cachedThroughPrefix(
    model,
    opts.prompt.system,
    opts.prompt.humanPrefix,
    opts.prompt.human.slice(opts.prompt.humanPrefix.length),
  );

  let calls = 0;
  let lastFailure: ExtractionSkip = 'model_invalid';
  let lastDetail: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0 && !opts.budget.take('maxModelCalls')) {
      lastFailure = 'budget_model_calls';
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
      const res = await model.invoke(messages as never, { ...callOptions, signal });
      const raw = contentText(res.content);
      const usage = (res as unknown as { usage_metadata?: UsageMetadata }).usage_metadata;
      generation.end({
        output: raw.slice(0, 4000),
        usageDetails: usage
          ? cleanUsageDetails({
              input: usage.input_tokens,
              output: usage.output_tokens,
              cache_read_input_tokens: usage.input_token_details?.cache_read,
              cache_creation_input_tokens: usage.input_token_details?.cache_creation,
            })
          : undefined,
      });
      if (usage) {
        // `input_tokens` already includes cache reads and writes, and
        // `pricing.ts` prices each at its own rate only when it is given. A
        // spend row that fails to land is not a bad answer: treating it as one
        // would pay for a corrective call that fixes nothing.
        await chargeUsage({
          orgId: opts.orgId,
          agentSlug: opts.config.agentSlug,
          model: modelId,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.input_token_details?.cache_read,
            cacheWriteTokens: usage.input_token_details?.cache_creation,
          },
        }).catch((error: unknown) => {
          logger.warn('candidate extractor: could not record model spend', {
            sourceSlug: opts.sourceSlug,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      const parsed = schema.parse(JSON.parse(jsonAnswer(raw)));
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
      if (isThrottled(error)) {
        // A daily or per-minute allowance will not clear between two
        // attempts, so the corrective retry is spent for nothing.
        lastFailure = 'model_throttled';
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
