/**
 * Which document playbooks this workspace treats as client-facing.
 *
 * Workspace config (`defaults.clientFacingPlaybooks` in workspace.yaml,
 * applied onto `project.client_facing_playbooks`), so core never hardcodes a
 * workspace's playbook names and a new client document type is a workspace
 * add with no core change — the same shape as `defaults.regenerateSkills`.
 *
 * Null means the workspace authored none; the caller falls back to core's
 * defaults (`services/documents/exportGate.ts`). An EMPTY list is different:
 * a workspace that deliberately gates nothing.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';

/**
 * The workspace's gated playbook tags, or null when it authored none.
 * @param orgId - The project.
 */
export async function clientFacingPlaybooksFor(orgId: string): Promise<string[] | null> {
  const [project] = await db
    .select({ clientFacingPlaybooks: projectSchema.clientFacingPlaybooks })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return project?.clientFacingPlaybooks ?? null;
}
