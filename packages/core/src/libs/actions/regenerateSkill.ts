/**
 * Which workspace skill regenerates a given review-item type's card.
 *
 * The mapping is workspace config (`defaults.regenerateSkills` in
 * workspace.yaml, applied onto `project.regenerate_skills`), so core never
 * hardcodes a workspace slug and a new regenerable card type is a workspace
 * add, no core change. Null means no fast path: the action's regenerate
 * falls back to its full pass.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';

/**
 * The regenerate skill mapped to one action type, or null when the workspace
 * maps none.
 * @param orgId
 * @param actionId - The registered action id, e.g. `personalization.enroll`.
 */
export async function regenerateSkillFor(orgId: string, actionId: string): Promise<string | null> {
  const [project] = await db
    .select({ regenerateSkills: projectSchema.regenerateSkills })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return project?.regenerateSkills?.[actionId] ?? null;
}
