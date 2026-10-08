/**
 * app.install_template — stand an app template up in this workspace, from a
 * conversation.
 *
 * The same install the app's start page makes (`AppTemplateService`, #1240):
 * the template's teams, agents, missions, automations and trust rules written
 * into the workspace's own folder with the interview filled in (every
 * question has a default, so a setup card with no answers still installs),
 * the app's plugins turned on, and an apply. What lands is the workspace's own
 * context-as-code from then on.
 *
 * Reversible. `execute` keeps what the install changed — the files it created,
 * and `workspace.yaml` and the trust file as they were before — and `undo`
 * puts all of that back and applies again, so the template's agents retire
 * and its teams, missions and automations go with the files. A file a person
 * had already written is never touched by either: the install keeps it, and
 * the undo leaves it.
 *
 * Internal. The workspace lead offers it as a one-click card while setting a
 * workspace up (`propose_setup`); a workspace applied from git has nowhere to
 * write one here, and the precheck says so before a card is drawn.
 */

import type { Action, ActionContext } from './types';
import { z } from 'zod';

const appTemplateInstallInput = z.object({
  /** The app the template belongs to — what `setup_options` lists. */
  app: z.string().min(1).max(60),
  /** The template, by slug. */
  template: z.string().min(1).max(60),
  /** Interview answers the person gave; every question left out takes its default. */
  answers: z.record(z.string(), z.string().max(2000)).default({}),
});

export type AppTemplateInstallInput = z.infer<typeof appTemplateInstallInput>;

/**
 * The template, or null when this core ships no such template.
 * @param app - The app id.
 * @param template - The template slug.
 */
async function templateFor(app: string, template: string) {
  const { loadAppTemplate } = await import('@/libs/workspace/appTemplates');
  try {
    return loadAppTemplate(app, template);
  } catch {
    return null;
  }
}

/**
 * The person behind this run, for the template to name accountable.
 * @param ctx - The action's context.
 */
