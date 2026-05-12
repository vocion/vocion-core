/**
 * Comment-feedback classifier — Phase 6.
 *
 * Ports rev-ai's server/comment_classifier.py. Given the raw comment
 * text plus any quoted target text and a deck/artifact title, returns
 * one of `edit | rule | both | ignore` plus optional auxiliary fields.
 *
 * Runs on the `classifier` role (Haiku 4.5 by default). Short prompt,
 * structured output, cheap.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModel } from '@/libs/llm';

const ClassificationZ = z.object({
  bucket: z.enum(['edit', 'rule', 'both', 'ignore']),
  edit_summary: z.string().optional(),
  rule_text: z.string().optional(),
});

export type Classification = z.infer<typeof ClassificationZ>;

const SYSTEM = `You triage user feedback comments on AI-generated artifacts (slide decks, drafts, proposals).
Decide which of FOUR buckets each comment belongs to:

  - edit:   The user wants a specific change to THIS artifact (e.g. "shorten this paragraph", "use $120K not $100K", "replace this bullet").
  - rule:   The user is stating a general preference for ALL future artifacts (e.g. "always cite the source line", "we never quote a single number without a range").
  - both:   Apply the edit here AND save the preference for future artifacts.
  - ignore: Compliments, questions, off-topic chatter, or anything not actionable.

When the comment quotes specific target text, lean toward edit/both. When it uses general language ("always", "prefer", "never", "going forward"), lean toward rule.

Return STRICT JSON:
{"bucket": "edit|rule|both|ignore", "edit_summary": "...", "rule_text": "..."}

edit_summary and rule_text are optional — include only when the bucket calls for them.`;

export async function classifyComment(opts: {
  text: string;
  quotedText?: string;
  artifactTitle?: string;
  /** Org for trace tagging. Caller plumbs from the feedback job row. */
  orgId?: string;
}): Promise<Classification> {
  const model = buildChatModel('classifier', { temperature: 0 });
  const user = [
    `Artifact: ${opts.artifactTitle ?? '(unknown)'}`,
    opts.quotedText ? `Quoted target: """${opts.quotedText.slice(0, 500)}"""` : '',
    `Comment: """${opts.text.slice(0, 1000)}"""`,
  ].filter(Boolean).join('\n\n');

  const trace = traceFor({
    feature: FEATURES.FEEDBACK_CLASSIFY,
    slug: 'haiku',
    orgId: opts.orgId ?? 'system',
    userId: 'worker',
    input: { artifactTitle: opts.artifactTitle, hasQuote: !!opts.quotedText },
  });
  const generation = trace.generation({
    name: 'classify',
    model: 'classifier',
    input: user,
  });

  const res = await model.invoke([
    new SystemMessage(SYSTEM),
    new HumanMessage(user),
  ]);
  const raw = typeof res.content === 'string'
    ? res.content
    : (Array.isArray(res.content) ? res.content.map(c => (c as { text?: string }).text ?? '').join('') : '');

  // Anthropic / OpenAI surface usage on response_metadata.usage with
  // varying field names; the LangChain wrapper normalises to
  // `usage_metadata` on the message.
  const usage = (res as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number } } }).usage_metadata;
  generation.end({
    output: raw,
    usageDetails: usage
      ? cleanUsageDetails({
          input: usage.input_tokens,
          output: usage.output_tokens,
          cache_read_input_tokens: usage.input_token_details?.cache_read,
        })
      : undefined,
  });

  // Strip code fences if the model returned ```json … ```.
  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    trace.update({ output: { bucket: 'ignore', reason: 'non-json' } });
    return { bucket: 'ignore' };
  }
  const validated = ClassificationZ.safeParse(parsed);
  if (!validated.success) {
    trace.update({ output: { bucket: 'ignore', reason: 'schema-fail' } });
    return { bucket: 'ignore' };
  }
  trace.update({ output: validated.data });
  return validated.data;
}
