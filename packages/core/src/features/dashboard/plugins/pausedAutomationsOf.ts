import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { listPluginSlugs, loadPlugin, pluginContents } from '@/libs/workspace/plugins';
import { automationSchema } from '@/models/Schema';
import { enabledPluginsForOrg } from '@/services/PluginService';

/**
 * The plugin's automations a person has paused, or none. The query the
 * block draws, for a page that also says how many are paused elsewhere (a
 * product's "Needs you" line).
 * @param orgId - The project.
 * @param slug - The plugin.
 */
export async function pausedAutomationsOf(orgId: string, slug: string) {
  if (!listPluginSlugs().includes(slug) || !(await enabledPluginsForOrg(orgId)).includes(slug)) {
    return [];
  }
  const slugs = pluginContents(loadPlugin(slug)).automations;
  if (slugs.length === 0) {
    return [];
  }
  return db
    .select({ slug: automationSchema.slug, name: automationSchema.name, description: automationSchema.description, pausedAt: automationSchema.pausedAt, pausedBy: automationSchema.pausedBy, pausedNote: automationSchema.pausedNote })
    .from(automationSchema)
    .where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.status, 'active'), inArray(automationSchema.slug, slugs), isNotNull(automationSchema.pausedAt)));
}
