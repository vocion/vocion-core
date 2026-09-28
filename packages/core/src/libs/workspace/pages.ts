import type { LoadedPage } from '@/libs/workspace/pageFields';
import type { LoadedPlugin } from '@/libs/workspace/plugins';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { PageManifestSchema } from '@/libs/workspace/pageFields';
import { enabledPluginsFromWorkspaceDir, loadPlugin } from '@/libs/workspace/plugins';
import { readWorkspaceTextFile } from '@/libs/workspace/template-vars';

/**
 * Workspace pages — tenant-defined dashboard pages, declared entirely inside
 * the workspace directory (`WORKSPACE_PATH/pages/<slug>.yaml`, with optional
 * sibling `<slug>.md` prose and optional custom React widgets in
 * `pages/components/registry.tsx`).
 *
 * A page never introduces a new data model. Each page is a *derivative of a
 * core page archetype* — today `list` (the objects/type/[slug] shape),
 * `queue` (the review shape, read-only, linking into /dashboard/inbox for
 * decisions), `markdown` (the docs shape), `report` (one record's whole
 * story in order, at `/dashboard/p/<slug>/<id>`) or `overview` (an ordered
 * list of typed panels - the control plane) - configured over data core
 * already owns: business objects, skill runs, or knowledge documents.
 *
 * Pages are file-only: nothing is written to the database, `workspace:apply`
 * does not need to know about them, and deleting the YAML deletes the page.
 * They render at `/dashboard/p/<slug>` and are listed in the sidebar under
 * their `nav.section` (default "Workspace").
 *
 * An enabled plugin (`workspace.yaml` `plugins:`) contributes its own
 * `pages/` the same way; a workspace page with the same slug replaces it.
 *
 * A deployment hosts several projects on ONE mounted folder, so the mounted
 * `workspace.yaml` is only the primary project's word on which plugins are
 * on. The project the request is for has its own list on
 * `project.enabled_plugins`; a caller with an org passes it in
 * (`enabledPlugins`) and those plugins' pages join the same list, same
 * dedupe. This module stays filesystem-only — the DB half is
 * `services/PluginService.ts` (`readPageForOrg`).
 */

export * from '@/libs/workspace/pageFields';

function workspaceDir(): string | null {
  const p = process.env.WORKSPACE_PATH ?? process.env.CONTEXT_PATH ?? null;
  return p && existsSync(p) ? p : null;
}

export function workspacePagesDir(): string | null {
  const ws = workspaceDir();
  if (!ws) {
    return null;
  }
  const dir = join(ws, 'pages');
  return existsSync(dir) ? dir : null;
}

export type PageLoadIssue = { file: string; message: string };

export type ReadPagesOptions = {
  /**
   * Plugins the project has on (`project.enabled_plugins` — dependency-closed,
   * in load order), read from core's own `templates/plugins/<slug>/pages`.
   * Their pages join the mounted workspace's and its plugins'; a slug both
   * lists name loads once. Omitted = the mounted folder alone, as before.
   */
  enabledPlugins?: readonly string[];
  /**
   * Whether the folder on `WORKSPACE_PATH` is the asking project's own
   * (`services/WorkspaceMountService.ts` decides from what the applier
   * recorded). Default true — the single-project install, and every CLI
   * caller. False keeps the folder's pages AND its plugins' pages out: they
   * are another project's; only `enabledPlugins` contribute.
   */
  mounted?: boolean;
  /**
   * The asking project's OWN workspace folder, when it is not the one on
   * `WORKSPACE_PATH` — a second project on a shared host whose folder sits
   * beside the mounted one (`services/WorkspaceMountService.ts`
   * `projectPagesFolder` proves it is that project's). Given, its pages and
   * its plugins' are read instead of the mounted folder's, so a project can
   * override a plugin page by slug the way the primary project can.
   */
  dir?: string | null;
};

/**
 * Read + validate every page manifest in the workspace. Invalid files are
 * skipped and reported — a broken page never takes the dashboard down.
 * @param opts - See {@link ReadPagesOptions}.
 */
