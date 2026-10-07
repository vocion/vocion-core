import type { PluginInfo } from '@/libs/workspace/plugins';
import { Blocks } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Column, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { iconByName } from '@/features/dashboard/iconByName';
import { PluginToggle } from '@/features/dashboard/plugins/PluginToggle';
import { groupPluginsByApp, installedApps } from '@/features/navigation/apps';
import { safeListApps } from '@/libs/workspace/apps';
import { listPlugins } from '@/libs/workspace/plugins';
import { loadProject } from '@/routers/AuthGuards';
import { workspaceFolderForProject } from '@/routers/Workspace';
import { enabledPluginsForOrg, pluginWriteTarget } from '@/services/PluginService';

/**
 * The plugin catalogue's rows — the Plugins section of the Marketplace.
 *
 * A plugin is the abstract rung of the ladder made installable: agents,
 * skills, object types, missions, automations, pages and measures that compose
 * under the workspace with one line in workspace.yaml (`plugins:`). Each row
 * is a door to what the plugin adds; the switch edits workspace.yaml and
 * applies.
 *
 * It lives here rather than inside a page so the Marketplace shows the same
 * rows the plugin detail page links back to, with the same toggle, the same
 * dependents warning and the same read-only blocker (principle 6 — one shape).
 * Reads the filesystem catalogue and the project's enabled list itself, so a
 * caller only hands it the org.
 *
 * Grouped by app (Vocion 3.0): "Installed apps" first — Workforce, which
 * keeps the plugins no app lists, and every app with a plugin on here — then
 * the apps this workspace does not have yet. An app's plugins are its
 * features; turning one on is how the app arrives, with the same toggle.
 * @param props
 * @param props.orgId - The project whose enabled plugins and workspace are read.
 * @param props.isAdmin - Whether this viewer may flip a switch.
 */
export async function PluginRows({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [t, plugins, enabled, project, folder] = await Promise.all([
    getTranslations('Marketplace'),
    Promise.resolve(listPlugins()),
    enabledPluginsForOrg(orgId),
    loadProject(orgId),
    workspaceFolderForProject(orgId),
  ]);
  // On a deploy-managed host the project's own workspace is a read-only
  // checkout: the switch shows the state and names the door (the repo) instead
  // of failing on click. When the folder is ANOTHER project's, the switch
  // works on this project's list alone and the tooltip names the repo file.
  const target = await pluginWriteTarget(orgId, project?.slug ?? orgId, folder?.path ?? null, folder?.explicit ?? false);
  const blocker = target.blocker;
  const repoFile = target.mode === 'project' ? target.repoFile : null;
  const dependentsOf = (slug: string) => plugins.filter(p => p.manifest.depends.includes(slug)).map(p => p.manifest.slug);

  if (plugins.length === 0) {
    return (
      <ListEmpty
        variant="page"
        icon={Blocks}
        title="No plugins ship with this core"
        description="A plugin is a directory under templates/plugins with a plugin.yaml."
      />
    );
  }

  const rows = (list: readonly PluginInfo[]) => (
    <ListRows className="border-y border-border/70">
      {list.map((p) => {
        const on = enabled.includes(p.manifest.slug);
        const c = p.contents;
        return (
          <ListRow
            key={p.manifest.slug}
            href={`/dashboard/plugins/${p.manifest.slug}`}
            icon={Blocks}
            title={p.manifest.name}
            subline={<Subline segments={[p.manifest.description, `v${p.manifest.version}`, p.manifest.depends.length > 0 ? `needs ${p.manifest.depends.join(', ')}` : null]} />}
            columns={(
              <>
                <Column kind="number">{c.agents.length}</Column>
                <Column kind="number">{c.skills.length}</Column>
                <Column kind="number">{c.pages.length}</Column>
              </>
            )}
            chip={<StatusPill status={on ? 'completed' : 'inactive'} label={on ? 'On' : 'Off'} size="sm" />}
            actions={<PluginToggle slug={p.manifest.slug} enabled={on} canToggle={isAdmin} blocker={blocker} repoFile={repoFile} dependents={dependentsOf(p.manifest.slug)} />}
          />
        );
      })}
    </ListRows>
  );

  const apps = safeListApps();
  // A catalogue of apps that failed to read leaves the flat list, as before.
  if (apps.length === 0) {
    return rows(plugins);
  }
  const bySlug = new Map(plugins.map(p => [p.manifest.slug, p]));
  const installed = new Set(installedApps(enabled, project?.enabledSurfaces ?? [], apps).map(a => a.id));
  const groups = groupPluginsByApp(plugins.map(p => p.manifest.slug), apps);
  const part = (heading: string, list: typeof groups) => list.length > 0 && (
    <section className="mt-8 first:mt-2">
      <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{heading}</h2>
      {list.map(({ app, plugins: slugs }) => {
        const Icon = iconByName(app.icon);
        return (
          <div key={app.id} data-testid={`marketplace-app-${app.id}`} className="mt-4">
            <div className="flex items-center gap-2 py-1.5">
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <h3 className="text-sm font-semibold">{app.name}</h3>
              <span className="truncate text-[13px] text-muted-foreground">{app.description}</span>
            </div>
            {rows(slugs.map(s => bySlug.get(s)!))}
          </div>
        );
      })}
    </section>
  );

  return (
    <>
      {part(t('installed_apps'), groups.filter(g => installed.has(g.app.id)))}
      {part(t('more_apps'), groups.filter(g => !installed.has(g.app.id)))}
    </>
  );
}
