import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';

export async function hasCrmHome(orgId: string): Promise<boolean> {
  const [project] = await db.select({ plugins: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return project?.plugins.includes('native-crm') ?? false;
}
