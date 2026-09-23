/**
 * Adopted learning rules, rendered for the extraction prompt.
 *
 * `getLearnings(orgId, step)` per configured step, never `loadLearningRules`,
 * which reads every step in the org and would hand an event extractor the
 * CRM's rules.
 *
 * Three defences, each for a specific failure seen before:
 *
 *   - **A per-step try/catch.** `getLearnings` throws on an unknown step
 *     (`MemoryService.ts`), and one bad step name would otherwise fail every
 *     document of the run. Apply-time validation is the real gate; this is the
 *     belt, mirroring `services/agents/tools/kitVision.ts`.
 *   - **`action_run:` rows are excluded.** Those were written automatically
 *     from review decisions, without a person adopting them. Core stopped
 *     writing them; the filter stays for the rows written before it.
 *   - **Every rule is stripped and capped.** A rule is auto-generated text that
 *     embeds field names and phrases lifted from pages, so it is semi-trusted:
 *     no code fences, no closing-tag openers, one line each.
 */

import { RULES_CHAR_CAP, RULES_MAX } from './prompt';

/** Rules written automatically from a decision rather than adopted by a person. */
const UNADOPTED_SOURCE_PREFIX = 'action_run:';

export type RenderedLearnings = {
  /** `- (<step> #<id>) <text>` per rule, already capped. */
  text: string;
  /** Rule ids that actually reached the prompt, echoed into the extraction notes. */
  ids: string[];
  /** The rules that reached the prompt, by the same `step#id` as `ids`, so a verdict can cite one. */
  rules: Array<{ id: string; text: string }>;
  /** Steps that could not be read, for the notes. */
  failedSteps: string[];
};

/** One rule, flattened out of a step's payload. */
type Rule = { step: string; id: string; text: string };

/**
 * Collapse a rule to one safe line.
 * @param text - The adopted rule text.
 */
function scrubRule(text: string): string {
  return text
    .replace(/```/g, '')
    .replace(/<\//g, '< /')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Read and render the adopted rules for the configured steps.
 * @param orgId - Org whose rules are read.
 * @param steps - Learning step names from the source's processor config.
 */
export async function renderLearnings(orgId: string, steps: string[] | undefined): Promise<RenderedLearnings> {
  if (!steps || steps.length === 0) {
    return { text: '', ids: [], rules: [], failedSteps: [] };
  }
  const { getNamespace } = await import('@/services/MemoryService');

  const rules: Rule[] = [];
  const failedSteps: string[] = [];
  for (const step of steps) {
    try {
      const data = await getNamespace(orgId, step);
      for (const rule of data.rules) {
        if ((rule.source ?? '').startsWith(UNADOPTED_SOURCE_PREFIX)) {
          continue;
        }
        const text = scrubRule(rule.ruleText ?? '');
        if (text) {
          rules.push({ step, id: rule.key.split('/').pop()!.replace(/\.md$/, ''), text });
        }
      }
    } catch {
      // One unreadable step must not cost the run every document.
      failedSteps.push(step);
    }
  }

  const lines: string[] = [];
  const ids: string[] = [];
  const rendered: Array<{ id: string; text: string }> = [];
  let chars = 0;
  for (const rule of rules) {
    if (lines.length >= RULES_MAX) {
      break;
    }
    const line = `- (${rule.step} #${rule.id}) ${rule.text}`;
    if (chars + line.length + 1 > RULES_CHAR_CAP) {
      break;
    }
    lines.push(line);
    ids.push(`${rule.step}#${rule.id}`);
    rendered.push({ id: `${rule.step}#${rule.id}`, text: rule.text });
    chars += line.length + 1;
  }

  return { text: lines.join('\n'), ids, rules: rendered, failedSteps };
}
