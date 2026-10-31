import type { PlanApp, PlanAutomation, PlanPlugin } from './automationsPlan';
import { groupPluginsByApp } from '@/features/navigation/apps';
import { safeListApps } from '@/libs/workspace/apps';
import { listPluginSlugs, loadPlugin, pluginContents } from '@/libs/workspace/plugins';
import { listAgents } from '@/services/AgentService';
import { automationOwnerAgentSlug, lastRunBySlug, listAutomations, pausesFor } from '@/services/AutomationService';
import { listMissions } from '@/services/MissionService';
import { enabledPluginsForOrg } from '@/services/PluginService';

/** Everything `planAutomations` needs, read once for a workspace. */
export type AutomationRegister = {
  automations: PlanAutomation[];
  plugins: PlanPlugin[];
  apps: PlanApp[];
  owners: Map<string, string | null>;
  lastRuns: Map<string, { status: string; startedAt: Date | null }>;
  pausers: Map<string, string>;
};

/**
 * The workspace's one automation register, read for the Automations page and
 * for every app's panel, so both draw the same rows from the same reads.
 * @param orgId - The workspace.
 */
export async function readAutomationRegister(orgId: string): Promise<AutomationRegister> {
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
  const shipped = listPluginSlugs();
  const plugins: PlanPlugin[] = enabled.filter(slug => shipped.includes(slug)).map((slug) => {
    const plugin = loadPlugin(slug);
    return { slug, name: plugin.manifest.name, automations: pluginContents(plugin).automations };
  });
  const apps: PlanApp[] = groupPluginsByApp(shipped, safeListApps()).map(({ app, plugins: own }) => ({ id: app.id, name: app.name, plugins: own }));
  return {
    automations: rows,
    plugins,
    apps,
    owners: new Map(rows.map((a) => {
      const owner = automationOwnerAgentSlug(a, missionAgent);
      return [a.slug, owner ? agentName.get(owner) ?? owner : null] as const;
    })),
    lastRuns: new Map([...lastRuns].map(([slug, r]) => [slug, { status: r.status, startedAt: r.startedAt }])),
    pausers: new Map([...pauses].map(([slug, p]) => [slug, p.by.name ?? p.by.id])),
  };
}

/**
 * Where the register opens filtered to one plugin's app.
 * @param register - The register's apps.
 * @param register.apps - The app catalogue, each with its plugins.
 * @param plugin - The plugin.
 */
export function registerHrefFor(register: Pick<AutomationRegister, 'apps'>, plugin: string): string {
  const app = register.apps.find(a => a.plugins.includes(plugin));
  return `/dashboard/schedules?app=${encodeURIComponent(app?.id ?? plugin)}`;
}
