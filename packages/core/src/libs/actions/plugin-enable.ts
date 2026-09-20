/**
 * plugin.enable — turn a workspace plugin on (or off) from a conversation.
 *
 * The chat knows which plugins exist and are off (`list_capabilities`, the
 * capabilities note in the system prompt). When the conversation calls for
 * one — a person asks where the voice rules live and there is no wiki, asks
 * for a proposal with no proposals plugin — the agent recommends it as a
 * one-tap card (`recommend_action`) or proposes it outright. Either way the
 * write is this action: an edit to `workspace.yaml` followed by an apply
 * (`services/PluginService.ts`), so the workspace stays the source of truth.
 *
 * Reversible — `undo` restores the `plugins:` list that was there — and
 * internal, so under the done-for-you default it executes above the
 * confidence bar and shows with Undo one move away; below it, a person
 * decides on the card, which names exactly what turning it on adds.
 *
 * Under a shared mount the folder on this host may be ANOTHER project's; then
 * the write is to `project.enabled_plugins` alone and the result's `note`
 * tells the person the project is applied from git and which repo file to
 * change (`pluginWriteTarget`). The mounted project's manifest is never edited
 * from a different project.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';
import { listPluginSlugs, loadPlugin, pluginContents } from '@/libs/workspace/plugins';

const pluginEnableInput = z.object({
  /** The plugin, by slug — `wiki`, `data-rooms`, `proposals`. */
  slug: z.string().min(1).max(60),
  /** On (default) or off. */
  enabled: z.boolean().default(true),
});

export type PluginEnableInput = z.infer<typeof pluginEnableInput>;

/**
 * The project, the folder resolved for it, and where a toggle may write.
 * @param ctx
 */
async function targetFor(ctx: ActionContext) {
  const [{ workspaceFolderForProject }, { loadProject }, { pluginWriteTarget }] = await Promise.all([import('@/routers/Workspace'), import('@/routers/AuthGuards'), import('@/services/PluginService')]);
  const [project, folder] = await Promise.all([loadProject(ctx.orgId), workspaceFolderForProject(ctx.orgId)]);
  const projectSlug = project?.slug ?? ctx.orgId;
  const workspaceDir = folder?.path ?? null;
  const explicit = folder?.explicit ?? false;
  return { projectSlug, workspaceDir, explicit, target: await pluginWriteTarget(ctx.orgId, projectSlug, workspaceDir, explicit) };
}

export const pluginEnableAction: Action<typeof pluginEnableInput> = {
  id: 'plugin.enable',
  name: 'Turn a plugin on or off',
  description: 'Turn a workspace plugin (wiki, data-rooms, proposals) on or off — edits workspace.yaml and applies it. Reversible.',
  inputSchema: pluginEnableInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `plugin.enable:${input.slug}:${input.enabled ? 'on' : 'off'}`,
  async precheck(ctx, input) {
    if (!listPluginSlugs().includes(input.slug)) {
      return `no plugin "${input.slug}" ships with this core; the catalogue is: ${listPluginSlugs().join(', ')}`;
    }
    // Refuse before a card exists when the project's own folder cannot be
    // written here — a deploy-managed box mounts it read-only (EROFS,
    // 2026-09-18), and a "Failed" card teaches nobody anything. Another
    // project's folder is not refused: the write goes to this project's list
    // alone, and the result says so.
    const { target } = await targetFor(ctx);
    return target.mode === 'workspace' && target.blocker ? `plugins cannot be changed from here: ${target.blocker}` : undefined;
  },
  async reviewCard(ctx, input) {
    const { target } = await targetFor(ctx);
    const plugin = loadPlugin(input.slug);
    const c = pluginContents(plugin);
    const adds = [
      c.agents.length ? `${c.agents.length} agent${c.agents.length === 1 ? '' : 's'} (${c.agents.join(', ')})` : null,
      c.skills.length ? `${c.skills.length} skill${c.skills.length === 1 ? '' : 's'}` : null,
      c.pages.length ? `${c.pages.length} page${c.pages.length === 1 ? '' : 's'}` : null,
      c.automations.length ? `${c.automations.length} automation${c.automations.length === 1 ? '' : 's'}` : null,
      c.objectTypes.length ? `${c.objectTypes.length} object type${c.objectTypes.length === 1 ? '' : 's'}` : null,
      c.teams.length ? `${c.teams.length} team with measures` : null,
    ].filter((x): x is string => x !== null);
    return {
      title: `${input.enabled ? 'Turn on' : 'Turn off'} ${plugin.manifest.name}`,
      system: 'Workspace',
      summary: plugin.manifest.description,
      fields: [
        { label: 'Plugin', value: `${plugin.manifest.name} v${plugin.manifest.version}`, href: `/dashboard/plugins/${plugin.manifest.slug}` },
        { label: input.enabled ? 'Adds' : 'Removes', value: adds.join(' · ') || 'configuration only' },
        ...(plugin.manifest.depends.length > 0 ? [{ label: 'Also turns on', value: plugin.manifest.depends.join(', ') }] : []),
        ...(target.mode === 'project' ? [{ label: 'Writes', value: `this project's plugin list only — the workspace is applied from git; make it stick in ${target.repoFile}` }] : []),
      ],
      nextAction: target.mode === 'project'
        ? `Approving updates this project's plugins${input.enabled ? ' and the plugin\'s pages start working' : ''}; the mounted workspace folder is another project's and is left alone. Change plugins: in ${target.repoFile} in the workspace repo to make it permanent.`
        : input.enabled
          ? 'Approving edits workspace.yaml, applies it, and the plugin\'s pages, agents and automations start working.'
          : 'Approving removes it from workspace.yaml and applies; its pages and nav rows disappear, nothing it wrote is deleted.',
      verbs: { approve: input.enabled ? 'Turn on' : 'Turn off', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { togglePluginForProject } = await import('@/services/PluginService');
    const { projectSlug, workspaceDir, explicit } = await targetFor(ctx);
    const res = await togglePluginForProject({ orgId: ctx.orgId, projectSlug, workspaceDir, explicit, slug: input.slug, enabled: input.enabled, appliedBy: ctx.invokedBy ?? 'plugin.enable' });
    // `note` rides the result so whoever ran this — the chat, the card — can
    // say the folder was left alone and where the permanent change goes.
    return { before: res.before, after: res.after, applied: res.applied, mode: res.mode, workspaceDir, ...(res.note ? { note: res.note, repoFile: res.repoFile } : {}) };
  },
  async undo(ctx, _input, result) {
    const { restorePluginsForProject } = await import('@/services/PluginService');
    const before = Array.isArray(result.before) ? (result.before as string[]) : [];
    const { projectSlug, workspaceDir, explicit } = await targetFor(ctx);
    const res = await restorePluginsForProject({ orgId: ctx.orgId, projectSlug, workspaceDir, explicit, plugins: before, appliedBy: `${ctx.invokedBy ?? 'plugin.enable'}:undo` });
    return { restored: before, applied: res.applied, mode: res.mode };
  },
};
