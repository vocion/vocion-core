/**
 * Is a freshly proposed rule the same idea as one we already have?
 *
 * The old check was a trigram Jaccard score against approved rules, run at
 * approval time. Trigram overlap is a good filter and a bad judge: "always
 * cite the source line" and "never state a number without pointing at where it
 * came from" are the same instruction and share almost no character trigrams.
 *
 * So the shortlist shown to the judge is built two ways, and the second way
 * matters more than it looks. Trigram similarity puts the textually-close rules
 * first, and then the remaining slots are filled with the most recent rules
 * regardless of overlap — because a rule worded nothing like the candidate is
 * exactly the duplicate trigram cannot see. A prefilter that only kept
 * high-overlap rules would hide the case this check exists for.
 *
 * One model call judges the whole shortlist in a single prompt and names the
 * match, or none. Cost is one call per piece of feedback, not one per existing
 * rule.
 *
 * Known limit: a step with more rules than the shortlist holds can still hide
 * an old, textually-distant duplicate. Fixing that properly means an embedding
 * shortlist over `learning`, which is worth doing once a workspace has enough
 * rules per step for it to matter.
 *
 * This module does no database work: the caller passes in what already exists,
 * newest first. That keeps the judgement testable on plain data and keeps the
 * reads next to the writes they belong with.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModel } from '@/libs/llm';
import { similarity } from '@/services/LearningsService';

/** A rule that already exists — either still pending, or already adopted. */
export type ExistingRule = {
  kind: 'candidate' | 'learning';
  id: number;
  ruleText: string;
};

export type DuplicateVerdict
  = | { duplicate: true; matched: ExistingRule; reason: string }
    | { duplicate: false };

/**
 * How much trigram overlap earns a rule a place at the FRONT of the shortlist.
 * Deliberately far below the 0.72 the old approval-time check used as a
 * verdict: here it only decides ordering, and the model makes the call.
 */
const OVERLAP_THRESHOLD = 0.2;

/** How many existing rules the model is asked to consider at once. */
const SHORTLIST_LIMIT = 12;

const JudgeOutputZ = z.object({
  /**
   * The LINE NUMBER of the rule this duplicates, or null when it is a new
   * idea. Deliberately not a row id: a candidate and a learning can share an
   * id, and an answer of "7" would then be ambiguous.
   */
  duplicate_of: z.number().nullable(),
  reason: z.string().optional(),
});

const SYSTEM = `You decide whether a newly proposed rule for an AI agent already exists.

You are given one CANDIDATE rule and a numbered list of EXISTING rules. Answer with the number of the existing rule that says substantively the same thing, or null when the candidate is a genuinely new instruction.

Two rules are the same when following one would satisfy the other. Judge the instruction, not the wording — different words for the same behaviour ARE duplicates. A rule that is narrower, broader, or about a different situation is NOT a duplicate, even when it shares vocabulary. A rule that asks for the opposite behaviour is NOT a duplicate.

Return STRICT JSON:
{"duplicate_of": <id> | null, "reason": "one short sentence"}`;

/**
 * Choose which existing rules the model should consider.
 *
 * Textually-close rules go first so the likeliest match is never cut, then the
 * remaining slots are filled in the order the caller supplied (newest first).
 * The fill is the important half: a duplicate that shares no wording only ever
 * reaches the judge this way.
 *
 * Exported for its own test — this is where a real duplicate gets lost.
 * @param ruleText - The newly proposed rule.
 * @param existing - Every rule already on file for this step, newest first.
 */
export function shortlistForJudge(ruleText: string, existing: ExistingRule[]): ExistingRule[] {
  const byOverlap = existing
    .map(rule => ({ rule, score: similarity(ruleText, rule.ruleText) }))
    .filter(entry => entry.score >= OVERLAP_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.rule);

  const shortlist = [...byOverlap];
  for (const rule of existing) {
    if (shortlist.length >= SHORTLIST_LIMIT) {
      break;
    }
    if (!shortlist.some(picked => picked.kind === rule.kind && picked.id === rule.id)) {
      shortlist.push(rule);
    }
  }
  return shortlist.slice(0, SHORTLIST_LIMIT);
}

/**
 * Judge whether `ruleText` duplicates anything in `existing`.
 *
 * Fails open. A model error, unparseable output, or an id the model invented
 * all resolve to "not a duplicate", because a duplicate row in the review
 * queue is a minor annoyance a person can merge, while a dropped piece of
 * feedback is gone for good.
 * @param opts
 * @param opts.orgId - Org for trace tagging.
 * @param opts.stepName - Learning step, for trace tagging.
 * @param opts.ruleText - The newly proposed rule.
 * @param opts.existing - Rules already on file for this step.
 */
export async function findDuplicateRule(opts: {
  orgId: string;
  stepName: string;
  ruleText: string;
  existing: ExistingRule[];
}): Promise<DuplicateVerdict> {
  const shortlist = shortlistForJudge(opts.ruleText, opts.existing);
  if (shortlist.length === 0) {
    return { duplicate: false };
  }

  const user = [
    `CANDIDATE: ${opts.ruleText.slice(0, 1000)}`,
    'EXISTING:',
    ...shortlist.map((rule, index) => `  ${index + 1}. ${rule.ruleText.slice(0, 500)}`),
  ].join('\n');

  const trace = traceFor({
    feature: FEATURES.FEEDBACK_DEDUPE,
    slug: opts.stepName,
    orgId: opts.orgId,
    userId: 'worker',
    input: { candidate: opts.ruleText, shortlisted: shortlist.length },
  });
  const generation = trace.generation({ name: 'dedupe', model: 'classifier', input: user });

  let raw = '';
  try {
    const model = buildChatModel('classifier', { temperature: 0 });
    const res = await model.invoke([new SystemMessage(SYSTEM), new HumanMessage(user)]);
    raw = typeof res.content === 'string'
      ? res.content
      : (Array.isArray(res.content) ? res.content.map(part => (part as { text?: string }).text ?? '').join('') : '');
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
  } catch (error) {
    console.error(`[duplicateDetection] duplicate check failed for step "${opts.stepName}"; treating the rule as new`, error);
    trace.update({ output: { duplicate_of: null, reason: 'model call failed' } });
    return { duplicate: false };
  }

  const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    console.error(`[duplicateDetection] duplicate check returned non-JSON for step "${opts.stepName}"; treating the rule as new`);
    trace.update({ output: { duplicate_of: null, reason: 'non-json' } });
    return { duplicate: false };
  }

  const validated = JudgeOutputZ.safeParse(parsed);
  if (!validated.success) {
    console.error(`[duplicateDetection] duplicate check failed schema validation for step "${opts.stepName}"; treating the rule as new`);
    trace.update({ output: { duplicate_of: null, reason: 'schema-fail' } });
    return { duplicate: false };
  }
  if (validated.data.duplicate_of === null) {
    trace.update({ output: validated.data });
    return { duplicate: false };
  }

  const matched = shortlist[validated.data.duplicate_of - 1];
  if (!matched) {
    // The model answered with a line that was never shown. Trusting it would
    // attach feedback to an unrelated rule, so treat the candidate as new.
    console.error(`[duplicateDetection] duplicate check named line ${validated.data.duplicate_of}, which was not on the shortlist of ${shortlist.length}; treating the rule as new`);
    trace.update({ output: { duplicate_of: null, reason: 'line not on shortlist' } });
    return { duplicate: false };
  }
  trace.update({ output: validated.data });
  return { duplicate: true, matched, reason: validated.data.reason ?? 'same instruction' };
}
