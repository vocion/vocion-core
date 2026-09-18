import { ArrowLeft, Blocks } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StatusPill } from '@/components/ui/status-pill';
import { PluginToggle } from '@/features/dashboard/plugins/PluginToggle';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listPlugins, listPluginSlugs, loadPlugin, pluginContents, readPluginReadme, readPluginTeams } from '@/libs/workspace/plugins';
import { workspacePathForProject } from '@/routers/Workspace';
import { enabledPluginsForOrg, workspaceWriteBlocker } from '@/services/PluginService';
import { ORG_ROLE } from '@/types/Auth';

/**
 * One plugin — what turning it on adds, what it measures, when the chat will
 * recommend it, and its README. The switch is the same one the list has.
 * @param props
 * @param props.params
 */
export default async function PluginDetailPage(props: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await auth();
  if (!orgId || !listPluginSlugs().includes(slug)) {
    return notFound();
  }
  const plugin = loadPlugin(slug);
  const contents = pluginContents(plugin);
  const teams = readPluginTeams(plugin);
  const readme = readPluginReadme(plugin);
  const enabled = await enabledPluginsForOrg(orgId);
  const dir = await workspacePathForProject(orgId);
  const blocker = dir ? workspaceWriteBlocker(dir) : 'this project has no workspace directory on this host';
  const on = enabled.includes(slug);
  const isAdmin = has({ role: ORG_ROLE.ADMIN });
  const dependents = listPlugins().filter(p => p.manifest.depends.includes(slug)).map(p => p.manifest.slug);

  const adds: Array<[string, string[]]> = [
    ['Agents', contents.agents],
    ['Skills', contents.skills],
    ['Playbooks', contents.playbooks],
    ['Object types', contents.objectTypes],
    ['Missions', contents.missions],
    ['Automations', contents.automations],
    ['Teams', contents.teams],
    ['Pages', contents.pages],
    ['Surfaces', plugin.manifest.surfaces],
  ];

  return (
    <>
      <div className="mb-4">
        <Link href="/dashboard/plugins" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" />
          Back to Plugins
        </Link>
      </div>

      <TitleBar
        title={(
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Blocks className="size-5" />
            </div>
            <div>
              <div>{plugin.manifest.name}</div>
              <div className="flex items-center gap-2 text-sm font-normal">
                <span className="font-mono text-xs text-muted-foreground">
                  {plugin.manifest.slug}
                  {' '}
                  · v
                  {plugin.manifest.version}
                </span>
                <StatusPill status={on ? 'completed' : 'inactive'} label={on ? 'On' : 'Off'} size="sm" />
              </div>
            </div>
          </div>
        )}
        description={plugin.manifest.description}
        actions={<PluginToggle slug={slug} enabled={on} canToggle={isAdmin} blocker={blocker} dependents={dependents} />}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {readme && (
            <section>
              <article className="prose prose-sm max-w-3xl dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{readme}</ReactMarkdown>
              </article>
            </section>
          )}

          {teams.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold">What it measures</h2>
              <p className="mb-3 text-[13px] text-muted-foreground">Declared on the plugin's team; readings appear on the team report once the plugin is on.</p>
              <ul className="divide-y divide-rule">
                {teams.flatMap(t => t.measures.map(m => (
                  <li key={`${t.slug}/${m.key}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span>
                      {m.label}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t.name}
                        {' '}
                        ·
                        {' '}
                        {m.source.kind}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      target
                      {' '}
                      {m.target}
                      {m.unit ? ` ${m.unit}` : ''}
                      {' '}
                      /
                      {' '}
                      {m.window}
                    </span>
                  </li>
                )))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-8 text-sm">
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Adds</h2>
            <dl className="space-y-2">
              {adds.filter(([, items]) => items.length > 0).map(([label, items]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-xs">{items.join(', ')}</dd>
                </div>
              ))}
              {contents.hasTrust && (
                <div>
                  <dt className="text-xs text-muted-foreground">Trust rules</dt>
                  <dd className="text-xs">confidence thresholds for its actions</dd>
                </div>
              )}
            </dl>
          </section>

          {plugin.manifest.depends.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Needs</h2>
              <p className="font-mono text-xs">{plugin.manifest.depends.join(', ')}</p>
            </section>
          )}

          {plugin.manifest.recommend.when.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Chat recommends it when</h2>
              <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted-foreground">
                {plugin.manifest.recommend.when.map(w => <li key={w}>{w}</li>)}
              </ul>
            </section>
          )}

          {plugin.manifest.recommend.connectors.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Works best with</h2>
              <p className="font-mono text-xs">{plugin.manifest.recommend.connectors.join(', ')}</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
