/**
 * The model half of step naming: a cheap model reads ONLY the call — tool
 * name and arguments — and writes the two tenses of what that call is doing.
 *
 * Why only the call: a label written after the result could say "found 3
 * deals" for a search that found none, and a reader trusts a label more than
 * a number. Structurally, the prompt never sees the output, so the label
 * can describe the act and cannot claim the outcome (CLAUDE.md, structural
 * over prompting). `isSafeStepLabels` rejects the words that would.
 *
 * One call per distinct (tool, args), cached in-process; any failure, no
 * key, or an unsafe answer falls back to `fallbackStepLabels`, which is
 * plain but never wrong. `VOCION_STEP_LABELS=off` disables the model half.
 */

import type { StepLabels } from '@/libs/chat/stepLabels';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { fallbackStepLabels, isSafeStepLabels, normalizeStepLabels } from '@/libs/chat/stepLabels';

const CACHE_MAX = 500;
const TIMEOUT_MS = 4_000;
/** Args longer than this are cut: the model needs the gist of the call, not the payload. */
const ARGS_MAX = 400;

const cache = new Map<string, StepLabels>();

const SYSTEM = [
  'You name one step an assistant takes with a tool, for a person watching it work.',
  'You are given ONLY the tool name and its arguments — never its result.',
  'Reply with strict JSON and nothing else: {"running":"<present participle, at most 7 words>","done":"<past tense, at most 7 words>"}.',
  'Describe the ACT in plain words a client would understand ("Reading the brand guide", "Read the brand guide").',
  'Never describe or imply a result: no counts, no "found", no "successfully", no judgement of what came back.',
  'Do not repeat the raw tool name. Do not include ids or tokens.',
].join(' ');

function cacheKey(tool: string, args: string): string {
  return `${tool}:${createHash('sha1').update(args).digest('hex').slice(0, 16)}`;
}

function remember(key: string, labels: StepLabels): StepLabels {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, labels);
  return labels;
}

/**
 * Compact JSON of the call's arguments, cut to `ARGS_MAX` characters.
 * @param args
 */
export function compactArgs(args: Record<string, unknown> | undefined): string {
  try {
    const s = JSON.stringify(args ?? {});
    return s.length > ARGS_MAX ? `${s.slice(0, ARGS_MAX)}…` : s;
  } catch {
    return '{}';
  }
}

/**
 * The JSON object in a model reply, however it was wrapped.
 * @param text
 */
export function parseLabelsReply(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Test seam: the model call, replaceable. */
export type LabelModel = (system: string, user: string) => Promise<string>;

async function defaultModel(orgId: string): Promise<LabelModel> {
  // Lazy: the LLM module validates env on import, and a test with a model seam never needs it.
  const { buildChatModelForOrg } = await import('@/libs/llm/langchain');
  const model = await buildChatModelForOrg('classifier', orgId, { temperature: 0, maxTokens: 120, streaming: false });
  return async (system, user) => {
    const res = await model.invoke([{ role: 'system', content: system }, { role: 'user', content: user }]);
    const c = res.content;
    return typeof c === 'string' ? c : JSON.stringify(c);
  };
}

/**
 * Name a step. Resolves to the model's pair when it can, the fallback otherwise.
 * @param opts
 * @param opts.orgId - Whose key pays for the call.
 * @param opts.tool - Raw tool name.
 * @param opts.args - The call's arguments.
 * @param opts.model - Test seam.
 */
export async function labelStep(opts: { orgId: string; tool: string; args?: Record<string, unknown>; model?: LabelModel }): Promise<StepLabels> {
  const fallback = fallbackStepLabels(opts.tool);
  if (process.env.VOCION_STEP_LABELS === 'off') {
    return fallback;
  }
  const args = compactArgs(opts.args);
  const key = cacheKey(opts.tool, args);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  try {
    const model = opts.model ?? await defaultModel(opts.orgId);
    const reply = await Promise.race([
      model(SYSTEM, `tool: ${opts.tool}\narguments: ${args}`),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('step label timed out')), TIMEOUT_MS)),
    ]);
    const parsed = parseLabelsReply(reply);
    if (isSafeStepLabels(parsed)) {
      return remember(key, normalizeStepLabels(parsed));
    }
    return remember(key, fallback);
  } catch {
    // No key, a slow model, a refusal: the plain name is the right answer,
    // and cached so the same step does not retry all turn.
    return remember(key, fallback);
  }
}

/** Test seam: forget every cached label. */
export function resetStepLabelCache(): void {
  cache.clear();
}
