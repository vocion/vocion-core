/**
 * Workspace plugins — the abstract rung of the ladder, made installable.
 *
 * A plugin is a directory at `packages/core/templates/plugins/<slug>/` with
 * a `plugin.yaml` and the same folders a workspace has: agents/, skills/,
 * playbooks/, objects/, missions/, automations/, teams/, learnings/, pages/,
 * trust.yaml. A workspace turns one on with a single line:
 *
 *   plugins: [wiki, data-rooms, proposals]
 *
 * and the loader composes the plugin's resources UNDER the workspace exactly
 * as it composes the base pack (`compose.ts`): a plugin's resource is always
 * active, a same-slug workspace file overrides it (`extends: core` to patch a
 * YAML kind, whole-file replace for a SKILL.md folder), and `disable:` still
 * suppresses a slug. Where a plugin ships a slug the base pack also ships,
 * the plugin wins — a plugin is a more specific layer than the pack.
 *
 * This module is the filesystem half: which plugins exist, what each one
 * declares, and the dependency-ordered list a workspace's `plugins:` resolves
 * to. Pure reads, no DB, so the CLI (`workspace:check`) and the loader share
 * it. Enablement per project lands on `project.enabled_plugins` at apply and
 * is read back through `services/PluginService.ts`.
 */

import type { PluginManifest, TeamManifest } from './schemas';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { PluginManifestSchema, TeamManifestSchema } from './schemas';

/** Where the shipped plugins live, relative to the repo root. */
export const PLUGINS_REL = 'packages/core/templates/plugins';

export type LoadedPlugin = {
  manifest: PluginManifest;
  /** Absolute path of the plugin directory. */
  sourcePath: string;
};

/** What a plugin ships, counted for the catalogue — never the bodies. */
export type PluginContents = {
  agents: string[];
  skills: string[];
  playbooks: string[];
  objectTypes: string[];
  missions: string[];
  automations: string[];
  teams: string[];
  pages: string[];
  hasTrust: boolean;
  hasReadme: boolean;
};

export type PluginInfo = LoadedPlugin & { contents: PluginContents };

function pluginsRoot(): string {
  return fromRepoRoot(PLUGINS_REL);
}

/**
 * Every plugin directory shipped in this core, A–Z by slug. A directory
 * without a `plugin.yaml` is not a plugin and is skipped.
 */
export function pluginRoots(): string[] {
  const root = pluginsRoot();
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .sort()
    .map(name => join(root, name))
    .filter(dir => statSync(dir).isDirectory() && existsSync(join(dir, 'plugin.yaml')));
}

/**
 * Read + validate one plugin's manifest. Throws with the file named on an
 * unknown slug or a manifest that fails the schema; a plugin whose
 * `plugin.yaml` disagrees with its directory name is refused too, so a
 * renamed folder cannot ship under two identities.
 * @param slug - The plugin slug (its directory name).
 */
export function loadPlugin(slug: string): LoadedPlugin {
  const dir = join(pluginsRoot(), slug);
  const file = join(dir, 'plugin.yaml');
  if (!existsSync(file)) {
    const known = listPluginSlugs();
    throw new Error(`unknown plugin "${slug}" — this core ships: ${known.length > 0 ? known.join(', ') : '(none)'}`);
  }
  const raw = parseYaml(readFileSync(file, 'utf8'));
  const result = PluginManifestSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(i => `${i.path.length > 0 ? i.path.map(String).join('.') : '(root)'}: ${i.message}`);
    throw new Error(`plugin manifest validation failed at ${file}:\n  - ${messages.join('\n  - ')}`);
  }
  if (result.data.slug !== slug) {
    throw new Error(`plugin at ${dir} declares slug "${result.data.slug}" but lives in a directory named "${slug}" — the two must agree`);
  }
  return { manifest: result.data, sourcePath: dir };
}

/** Slugs of every shipped plugin. */
export function listPluginSlugs(): string[] {
  return pluginRoots().map(dir => dir.slice(dir.lastIndexOf('/') + 1));
}

/**
 * Resolve a workspace's `plugins:` list into the dependency-ordered set that
 * loads: each plugin after everything it depends on, each slug once. Throws
 * on an unknown slug, a missing dependency, or a cycle — all three are
 * authoring errors `workspace:check` should name, never something the
 * loader papers over.
 * @param requested - The slugs from workspace.yaml, in authored order.
 */
