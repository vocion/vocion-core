import { Blocks } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Column, ListEmpty, ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { PluginToggle } from '@/features/dashboard/plugins/PluginToggle';
import { clerkAuth as auth } from '@/libs/Auth';
import { listPlugins } from '@/libs/workspace/plugins';
import { workspacePathForProject } from '@/routers/Workspace';
import { enabledPluginsForOrg, workspaceWriteBlocker } from '@/services/PluginService';
import { ORG_ROLE } from '@/types/Auth';

/**
 * Plugins — the catalogue this core can turn on for the workspace. A plugin
 * is the abstract rung of the ladder made installable: agents, skills,
 * object types, missions, automations, pages and measures that compose under
 * the workspace with one line in workspace.yaml (`plugins:`). Each row is a
 * door to what the plugin adds; the switch edits workspace.yaml and applies.
 * @param props
 * @param props.params
 */
export default async function PluginsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await auth();
  if (!orgId) {
    return notFound();
  }
  const [plugins, enabled, dir] = await Promise.all([Promise.resolve(listPlugins()), enabledPluginsForOrg(orgId), workspacePathForProject(orgId)]);
  const isAdmin = has({ role: ORG_ROLE.ADMIN });
  // On a deploy-managed host the workspace is a read-only checkout: the switch
  // shows the state and names the door (the repo) instead of failing on click.
  const blocker = dir ? workspaceWriteBlocker(dir) : 'this project has no workspace directory on this host';
  const dependentsOf = (slug: string) => plugins.filter(p => p.manifest.depends.includes(slug)).map(p => p.manifest.slug);

  return (
    <ListPage
      title="Plugins"
      description="Capabilities this workspace can turn on — each one a bundle of agents, skills, pages, automations and measures that starts working the moment it is on, and improves through use. On means one line in workspace.yaml; off keeps everything it wrote."
    >
      {plugins.length === 0
        ? <ListEmpty variant="page" icon={Blocks} title="No plugins ship with this core" description="A plugin is a directory under templates/plugins with a plugin.yaml." />
        : (
            <ListRows>
              {plugins.map((p) => {
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
                    actions={<PluginToggle slug={p.manifest.slug} enabled={on} canToggle={isAdmin} blocker={blocker} dependents={dependentsOf(p.manifest.slug)} />}
                  />
                );
              })}
            </ListRows>
          )}
    </ListPage>
  );
}
