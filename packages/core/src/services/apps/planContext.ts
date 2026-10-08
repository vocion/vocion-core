/**
 * The building blocks a drafted plan may reuse, read from what ships: the
 * agent catalog (roles hired as themselves, with their skills), the plugins,
 * an app's templates and the registered actions. One reading for the drafter
 * (what to offer the model), the validator (what a plan may cite) and the
 * renderer (where a hired role's files come from).
 */

import type { CatalogReader, PlanContext } from '@/libs/workspace/functionPlan';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { listActions } from '@/libs/actions/registry';
import { fromRepoRoot } from '@/libs/repo-root';
import { safeListAppTemplates } from '@/libs/workspace/appTemplates';
import { listPlugins } from '@/libs/workspace/plugins';
import { catalogRoot, listCatalog } from '@/services/CatalogService';

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).sort().flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function yamlNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => f.replace(/\.ya?ml$/, '')) : [];
}

/**
 * What a plan for this app may cite, and which agent slugs a new seat may not take.
 * @param appId - The app the plan stands up a function for.
 */
export function planContextFor(appId: string): PlanContext {
  const catalog = new Set(listCatalog().map(e => e.slug));
  const plugins = listPlugins();
  const reserved = new Set<string>([
    ...catalog,
    ...plugins.flatMap(p => p.contents.agents),
    ...yamlNames(fromRepoRoot('packages/core/templates/base/agents')),
  ]);
  return {
    catalog,
    plugins: new Set(plugins.map(p => p.manifest.slug)),
    templates: new Set(safeListAppTemplates(appId).map(t => t.manifest.slug)),
    actions: new Set(listActions().map(a => a.id)),
    reservedAgents: reserved,
  };
}

/**
 * Reads a hired role's manifest and its skills' files from the shipped catalog.
 * @param root - The catalog directory; defaults to the shipped one.
 */
export function catalogReader(root: string = catalogRoot()): CatalogReader {
  return {
    agentYaml: (slug) => {
      const file = join(root, 'agents', `${slug}.yaml`);
      return existsSync(file) ? readFileSync(file, 'utf8') : null;
    },
    skillFiles: (slug) => {
      const dir = join(root, 'skills', slug);
      return walk(dir).map(abs => ({ path: ['skills', slug, ...relative(dir, abs).split(sep)].join('/'), content: readFileSync(abs, 'utf8') }));
    },
  };
}

/**
 * The menu the drafter offers the model: every catalog role, plugin, template
 * and action, one line each — what exists to be reused before anything is
 * written new.
 * @param appId - The app.
 */
export function planMenu(appId: string): { catalog: string; plugins: string; templates: string; actions: string } {
  return {
    catalog: listCatalog().map(e => `- ${e.slug} — ${e.name}${e.teamName ? ` (${e.teamName})` : ''}: ${e.description}`).join('\n'),
    plugins: listPlugins().map(p => `- ${p.manifest.slug} — ${p.manifest.name}: ${p.manifest.description}`).join('\n'),
    templates: safeListAppTemplates(appId).map(t => `- ${t.manifest.slug} — ${t.manifest.name}: ${t.manifest.description}`).join('\n'),
    actions: listActions().map(a => `- ${a.id} — ${a.name}${a.external ? ' (reaches outside the workspace)' : ''}`).join('\n'),
  };
}
