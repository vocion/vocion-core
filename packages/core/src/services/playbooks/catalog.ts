/**
 * Catalog reads over the skill/playbook folder table — the list surfaces
 * (agent profile, team page, Skills page) share these.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { playbookSchema } from '@/models/Schema';

/**
 * All skill-kind folders for the org (SKILL.md units agents mount).
 * @param orgId
 */
export function listSkillFolders(orgId: string) {
  return db
    .select({
      slug: playbookSchema.slug,
      name: playbookSchema.name,
      description: playbookSchema.description,
      origin: playbookSchema.origin,
      attachedPlaybooks: playbookSchema.attachedPlaybooks,
      version: playbookSchema.version,
    })
    .from(playbookSchema)
    .where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.kind, 'skill')));
}
