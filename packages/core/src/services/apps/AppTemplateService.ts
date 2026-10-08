/**
 * AppTemplateService — stand a template's function up in a workspace, in one move.
 *
 * Picking a template on an app's start page (`/dashboard/apps/<app>`) and
 * answering its two or three questions writes the template's files into the
 * workspace folder with the answers filled in, turns on the app's plugins and
 * the template's own, names the installing person accountable and the
 * template's lead as the workspace lead where the workspace names neither,
 * and applies — the same edit-then-apply the plugin switch makes
 * (`services/PluginService.ts`). What lands is ordinary context-as-code:
 * teams with their measures, agents with their budgets, missions,
 * automations and trust rules the workspace owns and edits from then on.
 *
 * Idempotent: a file already there with the same content is unchanged, a file
 * a person has edited since is kept as they left it (and named), trust rules
 * are added only for actions the workspace does not rule on yet, a plugin
 * already on stays on, and the apply upserts. Installing twice is installing
 * once. Tenant-scoped: everything is written to the one workspace folder that
 * belongs to the project and applied with that project's id — never another's.
 *
 * Refuses, in words, rather than half-installing: a workspace folder that is
 * another project's or read-only here (the door is the workspace repo), an
 * interview with an unanswered question, or files that would not load (every
 * file it wrote is put back as it was before the error is returned).
 */

import type { ApplyResult } from '@/libs/workspace/applier';
import type { AppTemplateContents, LoadedAppTemplate, TemplateFile } from '@/libs/workspace/appTemplates';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { loadApp } from '@/libs/workspace/apps';
import { answerInterview, appTemplateContents, editWorkspaceManifest, fillPlaceholders, loadAppTemplate, mergeTrustRules, renderAppTemplate, safeListAppTemplates, TEMPLATE_TRUST_FILE } from '@/libs/workspace/appTemplates';
import { workspaceFolderForProject } from '@/libs/workspace/project-path';
import { projectSchema, teamSchema } from '@/models/Schema';

/** Why an install did not happen, for the person. */
export type AppTemplateErrorCode = 'unknown' | 'answers' | 'blocked' | 'invalid';

export class AppTemplateError extends Error {
  readonly code: AppTemplateErrorCode;
  /** Per-question problems, for `answers`. */
  readonly problems?: Record<string, string>;
  constructor(code: AppTemplateErrorCode, message: string, problems?: Record<string, string>) {
    super(message);
    this.name = 'AppTemplateError';
    this.code = code;
    this.problems = problems;
  }
}

/** What one install did, said back to the person. */
export type TemplateInstallReceipt = {
  app: string;
  template: string;
  name: string;
  /** The workspace sha the apply recorded. */
  sha: string;
  files: {
    created: string[];
    unchanged: string[];
    /** Already there with different content — a person's edit, left alone. */
    kept: string[];
  };
  pluginsAdded: string[];
  trustRulesAdded: string[];
  leadSet: string | null;
  accountableUserSet: string | null;
  contents: AppTemplateContents;
  applied: {
    errors: ApplyResult['errors'];
    teams: ApplyResult['counts']['teams'];
    agents: ApplyResult['counts']['agents'];
    missions: ApplyResult['counts']['missions'];
    automations: ApplyResult['counts']['automations'];
  };
  /** Where to go next: the team report and a conversation with the lead. */
  links: { teamReport: string; chat: string };
};

type PlannedWrite = { path: string; abs: string; prior: string | null; content: string };

/**
 * The trust file the workspace already has (`trust.yaml` or `trust.yml`), or
 * where a new one goes.
 * @param dir - The workspace folder.
 */
function trustFileOf(dir: string): string {
  return ['trust.yaml', 'trust.yml'].map(n => join(dir, n)).find(existsSync) ?? join(dir, TEMPLATE_TRUST_FILE);
}

function manifestFileOf(dir: string): string | null {
  return ['workspace.yaml', 'workspace.yml'].map(n => join(dir, n)).find(existsSync) ?? null;
}

