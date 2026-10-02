/**
 * The skills a plugin's setup needs on the workspace lead (#1028).
 *
 * Setup is a conversation with the project's lead agent, but a plugin's
 * skills mount on the specialist that owns them, so a setup step that names a
 * procedure would point at one the lead cannot read. A plugin lists those
 * skills in `recommend.setupSkills`; this resolves them for one agent: the
 * lead of a workspace gets the setup skills of every plugin the workspace has
 * on, and nobody else gets any. Core never names a skill.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { loadPlugin } from '@/libs/workspace/plugins';
import { projectSchema } from '@/models/Schema';

/**
 * A plugin's setup skills by plugin slug. Plugin manifests ship with the
 * build and never change while it runs, so each is read once rather than once
 * per turn. Only a manifest that loaded is cached; a broken one is retried.
 */
const setupSkillsByPlugin = new Map<string, string[]>();

/**
 * One plugin's setup skills.
 * @param pluginSlug - The plugin.
 * @returns Its `recommend.setupSkills`, or none when the manifest cannot load (logged, never thrown: a broken plugin must not stop a chat turn).
 */
function setupSkillsOf(pluginSlug: string): string[] {
  const cached = setupSkillsByPlugin.get(pluginSlug);
  if (cached) {
    return cached;
  }
  try {
    const skills = loadPlugin(pluginSlug).manifest.recommend.setupSkills;
    setupSkillsByPlugin.set(pluginSlug, skills);
    return skills;
  } catch (error) {
    logger.warn(`plugin "${pluginSlug}" setup skills were not mounted: its manifest did not load`, { error });
    return [];
  }
}

/**
 * The setup skills to mount on this agent, beyond its own.
 * @param orgId - The workspace.
 * @param agentSlug - The agent about to run.
 * @returns The enabled plugins' setup skills when the agent is the workspace lead, otherwise none.
 */
export async function setupSkillsForAgent(orgId: string, agentSlug: string): Promise<string[]> {
  const [project] = await db
    .select({ leadAgentSlug: projectSchema.leadAgentSlug, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project || project.leadAgentSlug !== agentSlug) {
    return [];
  }
  return [...new Set((project.enabledPlugins ?? []).flatMap(setupSkillsOf))];
}

/**
 * An agent's own skills with the setup skills added, each once.
 * @param ownSkills - The agent row's `skillSlugs`.
 * @param setupSkills - What `setupSkillsForAgent` returned.
 */
export function withSetupSkills(ownSkills: string[], setupSkills: string[]): string[] {
  return [...new Set([...ownSkills, ...setupSkills])];
}
