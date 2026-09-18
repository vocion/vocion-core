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

async function workspaceDirFor(ctx: ActionContext): Promise<string> {
  const { workspacePathForProject } = await import('@/routers/Workspace');
  const dir = await workspacePathForProject(ctx.orgId);
  if (!dir) {
    throw new Error('this project has no workspace directory on this host, so its plugins cannot be changed here — edit workspace.yaml in the workspace repo');
  }
  return dir;
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
    // Refuse before a card exists when the write cannot happen here — a
    // deploy-managed box mounts the workspace read-only (EROFS, 2026-09-18),
    // and a "Failed" card teaches nobody anything. The person gets the door.
    const { workspacePathForProject } = await import('@/routers/Workspace');
    const dir = await workspacePathForProject(ctx.orgId);
    if (!dir) {
      return 'this project has no workspace directory on this host, so plugins are changed in the workspace repo: add the slug to `plugins:` in workspace.yaml and deploy';
    }
    const { workspaceWriteBlocker } = await import('@/services/PluginService');
    const blocker = workspaceWriteBlocker(dir);
    return blocker ? `plugins cannot be changed from here: ${blocker}` : undefined;
  },
  async reviewCard(_ctx, input) {
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
      ],
      nextAction: input.enabled
        ? 'Approving edits workspace.yaml, applies it, and the plugin\'s pages, agents and automations start working.'
        : 'Approving removes it from workspace.yaml and applies; its pages and nav rows disappear, nothing it wrote is deleted.',
      verbs: { approve: input.enabled ? 'Turn on' : 'Turn off', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const { setPluginEnabled } = await import('@/services/PluginService');
    const dir = await workspaceDirFor(ctx);
    const res = await setPluginEnabled({ orgId: ctx.orgId, workspaceDir: dir, slug: input.slug, enabled: input.enabled, appliedBy: ctx.invokedBy ?? 'plugin.enable' });
    return { before: res.before, after: res.after, applied: res.applied, workspaceDir: dir };
  },
  async undo(ctx, _input, result) {
    const { restorePlugins } = await import('@/services/PluginService');
    const before = Array.isArray(result.before) ? (result.before as string[]) : [];
    const dir = typeof result.workspaceDir === 'string' ? result.workspaceDir : await workspaceDirFor(ctx);
    const res = await restorePlugins({ orgId: ctx.orgId, workspaceDir: dir, plugins: before, appliedBy: `${ctx.invokedBy ?? 'plugin.enable'}:undo` });
    return { restored: before, applied: res.applied };
  },
};
