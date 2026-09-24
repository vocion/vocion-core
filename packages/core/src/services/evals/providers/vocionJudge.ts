/**
 * The LLM judge that has always graded our eval cases.
 *
 * Lifted out of `EvalService` unchanged in behaviour — same prompt, same
 * temperature, same Langfuse trace, same strict-JSON parsing with a recorded
 * error rather than a throw when the model returns something else. It moved so
 * the Vocion provider can call it without importing the runner, and so the
 * runner does not have to know how judging works.
 *
 * Determinism: the judge stays on the `classifier` role at temperature 0,
 * whatever model the agent under test is running. Two runs of one dataset are
 * graded by the same judge, which is the only reason comparing them means
 * anything.
 */

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CaseTranscript } from '../transcripts';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModelForOrg } from '@/libs/llm';
import { usageMetadataOf } from '@/libs/llm/usage';
import { chargeModelCall } from '@/services/budget/chargeModelCall';

const JUDGE_SYSTEM = `You are an evaluation judge for AI agent outputs.

Given:
  - The user's input.
  - The agent's response.
  - An optional rubric describing what "good" looks like.
  - An optional expected output (treat as guidance, not a literal match — substantive equivalence is fine).
  - Optional assertions: facts the response must state. Judge each on meaning, not wording.

Return STRICT JSON:
  {"verdict": "pass" | "fail" | "error", "score": 0.0..1.0, "rationale": "..."}

Pass when the response satisfies the rubric, covers every assertion, and is substantively equivalent to the expected output (when given). Score reflects quality within the verdict (0.6+ for pass, <0.5 for fail). The rationale should be one tight sentence the engineer can act on.`;

const JudgeOutputZ = z.object({
  verdict: z.enum(['pass', 'fail', 'error']),
  score: z.number().min(0).max(1),
  rationale: z.string(),
});

export type JudgeOutput = z.infer<typeof JudgeOutputZ>;

export type JudgeRequest = {
  orgId: string;
  datasetSlug: string;
  transcript: CaseTranscript;
  /**
   * Reuse a model across cases instead of building one each time. The runner
   * passes one; a caller judging a single case can leave it out.
   */
  judge?: BaseChatModel;
};

/**
 * Everything the judge is told about one case, as one prompt.
 * @param transcript - The case the judge is being asked to score.
 */
function buildJudgePrompt(transcript: CaseTranscript): string {
  const { item } = transcript;
  return [
    `User input: ${item.input}`,
    `Agent response: ${transcript.output.slice(0, 4000)}`,
    item.rubric ? `Rubric: ${item.rubric}` : '',
    item.expectedOutput ? `Expected (guidance): ${item.expectedOutput.slice(0, 1000)}` : '',
    item.assertions?.length ? `Assertions the response must satisfy:\n${item.assertions.map(a => `- ${a}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * The model's reply as plain text, whatever content shape it used.
 * @param content - The message content the model returned.
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(part => (part as { text?: string }).text ?? '').join('');
  }
  return '';
}

/**
 * Grade one case.
 *
 * A judge that returns unparseable output is recorded as an `error` verdict
 * with a rationale saying so, never as a failing score — "the grader broke" and
 * "the agent was wrong" are different facts, and a trend line that conflates
 * them reports our own bug as the agent getting worse.
 * @param request - The case, its context, and optionally a reusable model.
 */
export async function judgeTranscript(request: JudgeRequest): Promise<JudgeOutput> {
  const judge = request.judge ?? await buildChatModelForOrg('classifier', request.orgId, { temperature: 0 });
  const user = buildJudgePrompt(request.transcript);

  const trace = traceFor({
    feature: FEATURES.EVAL_JUDGE,
    slug: request.datasetSlug,
    orgId: request.orgId,
    userId: 'eval-runner',
    input: { input: request.transcript.item.input, itemIndex: request.transcript.itemIndex },
    metadata: { itemIndex: request.transcript.itemIndex },
  });
  const generation = trace.generation({ name: 'judge', model: 'classifier', input: user });

  const response = await judge.invoke([
    new SystemMessage(JUDGE_SYSTEM),
    new HumanMessage(user),
  ]);
  const raw = textOf(response.content);

  const usage = usageMetadataOf(response);
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

  // Charged, never refused: an eval run that stops halfway through a dataset
  // reports a pass rate that is not a pass rate. The run's own cost accounting
  // (`eval_case_result.usage`) is unchanged — this is the org-wide ledger.
  await chargeModelCall({
    orgId: request.orgId,
    feature: FEATURES.EVAL_JUDGE,
    role: 'classifier',
    response,
  });

  let stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstJsonObject(stripped) ?? stripped);
  } catch {
    // ONE more ask, JSON only. A judge that opens with "I'm ready" or breaks
    // a quote (reference run 3, cases 9 and 12) is a retry, not a scored
    // error — an unscored case is a hole in the number the run exists for.
    const again = await judge.invoke([
      new SystemMessage(JUDGE_SYSTEM),
      new HumanMessage(user),
      new AIMessage(raw),
      new HumanMessage('That was not a JSON object. Reply with ONLY the JSON object — no words before or after it.'),
    ]);
    await chargeModelCall({ orgId: request.orgId, feature: FEATURES.EVAL_JUDGE, role: 'classifier', response: again });
    stripped = textOf(again.content).replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
  }
  try {
    parsed = parsed ?? JSON.parse(firstJsonObject(stripped) ?? stripped);
  } catch (error) {
    console.error(`[evals] judge returned non-JSON for ${request.datasetSlug} case ${request.transcript.itemIndex}`, error);
    const fallback = { verdict: 'error' as const, score: 0, rationale: 'judge returned non-JSON' };
    trace.update({ output: fallback });
    return fallback;
  }

  const validated = JudgeOutputZ.safeParse(parsed);
  if (!validated.success) {
    console.error(`[evals] judge output failed validation for ${request.datasetSlug} case ${request.transcript.itemIndex}`, validated.error);
    const fallback = { verdict: 'error' as const, score: 0, rationale: 'judge output failed schema validation' };
    trace.update({ output: fallback });
    return fallback;
  }
  trace.update({ output: validated.data });
  return validated.data;
}

/**
 * The first complete JSON object in a text, or null. A judge that appends a
 * sentence after its verdict ("…} Hope that helps") used to score the case
 * as an error (factory-reference cases 4, 7 and 8, 2026-09-24): the verdict
 * was there, the parser stopped at the first character after it.
 * @param text - The model's output, fences already stripped.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
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
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
