import type { Tint } from '@/libs/tints';
import type { LoadedPlugin } from '@/libs/workspace/plugins';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { parse as parseYaml } from 'yaml';
import { firstSentence } from '@/components/patterns/frontDoor';
import { workspaceAppNav } from '@/features/dashboard/workspaceAppNav';
import { groupPluginsByApp, installedApps } from '@/features/navigation/apps';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { SURFACES } from '@/features/navigation/surfaces';
import { db } from '@/libs/DB';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { getConnector } from '@/libs/sources/registry';
import { resolveTint } from '@/libs/tints';
import { safeListApps } from '@/libs/workspace/apps';
import { listPlugins } from '@/libs/workspace/plugins';
import { projectSchema } from '@/models/Schema';
import { listSources } from '@/services/SourceSyncService';

/**
 * The Apps catalogue as one workspace sees it (`/dashboard/apps`): every app
 * the core ships, whether this workspace has added it, and — for the app's
 * own page — what it brings, the tools it reads, and its features.
 *
 * Read from the one source the shell reads: the app manifests
 * (`templates/apps`), the plugin manifests and contents (`templates/plugins`)
 * and the project's `enabled_plugins`. An app's plugins are its **features**;
 * an app is added exactly when one of its features (or surfaces) is on, as the
 * rail already decides (`installedApps`). Nothing here names an app or a
 * plugin.
 */

/** One feature of an app: a plugin, in the words a person reads. */
export type AppFeature = {
  slug: string;
  name: string;
  /** One sentence: what it does for the reader. */
  job: string;
  on: boolean;
  /** The features it needs on (names), when any. */
  needs: string[];
  /** The features that need it (slugs) — turning it off turns them off too. */
  dependents: string[];
  version: string;
};

/** A tool an app reads, and whether this workspace has connected it. */
export type AppConnector = { slug: string; name: string; connected: boolean; needed: boolean };

export type AppOffer = {
  id: string;
  name: string;
  icon: string;
  tint: Tint;
  /** One sentence: what the app is for. */
  job: string;
  core: boolean;
  added: boolean;
  /** Where Open lands in this workspace — the same place the rail opens. */
  href: string;
  features: AppFeature[];
  /** What turning it on brings, by name. */
  agents: string[];
  pages: string[];
  automations: string[];
  connectors: AppConnector[];
  /** For the Details disclosure: the facts a person who authors the workspace wants. */
  details: { plugins: string[]; skills: number; missions: number; objectTypes: number; teams: number };
};

/**
 * Display names of the YAML files under a plugin folder, by the field each
 * kind names itself with; the file's slug when it names none.
 * @param plugin - The plugin.
 * @param sub - `agents`, `pages`, `automations`.
 * @param field - `name` or `title`.
 * @param skip - File slugs to leave out.
 */
function namesIn(plugin: LoadedPlugin, sub: string, field: 'name' | 'title', skip: (slug: string) => boolean = () => false): string[] {
  const dir = join(plugin.sourcePath, sub);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter(f => /\.ya?ml$/.test(f) && !skip(f.replace(/\.ya?ml$/, '')))
    .map((file) => {
      const slug = file.replace(/\.ya?ml$/, '');
      try {
        const doc = parseYaml(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown> | null;
        const value = doc?.[field];
        return typeof value === 'string' && value.trim() ? value.trim() : slug;
      } catch {
        return slug;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Every app this workspace can add, in rail order, with what each brings.
 * @param orgId - The project.
 */
export async function listAppOffers(orgId: string): Promise<AppOffer[]> {
  const apps = safeListApps();
  const plugins = listPlugins();
  const bySlug = new Map(plugins.map(p => [p.manifest.slug, p]));
  const [project] = await db
    .select({ enabledPlugins: projectSchema.enabledPlugins, enabledSurfaces: projectSchema.enabledSurfaces })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  const enabledPlugins = project?.enabledPlugins ?? [];
  const enabledSurfaces = project?.enabledSurfaces ?? [];
  const [nav, connected] = await Promise.all([
    workspaceAppNav({ orgId, enabledPlugins, enabledSurfaces }),
    listSources(orgId).then(rows => new Set(rows.map(connectorOfSource))),
  ]);
  const added = new Set(installedApps(enabledPlugins, enabledSurfaces, apps).map(a => a.id));
  const hrefOf = new Map(nav.apps.map(a => [a.id, a.href]));
  const surfaceLabel = (id: string) => (SURFACES as Record<string, { label: string } | undefined>)[id]?.label;

  return groupPluginsByApp(plugins.map(p => p.manifest.slug), apps).map(({ app, plugins: slugs }) => {
    const own = slugs.map(s => bySlug.get(s)!);
    const features: AppFeature[] = own.map(p => ({
      slug: p.manifest.slug,
      name: p.manifest.name,
      job: firstSentence(p.manifest.description),
      on: enabledPlugins.includes(p.manifest.slug),
      needs: p.manifest.depends.map(d => bySlug.get(d)?.manifest.name ?? d),
      dependents: plugins.filter(q => q.manifest.depends.includes(p.manifest.slug)).map(q => q.manifest.slug),
      version: p.manifest.version,
    }));
    const unique = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
    const pages = unique([
      ...own.flatMap(p => namesIn(p, 'pages', 'title', slug => slug === 'tour')),
      ...own.flatMap(p => DASHBOARD_ROUTES.filter(r => r.plugin === p.manifest.slug).map(r => r.title)),
      ...own.flatMap(p => p.manifest.surfaces.map(surfaceLabel).filter((l): l is string => Boolean(l))),
    ]);
    const needed = new Set(own.flatMap(p => p.manifest.setup?.connectors ?? []));
    const connectorSlugs = [...needed, ...own.flatMap(p => p.manifest.recommend.connectors).filter(c => !needed.has(c))];
    return {
      id: app.id,
      name: app.name,
      icon: app.icon,
      tint: resolveTint(app.tint, app.id),
      job: firstSentence(app.description),
      core: app.core,
      added: app.core || added.has(app.id),
      href: hrefOf.get(app.id) ?? app.entry,
      features,
      agents: unique(own.flatMap(p => namesIn(p, 'agents', 'name', slug => slug.endsWith('.system-prompt')))),
      pages,
      automations: unique(own.flatMap(p => namesIn(p, 'automations', 'name'))),
      connectors: [...new Set(connectorSlugs)].map(slug => ({ slug, name: getConnector(slug)?.name ?? slug, connected: connected.has(slug), needed: needed.has(slug) })),
      details: {
        plugins: own.map(p => p.manifest.slug),
        skills: own.reduce((n, p) => n + p.contents.skills.length, 0),
        missions: own.reduce((n, p) => n + p.contents.missions.length, 0),
        objectTypes: own.reduce((n, p) => n + p.contents.objectTypes.length, 0),
        teams: own.reduce((n, p) => n + p.contents.teams.length, 0),
      },
    } satisfies AppOffer;
  });
}

/**
 * One app as this workspace sees it, or null for an id the catalogue lacks.
 * @param orgId - The project.
 * @param id - The app id.
 */
export async function getAppOffer(orgId: string, id: string): Promise<AppOffer | null> {
  return (await listAppOffers(orgId)).find(a => a.id === id) ?? null;
}
