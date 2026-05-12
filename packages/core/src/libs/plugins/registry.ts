import type { AnySkill, PluginManifest } from '@vocion/sdk';

/**
 * Process-wide plugin registry. Loaded once at boot via `loadPlugins()` and
 * queried on every skill execution.
 *
 * Thread-safety: Node.js is single-threaded per process, but we still use
 * `Map#set` carefully: the registry is write-once per boot. `reload()` is
 * the only mutation path after startup and is expected to be rare (dev only).
 */
class PluginRegistry {
  private skills = new Map<string, { skill: AnySkill; pluginId: string }>();
  private loaded: PluginManifest[] = [];

  /**
   * Register every skill in a validated manifest. Later registrations win.
   * @param manifest
   * @param skills
   */
  register(manifest: PluginManifest, skills: Array<AnySkill>): void {
    this.loaded.push(manifest);
    for (const skill of skills) {
      this.skills.set(skill.slug, { skill, pluginId: manifest.id });
    }
  }

  /**
   * Look up an operation by slug. Returns null if no plugin owns it
   * (fall back to prompt-only).
   * @param slug
   */
  getOperation(slug: string): AnySkill | null {
    return this.skills.get(slug)?.skill ?? null;
  }

  /**
   * @param slug
   * @deprecated v0.2 — use {@link getOperation}.
   */
  getSkill(slug: string): AnySkill | null {
    return this.getOperation(slug);
  }

  /** Catalog view for `plugins_list` MCP tool / UI. */
  list(): Array<{ pluginId: string; slug: string; name: string; version: string; description?: string; requiresApproval: boolean; category?: string }> {
    return [...this.skills.entries()].map(([slug, { skill, pluginId }]) => ({
      pluginId,
      slug,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      requiresApproval: skill.requiresApproval,
      category: skill.category,
    }));
  }

  listPlugins(): PluginManifest[] {
    return [...this.loaded];
  }

  /** Clear and reload — used by `plugins_reload` in dev. */
  clear(): void {
    this.skills.clear();
    this.loaded = [];
  }
}

/** Module-scoped singleton. Guaranteed unique per process. */
export const pluginRegistry = new PluginRegistry();

export type PluginRegistryView = ReturnType<typeof pluginRegistry.list>;
