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
  /**
   * Which learning step (bucket) the rule belongs to, chosen from the
   * whitelist the caller passed in `steps`. Absent when the caller passed no
   * steps or the model named one that is not on the list — the caller then
   * falls back exactly as before this field existed (the org's first step).
   */
  target_step: z.string().optional(),
  /**
   * What KIND of memory the rule is. Preferences are one person's taste,
   * knowledge is a fact about the business, procedures are how the agent
   * should work. Episodes never come through feedback classification.
   */
  memory_type: z.enum(['preference', 'knowledge', 'procedure']).optional(),
  /**
   * The broadest scope where the rule is consistently true, and no broader.
   * The classifier only picks the KIND — the worker resolves the ref from the
   * feedback's own context (the agent reacted to, the person who wrote it).
   */
  scope: z.enum(['workspace', 'agent', 'user']).optional(),
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

For every rule you propose, also set:
  - memory_type: "preference" (one person's taste — tone, length, format they personally want), "knowledge" (a fact about the business, a client, or a system), or "procedure" (how the work should be done, for everyone).
  - scope: the BROADEST scope where the rule is consistently true, and no broader. "workspace" — true for every agent and every person (most rules). "agent" — about how ONE agent behaves, wrong to apply to others. "user" — one person's personal preference that teammates may not share.

Return STRICT JSON:
{"bucket": "edit|rule|both|ignore", "edit_summary": "...", "rule_text": "...", "polarity": "correct|reinforce", "target_step": "...", "memory_type": "preference|knowledge|procedure", "scope": "workspace|agent|user"}

edit_summary, rule_text, polarity, target_step, memory_type and scope are optional — include only when the bucket calls for them. Write rule_text as a standalone instruction that makes sense without the original comment.`;

/**
 * The step-choice suffix, appended only when the caller supplied a whitelist.
 * Kept out of the base prompt so callers with no steps get the exact prompt
 * that shipped before this field existed.
 * @param steps - The org's learning steps (name + what belongs in it).
 */
function stepChoiceSection(steps: Array<{ name: string; description: string }>): string {
  const list = steps.map(s => `  - ${s.name}: ${s.description}`).join('\n');
  return `\n\nWhen you propose a rule, also pick target_step — the ONE bucket below whose description best matches what the rule is about. Use the bucket's exact name. If none fits, omit target_step.\n\nBuckets:\n${list}`;
}

export async function classifyComment(opts: {
  text: string;
  quotedText?: string;
  artifactTitle?: string;
  /** Org for trace tagging. Caller plumbs from the feedback job row. */
  orgId?: string;
  /**
   * The org's learning-step whitelist. When present, the classifier also
   * picks `target_step` from it; a pick that is not on the list is dropped
   * here so callers can trust the field.
   */
  steps?: Array<{ name: string; description: string }>;
}): Promise<Classification> {
  const model = buildChatModel('classifier', { temperature: 0 });
  const system = opts.steps && opts.steps.length > 0 ? SYSTEM + stepChoiceSection(opts.steps) : SYSTEM;
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
    new SystemMessage(system),
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
  const out = { ...validated.data };
  // A pick must come off the caller's whitelist — a hallucinated bucket name
  // would otherwise create candidates no step will ever mount.
  if (out.target_step && !(opts.steps ?? []).some(s => s.name === out.target_step)) {
    delete out.target_step;
  }
  trace.update({ output: out });
  return out;
}
