import type { PlanPlugin } from '@/features/dashboard/automations/automationsPlan';
import { eq } from 'drizzle-orm';
import { History } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { AutomationsList } from '@/features/dashboard/automations/AutomationsList';
import { planAutomations } from '@/features/dashboard/automations/automationsPlan';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { listPluginSlugs, loadPlugin, pluginContents } from '@/libs/workspace/plugins';
import { knowledgeSourceSchema } from '@/models/Schema';
import { listAgents } from '@/services/AgentService';
import { automationOwnerAgentSlug, lastRunBySlug, listAutomations, pausesFor } from '@/services/AutomationService';
import { listMissions } from '@/services/MissionService';
import { enabledPluginsForOrg } from '@/services/PluginService';

export const dynamic = 'force-dynamic';

/**
 * AUTOMATIONS — every automation in the workspace, with its switch (Chris,
 * 2026-10-01: "Put all those automations on an Automations page with toggle
 * switches. Make it on main nav under More dropdown. Leave most off").
 *
 * One row per automation, grouped by the plugin that ships it and the
 * workspace's own last: its name, what it reacts to, the seat that owns it,
 * its last run, and a switch. Switching one off pauses it and switching it on
 * resumes it — the same pause the automation's own page records, with who and
 * when, and Undo in the toast. Which ones are on is each workspace's decision,
 * not this page's: nothing here switches anything by itself.
 *
 * The automation's own page (`/dashboard/automation/<slug>`) keeps the rest:
 * its parameters, its schedule's health, a test run and every fire.
 * @param props
 * @param props.params
 */
export default async function AutomationsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const now = await currentTime();
  const [rows, missions, agents, lastRuns, enabled] = await Promise.all([
    listAutomations(orgId),
    listMissions(orgId),
    listAgents(orgId),
    lastRunBySlug(orgId),
    enabledPluginsForOrg(orgId).catch(() => [] as string[]),
  ]);
  const pauses = await pausesFor(rows, orgId);
  const missionAgent = new Map(missions.map(m => [m.slug, m.agentSlug]));
  const agentName = new Map(agents.map(a => [a.slug, a.name]));
  const shipped = new Set(listPluginSlugs());
  const plugins: PlanPlugin[] = enabled.filter(slug => shipped.has(slug)).map((slug) => {
    const plugin = loadPlugin(slug);
    return { slug, name: plugin.manifest.name, automations: pluginContents(plugin).automations };
  });
  const groups = planAutomations({
    automations: rows,
    plugins,
    owners: new Map(rows.map((a) => {
      const owner = automationOwnerAgentSlug(a, missionAgent);
      return [a.slug, owner ? agentName.get(owner) ?? owner : null] as const;
    })),
    lastRuns: new Map([...lastRuns].map(([slug, r]) => [slug, { status: r.status, startedAt: r.startedAt }])),
    pausers: new Map([...pauses].map(([slug, p]) => [slug, p.by.name ?? p.by.id])),
    now,
  });

  // Connector refresh crons are connector config, not automations; listed so
  // "what runs on a schedule here" has one answer.
  const sources = await db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId));
  const syncing = sources.filter(s => s.enabled === 'true' && (s.configJson as { schedule?: string } | null)?.schedule);

  return (
    <ListPage
      title="Automations"
      description="The schedules and triggers that start work on their own; switch one off to pause it."
      actions={(
        <Link href="/dashboard/automation/runs" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted">
          <History className="size-3.5" />
          Run log
        </Link>
      )}
    >
      <AutomationsList groups={groups} />
      {syncing.length > 0 && (
        <section className="mt-8" aria-label="Source syncs">
          <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Source syncs</h2>
          <ListRows>
            {syncing.map(s => (
              <ListRow
                key={s.slug}
                href="/dashboard/connectors"
                title={s.slug}
                subline={<Subline segments={[cronToText((s.configJson as { schedule?: string }).schedule ?? ''), 'Set on the connector']} separator="·" />}
              />
            ))}
          </ListRows>
        </section>
      )}
    </ListPage>
  );
}

/** Now, read once per render: `Date.now()` counts as impure inside a render. */
async function currentTime(): Promise<number> {
  return Date.now();
}