async function installerOf(ctx: ActionContext): Promise<{ userId: string; email: string; name: string } | null> {
  const id = ctx.reviewedBy ?? ctx.origin?.userId ?? ctx.invokedBy;
  if (!id) {
    return null;
  }
  const [{ db }, { userSchema }, { eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
  const [row] = await db.select({ email: userSchema.email, name: userSchema.name }).from(userSchema).where(eq(userSchema.id, id)).limit(1);
  return row?.email ? { userId: id, email: row.email, name: row.name ?? row.email } : null;
}

/**
 * A file's text, or null when it is not there.
 * @param abs
 */
async function textOrNull(abs: string): Promise<string | null> {
  const { existsSync, readFileSync } = await import('node:fs');
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

export const appTemplateInstallAction: Action<typeof appTemplateInstallInput> = {
  id: 'app.install_template',
  name: 'Start from a template',
  description: 'Stand an app template up in this workspace — its teams, agents, missions, automations and trust rules, with the interview\'s answers filled in (defaults where none were given) — then apply. Reversible — undo removes what the install created and applies again.',
  inputSchema: appTemplateInstallInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `app.install_template:${input.app}:${input.template}`,

  async precheck(ctx, input) {
    const template = await templateFor(input.app, input.template);
    if (!template) {
      const { listAppIdsWithTemplates, listAppTemplateSlugs } = await import('@/libs/workspace/appTemplates');
      const offered = listAppIdsWithTemplates().flatMap(app => listAppTemplateSlugs(app).map(slug => `${app}/${slug}`));
      return `no template "${input.app}/${input.template}" — this installation offers: ${offered.join(', ') || 'none'}`;
    }
    const { templateWriteTarget } = await import('@/services/apps/AppTemplateService');
    const target = await templateWriteTarget(ctx.orgId);
    if (!target.ok) {
      return target.reason;
    }
    const { appTemplateContents } = await import('@/libs/workspace/appTemplates');
    const teams = appTemplateContents(template).teams;
    if (teams.length > 0) {
      const [{ db }, { teamSchema }, { and, eq, inArray }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
      const have = await db.select({ slug: teamSchema.slug }).from(teamSchema).where(and(eq(teamSchema.orgId, ctx.orgId), inArray(teamSchema.slug, teams)));
      if (have.length === teams.length) {
        return `${template.manifest.name} is already set up in this workspace`;
      }
    }
    return undefined;
  },

  async reviewCard(_ctx, input) {
    const template = await templateFor(input.app, input.template);
    const name = template?.manifest.name ?? input.template;
    return {
      title: `Start from ${name}`,
      system: 'Workspace',
      headline: `Set up ${name} in this workspace.`,
      badges: [{ label: 'Reversible' }],
      summary: template?.manifest.description,
      fields: (template?.manifest.includes ?? []).map(line => ({ label: 'Includes', value: line })),
      nextAction: 'Starting writes the template into the workspace, with you accountable, and applies it. Undo takes back what it created.',
      verbs: { approve: 'Start', reject: 'Not now' },
    };
  },

  async execute(ctx, input) {
    const installer = await installerOf(ctx);
    if (!installer) {
      throw new Error('A template names a person accountable, and this run has nobody with an email to name. Start it from the app\'s page instead.');
    }
    const [{ installAppTemplateForProject, templateWriteTarget }, { fromRepoRoot }, { join }] = await Promise.all([
      import('@/services/apps/AppTemplateService'),
      import('@/libs/repo-root'),
      import('node:path'),
    ]);
    const target = await templateWriteTarget(ctx.orgId);
    if (!target.ok) {
      throw new Error(target.reason);
    }
    // What undo puts back: the two shared files as they were, before the install merges into them.
    const dir = fromRepoRoot(target.dir);
    const manifestFile = (await textOrNull(join(dir, 'workspace.yaml'))) !== null ? 'workspace.yaml' : 'workspace.yml';
    const trustFile = (await textOrNull(join(dir, 'trust.yml'))) !== null && (await textOrNull(join(dir, 'trust.yaml'))) === null ? 'trust.yml' : 'trust.yaml';
    const priorManifest = await textOrNull(join(dir, manifestFile));
    const priorTrust = await textOrNull(join(dir, trustFile));
    const receipt = await installAppTemplateForProject({
      orgId: ctx.orgId,
      appId: input.app,
      templateSlug: input.template,
      answers: input.answers,
      installer: { email: installer.email, name: installer.name },
      appliedBy: `user:${installer.userId}`,
    });
    return {
      installed: true,
      app: receipt.app,
      template: receipt.template,
      name: receipt.name,
      created: receipt.files.created,
      kept: receipt.files.kept,
      manifestFile,
      priorManifest,
      trustFile,
      priorTrust,
      leadSet: receipt.leadSet,
      sha: receipt.sha,
    };
  },

  async undo(ctx, _input, result) {
    if (result.installed !== true) {
      return { undone: false, reason: 'the template was not installed' };
    }
    const [{ templateWriteTarget }, { fromRepoRoot }, { dirname, resolve }, fs, { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace }] = await Promise.all([
      import('@/services/apps/AppTemplateService'),
      import('@/libs/repo-root'),
      import('node:path'),
      import('node:fs'),
      import('@/libs/workspace'),
    ]);
    const target = await templateWriteTarget(ctx.orgId);
    if (!target.ok) {
      throw new Error(target.reason);
    }
    const dir = fromRepoRoot(target.dir);
    const inside = (rel: string) => {
      const abs = resolve(dir, rel);
      return abs.startsWith(`${dir}/`) ? abs : null;
    };
    const created = Array.isArray(result.created) ? (result.created as string[]) : [];
    for (const rel of created) {
      const abs = inside(rel);
      if (abs) {
        fs.rmSync(abs, { force: true });
        // A folder the install made for its files goes with them, once empty.
        const parent = dirname(abs);
        if (parent !== dir && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
          fs.rmSync(parent, { recursive: true, force: true });
        }
      }
    }
    for (const [file, prior] of [[result.manifestFile, result.priorManifest], [result.trustFile, result.priorTrust]] as const) {
      const abs = typeof file === 'string' ? inside(file) : null;
      if (!abs) {
        continue;
      }
      if (typeof prior === 'string') {
        fs.writeFileSync(abs, prior, 'utf8');
      } else {
        fs.rmSync(abs, { force: true });
      }
    }
    const applied = await applyWorkspace(loadWorkspace(dir), { orgId: ctx.orgId, appliedBy: `${ctx.invokedBy ?? 'app.install_template'}:undo` });
    invalidateCurrentContextShaCache();
    return { undone: true, removed: created, sha: applied.sha };
  },
};
