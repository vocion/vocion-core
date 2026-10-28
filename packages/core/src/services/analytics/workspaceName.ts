/**
 * A workspace's name for analytics, so a chart reads "Revenue" rather than a
 * `project.id`. Held per process for ten minutes: a rename shows up after that.
 */

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { name: string | null; until: number }>();

/**
 * The workspace's name, or null when it cannot be read.
 * @param orgId - The workspace (`project.id`).
 */
export async function workspaceNameOf(orgId: string): Promise<string | null> {
  const hit = cache.get(orgId);
  if (hit && hit.until > Date.now()) {
    return hit.name;
  }
  try {
    const [{ db }, { projectSchema }, { eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
    const [row] = await db.select({ name: projectSchema.name }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    const name = row?.name ?? null;
    cache.set(orgId, { name, until: Date.now() + TTL_MS });
    return name;
  } catch {
    return null;
  }
}