export function resolvePlugins(requested: readonly string[]): LoadedPlugin[] {
  const out: LoadedPlugin[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (slug: string, path: string[]) => {
    if (done.has(slug)) {
      return;
    }
    if (visiting.has(slug)) {
      throw new Error(`plugin dependency cycle: ${[...path, slug].join(' → ')}`);
    }
    visiting.add(slug);
    const plugin = loadPlugin(slug);
    for (const dep of plugin.manifest.depends) {
      visit(dep, [...path, slug]);
    }
    visiting.delete(slug);
    done.add(slug);
    out.push(plugin);
  };

  for (const slug of requested) {
    visit(slug, []);
  }
  return out;
}

/**
 * Names of the resources a plugin ships, per kind — the Plugins page's
 * "what turning this on adds" and the apply summary. Filesystem only.
 * @param plugin - A loaded plugin.
 */
export function pluginContents(plugin: LoadedPlugin): PluginContents {
  const dir = plugin.sourcePath;
  const yamlNames = (sub: string) => existsSync(join(dir, sub))
    ? readdirSync(join(dir, sub)).filter(f => /\.ya?ml$/.test(f)).map(f => f.replace(/\.ya?ml$/, '')).sort()
    : [];
  const folderNames = (sub: string) => existsSync(join(dir, sub))
    ? readdirSync(join(dir, sub)).filter(f => statSync(join(dir, sub, f)).isDirectory()).sort()
    : [];
  return {
    agents: yamlNames('agents').filter(n => !n.endsWith('.system-prompt')),
    skills: folderNames('skills'),
    playbooks: folderNames('playbooks'),
    objectTypes: folderNames('objects'),
    missions: yamlNames('missions'),
    automations: yamlNames('automations'),
    teams: yamlNames('teams'),
    pages: yamlNames('pages').filter(n => n !== 'tour'),
    hasTrust: existsSync(join(dir, 'trust.yaml')),
    hasReadme: existsSync(join(dir, 'README.md')),
  };
}

/** The whole catalogue, with contents — what the Plugins page lists. */
export function listPlugins(): PluginInfo[] {
  return listPluginSlugs().map((slug) => {
    const plugin = loadPlugin(slug);
    return { ...plugin, contents: pluginContents(plugin) };
  });
}

/**
 * The plugin's README body, when it ships one — the long description on the
 * Plugins page. Null otherwise.
 * @param plugin - A loaded plugin.
 */
export function readPluginReadme(plugin: LoadedPlugin): string | null {
  const file = join(plugin.sourcePath, 'README.md');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/**
 * The enabled plugins a workspace directory declares, dependency-closed and
 * ordered, read straight from its `workspace.yaml` — for the request-time
 * readers that have the path but no DB row (workspace pages). Empty when the
 * file is missing or unparseable: a broken manifest must not take a page down.
 * @param workspaceDir - Absolute workspace directory.
 */
export function enabledPluginsFromWorkspaceDir(workspaceDir: string): LoadedPlugin[] {
  for (const name of ['workspace.yaml', 'workspace.yml']) {
    const file = join(workspaceDir, name);
    if (!existsSync(file)) {
      continue;
    }
    try {
      const raw = parseYaml(readFileSync(file, 'utf8')) as { plugins?: unknown } | null;
      const slugs = Array.isArray(raw?.plugins) ? raw.plugins.filter((s): s is string => typeof s === 'string') : [];
      return resolvePlugins(slugs);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * The teams a plugin ships, with their measures — what the plugin says it is
 * graded on. Filesystem read for the catalogue; the live readings come from
 * the team report once the plugin is on and applied.
 * @param plugin - A loaded plugin.
 */
export function readPluginTeams(plugin: LoadedPlugin): Array<TeamManifest & { slug: string }> {
  const dir = join(plugin.sourcePath, 'teams');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter(f => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const parsed = TeamManifestSchema.parse(parseYaml(readFileSync(join(dir, f), 'utf8')));
      return { ...parsed, slug: basename(f, extname(f)) };
    });
}
