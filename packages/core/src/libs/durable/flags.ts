/**
 * Whether this workspace runs a process as a durable workflow
 * (workspace.yaml `durable:`, backlog 054). Read per call: the applier can
 * turn one on between two events.
 * @param orgId - The workspace (its project id).
 * @param name - The process, e.g. `factory`.
 */
export async function durableOn(orgId: string, name: string): Promise<boolean> {
  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { projectSchema } = await import('@/models/Schema');
  const [row] = await db.select({ on: projectSchema.enabledDurable }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return Array.isArray(row?.on) && row.on.includes(name);
}
