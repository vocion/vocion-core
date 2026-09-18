/**
 * Compose the workspace's voice into a system prompt.
 *
 * Used by any core service that asks a model for outbound copy outside a
 * skill turn — today, the review queue's rewrite. Two sources, in order of
 * authority:
 *
 * 1. **The rules** (`voice.yaml`). Enforced afterwards by `lintCopy`, so
 *    listing them in the prompt is a courtesy to the model, not the gate.
 * 2. **The playbook** the workspace names in `voice.playbook` — the prose
 *    that describes the voice positively (shape, register, calibration
 *    examples). Core never hardcodes the slug: which playbook carries the
 *    voice is workspace config, same rule as `defaults.regenerateSkills`.
 *
 * A workspace that has authored neither still gets the platform floor's
 * banned list, which is better than the generic house style that was here
 * before.
 */

import type { VoiceRules } from './voiceRules';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { playbookSchema } from '@/models/Schema';
import { readByOrigin } from '@/services/playbooks/mount';
import { voiceConfigFor, voiceRulesFromStored } from './loadVoiceRules';

/** How many banned constructions to name in the prompt before truncating. */
const MAX_RULES_IN_PROMPT = 60;

/**
 * Read the body of the playbook a workspace names as its voice guide.
 * Returns null when none is named, the row is missing, or the file is gone —
 * every one of which is a workspace-authoring problem, logged and survivable.
 * @param orgId - The project id.
 * @param slug - The playbook slug from `voice.playbook`.
 */
export async function readVoicePlaybook(orgId: string, slug: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, slug)))
    .limit(1);
  if (!row) {
    logger.warn('voice playbook named in voice.yaml is not in the catalog', { orgId, slug });
    return null;
  }
  const body = readByOrigin(row, 'SKILL.md');
  if (body === null) {
    logger.warn('voice playbook row exists but its SKILL.md is not on disk', { orgId, slug });
  }
  return body;
}

/**
 * Render the banned list as prompt lines the model can act on.
 * @param rules - The merged rule set.
 */
function renderRules(rules: VoiceRules): string {
  const lines = rules.never.slice(0, MAX_RULES_IN_PROMPT).map((r) => {
    const shown = typeof r.pattern === 'string' ? r.pattern : r.pattern.source;
    return `- "${shown}" — ${r.reason}`;
  });
  const extra = rules.never.length - lines.length;
  if (extra > 0) {
    lines.push(`- (and ${extra} more, all enforced after you answer)`);
  }
  const limits: string[] = [];
  if (rules.maxWordsPerSend) {
    limits.push(`at most ${rules.maxWordsPerSend} words`);
  }
  if (rules.maxAsksPerSend !== undefined) {
    limits.push(`at most ${rules.maxAsksPerSend} question(s)`);
  }
  if (rules.noExclamation) {
    limits.push('no exclamation points');
  }
  if (rules.noEmoji) {
    limits.push('no emoji');
  }
  if (rules.noEmDash) {
    limits.push('no em-dashes');
  }
  const preferred = (rules.prefer ?? []).map((p) => {
    const shown = typeof p.pattern === 'string' ? p.pattern : p.pattern.source;
    return `- not "${shown}" — write "${p.use}"`;
  });
  return [
    'Constructions that must NEVER appear. These are enforced after you answer; copy that contains one is rejected, not softened:',
    lines.join('\n'),
    limits.length > 0 ? `\nLimits: ${limits.join('; ')}.` : '',
    preferred.length > 0 ? `\nPreferences (not enforced, but write it this way):\n${preferred.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export type VoicePrompt = {
  /** The system prompt to send. */
  system: string;
  /** The merged rules, so the caller can lint the answer with the same set. */
  rules: VoiceRules;
  /** True when the workspace's own playbook prose made it into the prompt. */
  hasPlaybook: boolean;
};

/**
 * Build the rewrite system prompt for a workspace.
 * @param orgId - The project id.
 */
export async function buildVoicePrompt(orgId: string): Promise<VoicePrompt> {
  const stored = await voiceConfigFor(orgId);
  const rules = voiceRulesFromStored(stored);
  const playbook = stored?.playbook ? await readVoicePlaybook(orgId, stored.playbook) : null;

  const system = [
    'You rewrite an outbound draft in the sender\'s own voice.',
    'Preserve the core ask and every concrete detail, name and number. Invent nothing. It stays a DRAFT for human review.',
    'Return ONLY the rewritten text: no preamble, no explanation, no quotes around it.',
    '',
    playbook
      ? `This is the sender's voice guide, authored by the sender. Follow it.\n\n---\n${playbook}\n---`
      : 'No voice guide is authored for this workspace, so keep the rewrite plain: short declarative sentences, one ask, nothing that announces its own tone.',
    '',
    renderRules(rules),
  ].join('\n');

  return { system, rules, hasPlaybook: playbook !== null };
}