export function readWorkspacePages(opts: ReadPagesOptions = {}): { pages: LoadedPage[]; issues: PageLoadIssue[] } {
  const own = typeof opts.dir === 'string' && opts.dir !== '';
  const ws = own ? opts.dir! : workspaceDir();
  const pages: LoadedPage[] = [];
  const issues: PageLoadIssue[] = [];
  const seen = new Set<string>();
  const seenPlugins = new Set<string>();

  const readDir = (dir: string, origin: LoadedPage['origin'], tenant: boolean) => {
    if (!existsSync(dir)) {
      return;
    }
    for (const f of readdirSync(dir).filter(f => /\.ya?ml$/.test(f) && f !== 'tour.yaml' && f !== 'tour.yml').sort()) {
      try {
        // Only tenant files carry {{env.NAME}} tokens; a plugin ships the same bytes to everyone.
        const raw = parseYaml(tenant ? readWorkspaceTextFile(join(dir, f)) : readFileSync(join(dir, f), 'utf8'));
        const result = PageManifestSchema.safeParse(raw);
        if (!result.success) {
          issues.push({ file: f, message: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
          continue;
        }
        // The workspace reads first, so a same-slug plugin page is the one that yields.
        if (seen.has(result.data.slug)) {
          // A workspace page shadowing this plugin's page keeps the plugin's
          // place in the nav (Work stays under Software factory).
          const shadow = pages.find(p => p.slug === result.data.slug);
          if (shadow && shadow.origin === 'workspace' && origin !== 'workspace' && !shadow.overrides) {
            shadow.overrides = origin;
          }
          continue;
        }
        seen.add(result.data.slug);
        pages.push({ ...result.data, sourceDir: dir, origin });
      } catch (e) {
        issues.push({ file: f, message: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  const readPlugin = (plugin: LoadedPlugin) => {
    if (seenPlugins.has(plugin.manifest.slug)) {
      return;
    }
    seenPlugins.add(plugin.manifest.slug);
    readDir(join(plugin.sourcePath, 'pages'), `plugin:${plugin.manifest.slug}`, false);
  };

  // The mounted folder speaks only for the project it belongs to.
  if (ws && (own || (opts.mounted ?? true))) {
    readDir(join(ws, 'pages'), 'workspace', true);
    for (const plugin of enabledPluginsFromWorkspaceDir(ws)) {
      readPlugin(plugin);
    }
  }
  // The project's own plugins, after the mounted folder's so the same
  // "workspace first, plugin yields" rule holds for them. The list is stored
  // dependency-closed, so each slug loads on its own; one this core no longer
  // ships is reported the way a bad YAML is, never thrown.
  for (const slug of opts.enabledPlugins ?? []) {
    if (seenPlugins.has(slug)) {
      continue;
    }
    try {
      readPlugin(loadPlugin(slug));
    } catch (e) {
      issues.push({ file: `plugin:${slug}`, message: e instanceof Error ? e.message : String(e) });
    }
  }
  pages.sort((a, b) => a.nav.order - b.nav.order || a.title.localeCompare(b.title));
  return { pages, issues };
}

/**
 * One page by slug, from the same list {@link readWorkspacePages} builds.
 * @param slug - The page slug.
 * @param opts - See {@link ReadPagesOptions}.
 */
export function readWorkspacePage(slug: string, opts: ReadPagesOptions = {}): LoadedPage | null {
  return readWorkspacePages(opts).pages.find(p => p.slug === slug) ?? null;
}

/**
 * The plugin that ships this page, or null for a page the workspace authored
 * itself. `origin` already carries it as `plugin:<slug>`; this is the one
 * place that string is taken apart, so a surface asking "is this a plugin
 * page" never parses it by hand.
 * @param page - A loaded page.
 */
export function pagePlugin(page: Pick<LoadedPage, 'origin' | 'overrides'>): string | null {
  const from = page.origin.startsWith('plugin:') ? page.origin : page.overrides;
  return from ? from.slice('plugin:'.length) : null;
}

/**
 * Markdown content for a `markdown` archetype page (or a list page's intro),
 * read beside the YAML that declared it — a plugin page's prose ships with the
 * plugin, a workspace page's with the workspace.
 * @param manifest
 */
export function readWorkspacePageContent(manifest: LoadedPage): string | null {
  return readPageFile(manifest, manifest.contentFile ?? `${manifest.slug}.md`);
}

/**
 * The page's methodology prose (what "measured" means, what a definition
 * excludes, why a figure is the figure), read beside the YAML the same way
 * its intro is, and rendered collapsed rather than above the numbers.
 * Absent when the page ships no such file, which most pages do not.
 * @param manifest - The loaded page.
 */
export function readWorkspacePageMethodology(manifest: LoadedPage): string | null {
  return readPageFile(manifest, manifest.methodologyFile ?? `${manifest.slug}.methodology.md`);
}

/**
 * One file beside a page's YAML, through the workspace reader when the page
 * came from a mounted workspace and straight off disk when a plugin shipped
 * it.
 * @param manifest - The loaded page.
 * @param name - The file's name, relative to the page's directory.
 */
function readPageFile(manifest: LoadedPage, name: string): string | null {
  const file = join(manifest.sourceDir, name);
  if (!existsSync(file)) {
    return null;
  }
  return manifest.origin === 'workspace' ? readWorkspaceTextFile(file) : readFileSync(file, 'utf8');
}
