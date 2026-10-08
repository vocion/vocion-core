/**
 * app.install — add an app to this workspace, from a conversation.
 *
 * An app ships no capability of its own: it is the plugins it is made of
 * (`templates/apps/<id>/app.yaml`), and a workspace has it once one of them is
 * on (`features/navigation/apps.ts`). So adding one is turning its plugins on —
 * the same write `plugin.enable` makes, once for the whole app rather than
 * once per plugin (`PluginService.addPluginsForProject`), so a workspace with
 * its own folder is applied once.
 *
 * Reversible: `undo` puts the plugin list that was there back. Internal. The
 * workspace lead offers it as a one-click card while setting a workspace up
 * (`propose_setup`); the person's press is the decision, and the card shows
 * Undo once it is done.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';

const appInstallInput = z.object({
  /** The app, by id — what `setup_options` lists. */
  app: z.string().min(1).max(60),
});

export type AppInstallInput = z.infer<typeof appInstallInput>;

/**
 * The project, the folder resolved for it, and where a plugin write may go —
 * the same resolution `plugin.enable` makes.
 * @param ctx - The action's context.
 */
async function targetFor(ctx: ActionContext) {
  const [{ workspaceFolderForProject }, { projectSlugFor }] = await Promise.all([import('@/routers/Workspace'), import('@/services/PluginService')]);
  const [projectSlug, folder] = await Promise.all([projectSlugFor(ctx.orgId), workspaceFolderForProject(ctx.orgId)]);
  return { projectSlug, workspaceDir: folder?.path ?? null, explicit: folder?.explicit ?? false };
}

/**
 * The app's manifest, or null when this core ships no such app.
 * @param id - The app id.
 */
async function appFor(id: string) {
  const { safeListApps } = await import('@/libs/workspace/apps');
  return safeListApps().find(a => a.id === id) ?? null;
}

export const appInstallAction: Action<typeof appInstallInput> = {
  id: 'app.install',
  name: 'Add an app',
  description: 'Add an app to this workspace (turns on the plugins the app is made of, then applies). Reversible — undo turns them back off.',
  inputSchema: appInstallInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `app.install:${input.app}`,

  async precheck(ctx, input) {
    const app = await appFor(input.app);
    if (!app || app.hidden) {
      const { safeListApps } = await import('@/libs/workspace/apps');
      const offered = safeListApps().filter(a => !a.core && !a.hidden).map(a => a.id);
      return `no app "${input.app}" — this installation offers: ${offered.join(', ') || 'none'}`;
    }
    if (app.core) {
      return `${app.name} is part of every workspace already`;
    }
    if (app.plugins.length === 0) {
      return `${app.name} has nothing to turn on here`;
    }
    const { enabledPluginsForOrg } = await import('@/services/PluginService');
    const on = new Set(await enabledPluginsForOrg(ctx.orgId));
    if (app.plugins.every(p => on.has(p))) {
      return `${app.name} is already in this workspace`;
    }
    return undefined;
  },

  async reviewCard(_ctx, input) {
    const app = await appFor(input.app);
    const name = app?.name ?? input.app;
    return {
      title: `Add ${name}`,
      system: 'Workspace',
      headline: `Add ${name} to this workspace.`,
      badges: [{ label: 'Reversible' }],
      summary: app?.description,
      fields: [{ label: 'App', value: `${name} — ${app?.description ?? ''}`.trim() }],
      nextAction: `Adding turns ${name} on here; its pages appear in the rail. Undo turns it back off.`,
      verbs: { approve: 'Add', reject: 'Not now' },
    };
  },

  async execute(ctx, input) {
    const app = await appFor(input.app);
    if (!app) {
      return { added: false, app: input.app };
    }
    const { addPluginsForProject } = await import('@/services/PluginService');
    const target = await targetFor(ctx);
    const res = await addPluginsForProject({ orgId: ctx.orgId, ...target, slugs: app.plugins, appliedBy: ctx.invokedBy ?? 'app.install' });
    // `before` is what undo restores; the entry is where the app opens.
    return { added: true, app: app.id, name: app.name, entry: app.entry, before: res.before, after: res.after, mode: res.mode };
  },

  async undo(ctx, _input, result) {
    if (result.added !== true) {
      return { undone: false, reason: 'the app was not added' };
    }
    const { restorePluginsForProject } = await import('@/services/PluginService');
    const before = Array.isArray(result.before) ? (result.before as string[]) : [];
    const target = await targetFor(ctx);
    const res = await restorePluginsForProject({ orgId: ctx.orgId, ...target, plugins: before, appliedBy: `${ctx.invokedBy ?? 'app.install'}:undo` });
    return { undone: true, restored: before, mode: res.mode };
  },
};
