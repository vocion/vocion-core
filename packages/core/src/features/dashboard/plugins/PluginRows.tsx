import type { PluginInfo } from '@/libs/workspace/plugins';
import { ArrowLeft, Blocks } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { CatalogCard, CatalogCards, Column, firstSentence, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { LetterTile } from '@/components/ui/letter-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { iconByName } from '@/features/dashboard/iconByName';
import { PluginToggle } from '@/features/dashboard/plugins/PluginToggle';
import { groupPluginsByApp, installedApps } from '@/features/navigation/apps';
import { Link } from '@/libs/I18nNavigation';
import { resolveTint } from '@/libs/tints';
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
 * Grouped by app (Vocion 5.0): "Installed apps" first — Workforce, which
 * keeps the plugins no app lists, and every app with a plugin on here — each
 * under its tinted mark, its rows a list with the toggle (managing is work).
 * Then the apps this workspace does not have yet, as front doors
 * (`CatalogCard`, docs/design/patterns.md § Front doors): one card per app,
 * its tint, one sentence, and one arrow into that app's plugins (`?app=`),
 * where the same toggle is how the app arrives.
 * @param props
 * @param props.orgId - The project whose enabled plugins and workspace are read.
 * @param props.isAdmin - Whether this viewer may flip a switch.
 * @param props.app - Show only this app's plugins (the door a More-apps card opens).
 */
export async function PluginRows({ orgId, isAdmin, app: onlyApp }: { orgId: string; isAdmin: boolean; app?: string | null }) {
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
  const group = ({ app, plugins: slugs }: (typeof groups)[number]) => (
    <div key={app.id} data-testid={`marketplace-app-${app.id}`} className="mt-4">
      <div className="flex items-center gap-2.5 py-1.5">
        <LetterTile name={app.name} icon={iconByName(app.icon)} tint={resolveTint(app.tint, app.id)} size="sm" />
        <h3 className="text-sm font-semibold">{app.name}</h3>
        <span className="truncate text-[13px] text-muted-foreground">{app.description}</span>
      </div>
      {rows(slugs.map(s => bySlug.get(s)!))}
    </div>
  );

  // One app's door, opened: just its plugins, and the way back.
  const opened = onlyApp ? groups.find(g => g.app.id === onlyApp) : undefined;
  if (opened) {
    return (
      <section className="mt-2">
        <Link href="/dashboard/marketplace/plugins" className="inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:min-h-0">
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('all_apps')}
        </Link>
        {group(opened)}
      </section>
    );
  }

  const installedGroups = groups.filter(g => installed.has(g.app.id));
  const moreGroups = groups.filter(g => !installed.has(g.app.id));
  return (
    <>
      {installedGroups.length > 0 && (
        <section className="mt-8 first:mt-2">
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('installed_apps')}</h2>
          {installedGroups.map(group)}
        </section>
      )}
      {moreGroups.length > 0 && (
        <section className="mt-8 first:mt-2">
          <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('more_apps')}</h2>
          <CatalogCards>
            {moreGroups.map(({ app, plugins: slugs }) => {
              const tint = resolveTint(app.tint, app.id);
              return (
                <CatalogCard
                  key={app.id}
                  tint={tint}
                  lead={<LetterTile name={app.name} icon={iconByName(app.icon)} tint={tint} className="bg-background/70" />}
                  kicker={t('app_kicker')}
                  title={app.name}
                  job={firstSentence(app.description)}
                  action={{ label: t('see_plugins', { count: slugs.length }), href: `/dashboard/marketplace/plugins?app=${app.id}` }}
                />
              );
            })}
          </CatalogCards>
        </section>
      )}
    </>
  );
}
