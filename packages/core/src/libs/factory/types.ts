/**
 * THE FACTORY'S TYPES — which object type plays each role in the loop, read
 * from the plugin that declares them, never written in core (backlog 045;
 * principle 13, point 5: no type slugs in core logic).
 *
 * A factory plugin names its roles once in `plugin.yaml`:
 *
 *   factory:
 *     types: {request: request, task: engineering_task, plan: architecture_plan, …}
 *
 * and every factory service asks {@link factoryTypes} for the slug it lists,
 * compares or links. A workspace whose plugin calls its work item something
 * else runs the same loop with no core edit.
 *
 * Which plugin: the first one the org has on that declares a `factory:`
 * block. An org with none on (a project row applied before
 * `enabled_plugins` existed, a test database) reads the core's own factory
 * plugin, which is what the code named before this, so nothing that worked
 * stops working.
 */

import type { FactoryManifest } from '@/libs/workspace/schemas';

/** The slug of each role's object type. */
export type FactoryTypes = FactoryManifest['types'];

/** A role in the loop. */
export type FactoryRole = keyof FactoryTypes;

const bySlug = new Map<string, FactoryTypes | null>();

/**
 * One plugin's factory types, or null when it declares none. Manifests are
 * files shipped with this core and only change with a deploy, so each is
 * read once per process.
 * @param slug - The plugin slug.
 */
async function pluginTypes(slug: string): Promise<FactoryTypes | null> {
  if (!bySlug.has(slug)) {
    const { loadPlugin } = await import('@/libs/workspace/plugins');
    let types: FactoryTypes | null = null;
    try {
      types = loadPlugin(slug).manifest.factory?.types ?? null;
    } catch {
      types = null;
    }
    bySlug.set(slug, types);
  }
  return bySlug.get(slug) ?? null;
}

/**
 * The factory types the core ships: the first plugin, A–Z, that declares a
 * `factory:` block.
 */
async function shippedTypes(): Promise<FactoryTypes | null> {
  const { listPluginSlugs } = await import('@/libs/workspace/plugins');
  for (const slug of listPluginSlugs()) {
    const types = await pluginTypes(slug);
    if (types) {
      return types;
    }
  }
  return null;
}

/**
 * The factory types for one org. Throws only when no plugin anywhere declares
 * them, which is a core built without a factory plugin: said, not guessed.
 * @param orgId - Tenant.
 */
export async function factoryTypes(orgId: string): Promise<FactoryTypes> {
  const { enabledPluginsForOrg } = await import('@/services/PluginService');
  const enabled = await enabledPluginsForOrg(orgId).catch(() => [] as string[]);
  for (const slug of enabled) {
    const types = await pluginTypes(slug);
    if (types) {
      return types;
    }
  }
  const shipped = await shippedTypes();
  if (!shipped) {
    throw new Error('no plugin in this core declares factory types (plugin.yaml `factory.types`)');
  }
  return shipped;
}

/**
 * Which role a type plays, or null when it plays none.
 * @param types - The org's factory types.
 * @param slug - An object type slug.
 */
export function factoryRoleOf(types: FactoryTypes, slug: string | null | undefined): FactoryRole | null {
  if (!slug) {
    return null;
  }
  for (const [role, s] of Object.entries(types) as Array<[FactoryRole, string]>) {
    if (s === slug) {
      return role;
    }
  }
  return null;
}

/** Test seam: forget what was read, so a test can change the manifests under it. */
export function resetFactoryTypesCache(): void {
  bySlug.clear();
}
