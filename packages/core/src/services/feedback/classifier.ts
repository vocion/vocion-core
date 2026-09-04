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
  /**
   * Which direction the rule points. Absent when no rule was proposed; the
   * caller treats a missing polarity on a rule as a correction, since that is
   * what the overwhelming majority of feedback is.
   */
  polarity: z.enum(['correct', 'reinforce']).optional(),
});

export type Classification = z.infer<typeof ClassificationZ>;

const SYSTEM = `You triage user feedback on AI-generated work — slide decks, drafts, proposals, and actions an agent proposed to take (an email to send, a record to update).
Decide which of FOUR buckets each comment belongs to:

  - edit:   The user wants a specific change to THIS artifact (e.g. "shorten this paragraph", "use $120K not $100K", "replace this bullet").
  - rule:   The user is stating a preference that should hold for ALL future work — either something to change ("always cite the source line", "never quote a single number without a range") or something to keep doing ("leading with the number was exactly right", "keep the follow-ups this short").
  - both:   Apply the edit here AND save the preference for future work.
  - ignore: Questions, off-topic chatter, and praise with no reusable reason in it ("nice", "thanks", "looks good").

Praise is NOT automatically ignorable. When the user says what was good and why, that is a rule worth keeping — write it as a directive the agent can follow next time. When the praise names nothing specific, it is ignore.

For every rule you propose, set polarity:
  - "correct"   — the agent should do something differently.
  - "reinforce" — the agent should keep doing what it did.

When the comment quotes specific target text, lean toward edit/both. When it uses general language ("always", "prefer", "never", "going forward", "keep"), lean toward rule.

Return STRICT JSON:
{"bucket": "edit|rule|both|ignore", "edit_summary": "...", "rule_text": "...", "polarity": "correct|reinforce"}

edit_summary, rule_text and polarity are optional — include only when the bucket calls for them. Write rule_text as a standalone instruction that makes sense without the original comment.`;

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
