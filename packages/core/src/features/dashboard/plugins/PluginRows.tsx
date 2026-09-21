import { Blocks } from 'lucide-react';
import { Column, ListEmpty, ListRow, ListRows, Subline } from '@/components/patterns';
import { StatusPill } from '@/components/ui/status-pill';
import { PluginToggle } from '@/features/dashboard/plugins/PluginToggle';
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
 * @param props
 * @param props.orgId - The project whose enabled plugins and workspace are read.
 * @param props.isAdmin - Whether this viewer may flip a switch.
 */
export async function PluginRows({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const [plugins, enabled, project, folder] = await Promise.all([
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

  return (
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
            actions={<PluginToggle slug={p.manifest.slug} enabled={on} canToggle={isAdmin} blocker={blocker} repoFile={repoFile} dependents={dependentsOf(p.manifest.slug)} />}
          />
        );
      })}
    </ListRows>
  );
}
