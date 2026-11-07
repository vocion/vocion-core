/**
 * A SOURCE CONNECTED AFTER THE APP WAS INSTALLED REACHES ITS AGENTS.
 *
 * A plugin agent names what it reaches for by family or connector kind
 * (`requires`), and an apply binds each to the workspace's sources of that
 * kind (`libs/workspace/requiredSources.ts`). An apply runs at install and when
 * core ships new templates, so a source connected in between (the usual order
 * on Vocion Cloud: turn Paid Marketing on, then connect Google Ads) reached no
 * agent until the next template change: a Marketing lead with Google Ads
 * connected, and no source and no ads tools.
 *
 * So when a source is saved, every agent of a plugin installed and on here
 * whose `requires` names its kind gets it in `connectorSources`, at once.
 * Nothing else about the agent is touched, and a source it already has is
 * left alone.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { stringify } from 'yaml';
import { db } from '@/libs/DB';
import { loadWorkspace } from '@/libs/workspace/loader';
import { listPluginSlugs, resolvePlugins } from '@/libs/workspace/plugins';
import { boundConnectorSources } from '@/libs/workspace/requiredSources';
import { agentSchema, knowledgeSourceSchema, projectSchema } from '@/models/Schema';
import { appHistory, flushRuntime, installManifest } from './installBundle';

/**
 * Which of the installed plugins' agents would bind this source, by slug.
 * Pure over what the plugins ship: the caller decides what to write.
 * @param agents - The plugins' agents as loaded, with their `requires`.
 * @param source - The source just saved.
 * @param source.slug - Its slug.
 * @param source.kind - Its connector kind, e.g. `google-ads`.
 */
export function agentsRequiringSource(
  agents: ReadonlyArray<{ slug: string; requires?: { connectors: string[]; optional: string[] } }>,
  source: { slug: string; kind: string },
): string[] {
  return agents
    .filter(a => boundConnectorSources({ connectorSources: [], requires: a.requires }, [source]).includes(source.slug))
    .map(a => a.slug);
}

/**
 * Give a newly saved source to every installed plugin agent that requires its
 * kind. Returns the agents that got it. Never throws: a failure is the
 * caller's to log, and the save stands. A source scoped to one Project, or
 * one that is gone, binds nothing.
 * @param orgId - The workspace.
 * @param source - The source just saved.
 * @param source.slug - Its slug.
 * @param source.kind - Its connector kind, e.g. `google-ads`.
 */
export async function bindConnectedSource(orgId: string, source: { slug: string; kind: string }): Promise<string[]> {
  // A source connected for one Project is that Project's, never an agent's workspace-wide.
  const [row] = await db
    .select({ projectId: knowledgeSourceSchema.projectId })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.slug, source.slug)))
    .limit(1);
  if (!row || row.projectId !== null) {
    return [];
  }
  const [project] = await db
    .select({ name: projectSchema.name, timeZone: projectSchema.timeZone, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return [];
  }
  const shipped = new Set(listPluginSlugs());
  const on = new Set(project.enabledPlugins ?? []);
  const installed = (await appHistory(orgId)).installed.filter(s => on.has(s) && shipped.has(s));
  if (installed.length === 0) {
    return [];
  }

  // Read the agents the way an install does, through the loader, so
  // `requires` carries its defaults and plugin overlays are applied.
  const slugs = resolvePlugins(installed).map(p => p.manifest.slug);
  const dir = mkdtempSync(join(tmpdir(), 'vocion-bind-source-'));
  let wanting: string[];
  try {
    writeFileSync(join(dir, 'workspace.yaml'), stringify(installManifest({ orgId, name: project.name, timeZone: project.timeZone ?? null }, slugs)), 'utf8');
    wanting = agentsRequiringSource(loadWorkspace(dir).agents, source);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (wanting.length === 0) {
    return [];
  }

  const agents = await db
    .select({ id: agentSchema.id, slug: agentSchema.slug, connectorSources: agentSchema.connectorSources })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, wanting)));
  const bound: string[] = [];
  for (const agent of agents) {
    const current = agent.connectorSources ?? [];
    if (current.includes(source.slug)) {
      continue;
    }
    await db.update(agentSchema).set({ connectorSources: [...current, source.slug] }).where(eq(agentSchema.id, agent.id));
    bound.push(agent.slug);
  }
  if (bound.length > 0) {
    await flushRuntime();
  }
  return bound;
}