function readOrNull(abs: string): string | null {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/**
 * Put every planned file back as it was: rewrite what had content, remove
 * what the install created, and remove the folders it made for them.
 * @param writes - What was written.
 * @param createdDirs - Folders the install made, outermost first.
 */
function rollback(writes: readonly PlannedWrite[], createdDirs: readonly string[]): void {
  for (const w of [...writes].reverse()) {
    try {
      if (w.prior === null) {
        rmSync(w.abs, { force: true });
      } else {
        writeFileSync(w.abs, w.prior, 'utf8');
      }
    } catch (error) {
      console.error('apps: could not put a template file back', { path: w.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const d of [...createdDirs].reverse()) {
    rmSync(d, { recursive: true, force: true });
  }
}

/**
 * Make the folder a file goes in, returning the folders that did not exist,
 * outermost first — so a rollback can take them away again.
 * @param dir - The workspace folder (never removed).
 * @param fileAbs - The file about to be written.
 */
function ensureParent(dir: string, fileAbs: string): string[] {
  const made: string[] = [];
  for (let d = dirname(fileAbs); d.startsWith(`${dir}/`) && !existsSync(d); d = dirname(d)) {
    made.unshift(d);
  }
  mkdirSync(dirname(fileAbs), { recursive: true });
  return made;
}

/**
 * Install one template into one workspace folder and apply it to one project.
 * The folder must be the project's own and writable — the project-level entry
 * ({@link installAppTemplateForProject}) decides that; this is the half a test
 * can drive with a temporary folder.
 * @param opts - The install.
 * @param opts.orgId - The project the apply writes to.
 * @param opts.workspaceDir - Its workspace folder (absolute, or relative to the repo root).
 * @param opts.workspaceName - The workspace's name, for `{{workspace.name}}`.
 * @param opts.appId - The app.
 * @param opts.templateSlug - The template.
 * @param opts.answers - The interview's answers, by question key.
 * @param opts.installer - Who is installing — accountable for what it stands up.
 * @param opts.installer.email - Their email; resolved to them at apply.
 * @param opts.installer.name - Their name.
 * @param opts.appliedBy - For the workspace_version row.
 */
export async function installAppTemplate(opts: {
  orgId: string;
  workspaceDir: string;
  workspaceName: string;
  appId: string;
  templateSlug: string;
  answers: Readonly<Record<string, unknown>>;
  installer: { email: string; name: string };
  appliedBy: string;
}): Promise<TemplateInstallReceipt> {
  let app;
  let template: LoadedAppTemplate;
  try {
    app = loadApp(opts.appId);
    template = loadAppTemplate(opts.appId, opts.templateSlug);
  } catch (error) {
    throw new AppTemplateError('unknown', error instanceof Error ? error.message : String(error));
  }
  const answered = answerInterview(template.manifest, opts.answers, { installer: opts.installer, workspace: { name: opts.workspaceName } });
  if (!answered.ok) {
    const which = template.manifest.interview.filter(q => answered.problems[q.key]).map(q => `"${q.question}" ${answered.problems[q.key]}`);
    throw new AppTemplateError('answers', which.join('; '), answered.problems);
  }

  const dir = fromRepoRoot(opts.workspaceDir);
  const manifestFile = manifestFileOf(dir);
  if (!manifestFile) {
    throw new AppTemplateError('blocked', 'This workspace has no workspace.yaml on this host, so there is nowhere to write the template.');
  }

  // Plan every write before making any, so a refusal leaves nothing behind.
  const rendered: TemplateFile[] = renderAppTemplate(template, answered.values);
  const writes: PlannedWrite[] = [];
  const files: TemplateInstallReceipt['files'] = { created: [], unchanged: [], kept: [] };
  for (const file of rendered.filter(f => f.path !== TEMPLATE_TRUST_FILE)) {
    const abs = join(dir, file.path);
    const prior = readOrNull(abs);
    if (prior === null) {
      files.created.push(file.path);
      writes.push({ path: file.path, abs, prior, content: file.content });
    } else if (prior === file.content) {
      files.unchanged.push(file.path);
    } else {
      files.kept.push(file.path);
    }
  }
  let trustRulesAdded: string[] = [];
  const trust = rendered.find(f => f.path === TEMPLATE_TRUST_FILE);
  if (trust) {
    const abs = trustFileOf(dir);
    const prior = readOrNull(abs);
    const merged = mergeTrustRules(prior, trust.content);
    trustRulesAdded = merged.added;
    if (merged.content !== prior) {
      writes.push({ path: abs.slice(dir.length + 1), abs, prior, content: merged.content });
    }
  }
  const manifestPrior = readFileSync(manifestFile, 'utf8');
  const edit = editWorkspaceManifest(manifestPrior, {
    plugins: [...app.plugins, ...template.manifest.plugins],
    lead: template.manifest.lead,
    accountableUser: opts.installer.email,
  });
  if (edit.content !== manifestPrior) {
    writes.push({ path: manifestFile.slice(dir.length + 1), abs: manifestFile, prior: manifestPrior, content: edit.content });
  }

  const createdDirs: string[] = [];
  try {
    for (const w of writes) {
      createdDirs.push(...ensureParent(dir, w.abs));
      writeFileSync(w.abs, w.content, 'utf8');
    }
  } catch (error) {
    rollback(writes, createdDirs);
    throw new AppTemplateError('blocked', `The template's files could not be written here, so nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  }
  let loaded;
  try {
    loaded = loadWorkspace(dir);
  } catch (error) {
    rollback(writes, createdDirs);
    throw new AppTemplateError('invalid', `The template's files would not load in this workspace, so nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = await applyWorkspace(loaded, { orgId: opts.orgId, appliedBy: opts.appliedBy });
  invalidateCurrentContextShaCache();
  try {
    const { invalidateChipCache } = await import('@/services/chat/synthesis');
    invalidateChipCache(opts.orgId);
  } catch { /* the chips refresh on their own; the apply already landed */ }

  const lead = template.manifest.lead ?? null;
  return {
    app: opts.appId,
    template: template.manifest.slug,
    name: template.manifest.name,
    sha: result.sha,
    files,
    pluginsAdded: edit.pluginsAdded,
    trustRulesAdded,
    leadSet: edit.leadSet,
    accountableUserSet: edit.accountableUserSet,
    contents: appTemplateContents(template),
    applied: {
      errors: result.errors,
      teams: result.counts.teams,
      agents: result.counts.agents,
      missions: result.counts.missions,
      automations: result.counts.automations,
    },
    links: { teamReport: '/dashboard/team-report', chat: lead ? `/dashboard/chat?agent=${lead}` : '/dashboard/chat' },
  };
}

/** Where a template may be written for this project, or why not. */
export type TemplateWriteTarget = { ok: true; dir: string } | { ok: false; reason: string };

/**
 * Whether this project's own workspace folder is here and writable — the
 * same judgement the plugin switch makes (`pluginWriteTarget`). A folder that
 * is another project's, or none at all, means the project is applied from
 * git: the door is the workspace repo, and the reason says so.
 * @param orgId - The project.
 */
export async function templateWriteTarget(orgId: string): Promise<TemplateWriteTarget> {
  const { pluginWriteTarget, projectSlugFor } = await import('@/services/PluginService');
  const [slug, folder] = await Promise.all([projectSlugFor(orgId), workspaceFolderForProject(orgId)]);
  const target = await pluginWriteTarget(orgId, slug, folder?.path ?? null, folder?.explicit ?? false);
  if (target.mode === 'workspace' && target.workspaceDir) {
    return target.blocker ? { ok: false, reason: `A template cannot be written here: ${target.blocker}.` } : { ok: true, dir: target.workspaceDir };
  }
  const repoDir = target.repoFile.replace(/\/workspace\.yaml$/, '');
  return {
    ok: false,
    reason: `This workspace is applied from git${target.owner ? ` (the folder on this host is ${target.owner.name}'s)` : ''}, so a template cannot write into it from here. Add the template's files to ${repoDir}/ in the workspace repo and deploy.`,
  };
}

async function projectName(orgId: string): Promise<string> {
  const [row] = await db.select({ name: projectSchema.name }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.name ?? orgId;
}

/**
 * The project-level install: find the project's own folder (or say why there
 * is none here), then {@link installAppTemplate}.
 * @param opts - See {@link installAppTemplate}; the folder and name are found here.
 * @param opts.orgId - The project.
 * @param opts.appId - The app.
 * @param opts.templateSlug - The template.
 * @param opts.answers - The interview's answers.
 * @param opts.installer - Who is installing.
 * @param opts.installer.email - Their email.
 * @param opts.installer.name - Their name.
 * @param opts.appliedBy - For the workspace_version row.
 */
export async function installAppTemplateForProject(opts: {
  orgId: string;
  appId: string;
  templateSlug: string;
  answers: Readonly<Record<string, unknown>>;
  installer: { email: string; name: string };
  appliedBy: string;
}): Promise<TemplateInstallReceipt> {
  const target = await templateWriteTarget(opts.orgId);
  if (!target.ok) {
    throw new AppTemplateError('blocked', target.reason);
  }
  return installAppTemplate({ ...opts, workspaceDir: target.dir, workspaceName: await projectName(opts.orgId) });
}

/** One template as the start page shows it. */
export type AppTemplateCardData = {
  slug: string;
  name: string;
  icon: string;
  description: string;
  includes: string[];
  contents: AppTemplateContents;
  interview: Array<{ key: string; question: string; placeholder: string | null; help: string | null; defaultValue: string | null; maxLength: number }>;
  /** Every team it stands up already exists in this workspace. */
  installed: boolean;
};

export type AppTemplatesView = {
  app: { id: string; name: string; description: string; icon: string };
  templates: AppTemplateCardData[];
  /** Whether a template can be written for this project here, or why not. */
  writable: { ok: true } | { ok: false; reason: string };
};

/**
 * Teams that exist in this project, among the slugs asked about.
 * @param orgId - The project.
 * @param slugs - Team slugs.
 */
async function existingTeams(orgId: string, slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) {
    return new Set();
  }
  const rows = await db.select({ slug: teamSchema.slug }).from(teamSchema).where(and(eq(teamSchema.orgId, orgId), inArray(teamSchema.slug, [...slugs])));
  return new Set(rows.map(r => r.slug));
}

/**
 * An app's templates for one project: what each stands up, whether it is set
 * up here already, and whether this host can write one at all.
 * @param orgId - The project.
 * @param appId - The app.
 * @param viewer - The person looking, for defaults that name them.
 * @param viewer.email - Their email.
 * @param viewer.name - Their name.
 */
export async function appTemplatesForProject(orgId: string, appId: string, viewer: { email: string; name: string }): Promise<AppTemplatesView | null> {
  let app;
  try {
    app = loadApp(appId);
  } catch {
    return null;
  }
  const templates = safeListAppTemplates(appId);
  const [name, target] = await Promise.all([projectName(orgId), templateWriteTarget(orgId).catch(error => ({ ok: false as const, reason: error instanceof Error ? error.message : String(error) }))]);
  const contents = templates.map(appTemplateContents);
  const have = await existingTeams(orgId, contents.flatMap(c => c.teams));
  const builtins: Record<string, string> = { 'installer.email': viewer.email, 'installer.name': viewer.name || viewer.email, 'workspace.name': name };
  return {
    app: { id: app.id, name: app.name, description: app.description, icon: app.icon },
    templates: templates.map((t, i) => ({
      slug: t.manifest.slug,
      name: t.manifest.name,
      icon: t.manifest.icon,
      description: t.manifest.description,
      includes: t.manifest.includes,
      contents: contents[i]!,
      interview: t.manifest.interview.map(q => ({
        key: q.key,
        question: q.question,
        placeholder: q.placeholder ?? null,
        help: q.help ?? null,
        defaultValue: q.default ? fillPlaceholders(q.default, builtins) : null,
        maxLength: q.maxLength,
      })),
      installed: contents[i]!.teams.length > 0 && contents[i]!.teams.every(slug => have.has(slug)),
    })),
    writable: target.ok ? { ok: true } : { ok: false, reason: target.reason },
  };
}
