/**
 * Read a workspace's voice rules and merge them over core's platform floor.
 *
 * The rules are workspace config (`voice.yaml`, applied onto
 * `project.voice_rules`), the same shape as every other authored setting —
 * so a new banned phrase is a one-line PR against the workspace repo, not a
 * core change, and the history of "what this sender will not have in a send"
 * is a git log.
 */

import type { VoiceRule, VoiceRules } from './voiceRules';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';
import { mergeVoiceRules, PLATFORM_DEFAULT_VOICE_RULES } from './voiceRules';

/** The stored shape — `VoiceManifestSchema` after `workspace:apply`. */
type StoredVoiceRules = NonNullable<typeof projectSchema.$inferSelect.voiceRules>;

function toPattern(entry: { pattern: string; match?: 'phrase' | 'regex' }): string | RegExp {
  return entry.match === 'regex' ? new RegExp(entry.pattern, 'gi') : entry.pattern;
}

/**
 * Turn the stored/authored manifest into the runtime rule set.
 * Exported for tests and for callers that already hold the row.
 * @param stored - The value of `project.voice_rules`, or null.
 */
export function voiceRulesFromStored(stored: StoredVoiceRules | null | undefined): VoiceRules {
  if (!stored) {
    return PLATFORM_DEFAULT_VOICE_RULES;
  }
  const never: VoiceRule[] = (stored.never ?? []).map(r => ({
    id: r.id,
    pattern: toPattern(r),
    reason: r.reason,
  }));
  return mergeVoiceRules(PLATFORM_DEFAULT_VOICE_RULES, {
    never,
    prefer: (stored.prefer ?? []).map(p => ({ pattern: toPattern(p), use: p.use, reason: p.reason })),
    allow: stored.allow ?? [],
    maxWordsPerSend: stored.maxWordsPerSend,
    maxAsksPerSend: stored.maxAsksPerSend,
    noExclamation: stored.noExclamation,
    noEmoji: stored.noEmoji,
    noEmDash: stored.noEmDash,
  });
}

/**
 * The raw stored manifest — for the fields that are config, not rules.
 * @param orgId - The project id.
 */
export async function voiceConfigFor(orgId: string): Promise<StoredVoiceRules | null> {
  const [project] = await db
    .select({ voiceRules: projectSchema.voiceRules })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return project?.voiceRules ?? null;
}

/**
 * The merged rule set for a workspace. A workspace with no `voice.yaml` gets
 * the platform floor — never nothing, because "no rules authored yet" must
 * not mean "anything goes".
 * @param orgId - The project id.
 */
export async function voiceRulesFor(orgId: string): Promise<VoiceRules> {
  return voiceRulesFromStored(await voiceConfigFor(orgId));
}
