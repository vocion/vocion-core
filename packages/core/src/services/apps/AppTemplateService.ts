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
import type { FunctionPlan } from '@/libs/workspace/functionPlan';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fromRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { loadApp } from '@/libs/workspace/apps';
import { answerInterview, appTemplateContents, editWorkspaceManifest, fillPlaceholders, loadAppTemplate, mergeTrustRules, renderAppTemplate, safeListAppTemplates, TEMPLATE_TRUST_FILE } from '@/libs/workspace/appTemplates';
import { FunctionPlanSchema, planContents, planLead, planProblems, renderedProblems, renderFunctionPlan } from '@/libs/workspace/functionPlan';
import { workspaceFolderForProject } from '@/libs/workspace/project-path';
import { agentSchema, projectSchema, teamSchema } from '@/models/Schema';
import { catalogReader, planContextFor } from './planContext';

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
 * What an install changed, kept on its run so the whole install can be put
 * back as one unit (`undoInstall`): every file it wrote with what was there
 * before (null: it was new) and a hash of what it wrote, the folders it made,
 * and the teams and agents that did not exist before it.
 */
export type InstallUndo = {
  /** The workspace folder, absolute. */
  dir: string;
  writes: Array<{ path: string; prior: string | null; wroteSha: string }>;
  createdDirs: string[];
  teamsCreated: string[];
  agentsCreated: string[];
};

/** What one install stands up — a template's or a drafted plan's, the same shape. */
export type InstallSource = {
  app: string;
  /** The template's slug, or `blank` for a drafted plan. */
  template: string;
  name: string;
  files: TemplateFile[];
  plugins: string[];
  lead?: string;
  contents: AppTemplateContents;
};

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * THE INSTALL — one path for a template and a drafted plan alike, so both
 * produce the same kind of records (principle 6). Plans every write before
 * making any; writes; loads (putting every write back when the result would
 * not load); applies; and returns the receipt with what an undo needs.
 * @param opts - The install.
 * @param opts.orgId - The project the apply writes to.
 * @param opts.workspaceDir - Its workspace folder (absolute, or relative to the repo root).
 * @param opts.source - What to stand up, already rendered.
 * @param opts.installer - Who is installing — accountable for what it stands up.
 * @param opts.installer.email - Their email; resolved to them at apply.
 * @param opts.appliedBy - For the workspace_version row.
 */
export async function installRendered(opts: {
  orgId: string;
  workspaceDir: string;
  source: InstallSource;
  installer: { email: string };
  appliedBy: string;
}): Promise<TemplateInstallReceipt & { undo: InstallUndo }> {
  const { source } = opts;
  const dir = fromRepoRoot(opts.workspaceDir);
  const manifestFile = manifestFileOf(dir);
  if (!manifestFile) {
    throw new AppTemplateError('blocked', 'This workspace has no workspace.yaml on this host, so there is nowhere to write it.');
  }

  // Plan every write before making any, so a refusal leaves nothing behind.
  const writes: PlannedWrite[] = [];
  const files: TemplateInstallReceipt['files'] = { created: [], unchanged: [], kept: [] };
  for (const file of source.files.filter(f => f.path !== TEMPLATE_TRUST_FILE)) {
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
  const trust = source.files.find(f => f.path === TEMPLATE_TRUST_FILE);
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
  const edit = editWorkspaceManifest(manifestPrior, { plugins: source.plugins, lead: source.lead, accountableUser: opts.installer.email });
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
    throw new AppTemplateError('blocked', `The files could not be written here, so nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  }
  let loaded;
  try {
    loaded = loadWorkspace(dir);
  } catch (error) {
    rollback(writes, createdDirs);
    throw new AppTemplateError('invalid', `The files would not load in this workspace, so nothing was changed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // What exists before the apply, so an undo removes only what this made.
  const [teamsBefore, agentsBefore] = await Promise.all([
    db.select({ slug: teamSchema.slug }).from(teamSchema).where(eq(teamSchema.orgId, opts.orgId)),
    db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, opts.orgId)),
  ]);
  const result = await applyWorkspace(loaded, { orgId: opts.orgId, appliedBy: opts.appliedBy });
  await refreshCaches(opts.orgId);

  const hadTeam = new Set(teamsBefore.map(t => t.slug));
  const hadAgent = new Set(agentsBefore.map(a => a.slug));
  return {
    app: source.app,
    template: source.template,
    name: source.name,
    sha: result.sha,
    files,
    pluginsAdded: edit.pluginsAdded,
    trustRulesAdded,
    leadSet: edit.leadSet,
    accountableUserSet: edit.accountableUserSet,
    contents: source.contents,
    applied: {
      errors: result.errors,
      teams: result.counts.teams,
      agents: result.counts.agents,
      missions: result.counts.missions,
      automations: result.counts.automations,
    },
    links: { teamReport: '/dashboard/team-report', chat: source.lead ? `/dashboard/chat?agent=${source.lead}` : '/dashboard/chat' },
    undo: {
      dir,
      writes: writes.map(w => ({ path: w.path, prior: w.prior, wroteSha: sha(w.content) })),
      createdDirs: createdDirs.map(d => d.slice(dir.length + 1)),
      teamsCreated: source.contents.teams.filter(t => !hadTeam.has(t)),
      agentsCreated: source.contents.agents.filter(a => !hadAgent.has(a)),
    },
  };
}

async function refreshCaches(orgId: string): Promise<void> {
  invalidateCurrentContextShaCache();
  try {
    const { invalidateChipCache } = await import('@/services/chat/synthesis');
    invalidateChipCache(orgId);
  } catch { /* the chips refresh on their own; the apply already landed */ }
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
}): Promise<TemplateInstallReceipt & { undo: InstallUndo }> {
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
  return installRendered({
    orgId: opts.orgId,
    workspaceDir: opts.workspaceDir,
    installer: opts.installer,
    appliedBy: opts.appliedBy,
    source: {
      app: opts.appId,
      template: template.manifest.slug,
      name: template.manifest.name,
      files: renderAppTemplate(template, answered.values),
      plugins: [...app.plugins, ...template.manifest.plugins],
      lead: template.manifest.lead,
      contents: appTemplateContents(template),
    },
  });
}

/** What an undo did, said back to the person. */
export type UndoReceipt = {
  /** Files put back as they were before the install (or removed, when it made them). */
  restored: string[];
  /** Files changed since the install — left as they are, and named. */
  kept: string[];
  teamsRemoved: string[];
  agentsRetired: string[];
  sha: string | null;
  errors: ApplyResult['errors'];
};

/**
 * UNDO AN INSTALL, AS ONE UNIT. Every file it wrote goes back to what was
 * there before (a file it created is removed), unless someone changed that
 * file since — that one is kept and named; the workspace is applied again,
 * which retires the agents, missions and automations it brought and puts the
 * trust bars back; the teams and the budget rows it created are removed.
 * Scoped to the one project the install wrote to.
 * @param opts - The undo.
 * @param opts.orgId - The project.
 * @param opts.undo - What the install recorded.
 * @param opts.appliedBy - For the workspace_version row.
 */
export async function undoInstall(opts: { orgId: string; undo: InstallUndo; appliedBy: string }): Promise<UndoReceipt> {
  const { undo } = opts;
  const restored: string[] = [];
  // One unit, or nothing: a file someone changed since would be lost, and
  // putting back the rest around it can leave a workspace that does not load.
  const changed = undo.writes.filter((w) => {
    const now = readOrNull(join(undo.dir, w.path));
    return now !== null && sha(now) !== w.wroteSha;
  }).map(w => w.path);
  if (changed.length > 0) {
    throw new AppTemplateError('blocked', `Not undone — ${changed.length === 1 ? 'a file' : 'files'} it wrote changed since, and undoing would lose that: ${changed.join(', ')}. Nothing was changed. Put back or remove ${changed.length === 1 ? 'it' : 'them'} first, or edit the workspace by hand.`);
  }
  const kept: string[] = [];
  const now = new Map(undo.writes.map(w => [w.path, readOrNull(join(undo.dir, w.path))]));
  for (const w of [...undo.writes].reverse()) {
    const abs = join(undo.dir, w.path);
    if (w.prior === null) {
      rmSync(abs, { force: true });
    } else {
      writeFileSync(abs, w.prior, 'utf8');
    }
    restored.push(w.path);
  }
  for (const d of [...undo.createdDirs].reverse()) {
    try {
      rmdirSync(join(undo.dir, d));
    } catch { /* not empty: something else lives there now */ }
  }
  let loaded;
  try {
    loaded = loadWorkspace(undo.dir);
  } catch (error) {
    // Put the install's files back where they were, so a failed undo changes nothing.
    for (const w of undo.writes) {
      const was = now.get(w.path);
      if (was !== null && was !== undefined) {
        mkdirSync(dirname(join(undo.dir, w.path)), { recursive: true });
        writeFileSync(join(undo.dir, w.path), was, 'utf8');
      }
    }
    throw new AppTemplateError('invalid', `Not undone — the workspace would not load without these files, so they were left as they are: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = await applyWorkspace(loaded, { orgId: opts.orgId, appliedBy: opts.appliedBy });
  await refreshCaches(opts.orgId);
  const stillTeams = new Set(loaded.teams.map(t => t.slug));
  const stillAgents = new Set(loaded.agents.map(a => a.slug));
  const teamsRemoved = undo.teamsCreated.filter(t => !stillTeams.has(t));
  if (teamsRemoved.length > 0) {
    await db.delete(teamSchema).where(and(eq(teamSchema.orgId, opts.orgId), inArray(teamSchema.slug, teamsRemoved)));
  }
  const agentsRetired = undo.agentsCreated.filter(a => !stillAgents.has(a));
  const { removeBudget } = await import('@/services/BudgetService');
  for (const agentSlug of agentsRetired) {
    await removeBudget({ orgId: opts.orgId, agentSlug, period: 'daily' });
    await removeBudget({ orgId: opts.orgId, agentSlug, period: 'monthly' });
  }
  return { restored, kept, teamsRemoved, agentsRetired, sha: result.sha, errors: result.errors };
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

/**
 * The project's name, for `{{workspace.name}}`.
 * @param orgId - The project.
 */
export async function projectName(orgId: string): Promise<string> {
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
}): Promise<TemplateInstallReceipt & { undo: InstallUndo }> {
  const target = await templateWriteTarget(opts.orgId);
  if (!target.ok) {
    throw new AppTemplateError('blocked', target.reason);
  }
  return installAppTemplate({ ...opts, workspaceDir: target.dir, workspaceName: await projectName(opts.orgId) });
}

/**
 * Validate a drafted (and edited) plan for an app: its schema, then what it
 * cites against what ships. Throws `invalid` with every problem named.
 * @param appId - The app.
 * @param raw - The plan as submitted.
 */
export function checkedPlan(appId: string, raw: unknown): FunctionPlan {
  const parsed = FunctionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppTemplateError('invalid', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const problems = planProblems(parsed.data, planContextFor(appId));
  if (problems.length === 0) {
    problems.push(...renderedProblems(renderFunctionPlan(parsed.data, { installer: { email: 'check@example.com' }, catalog: catalogReader() })));
  }
  if (problems.length > 0) {
    throw new AppTemplateError('invalid', problems.join('; '));
  }
  return parsed.data;
}

/**
 * Stand a drafted plan up in one workspace folder — rendered into the same
 * files a template writes and installed through the same path, so a blank
 * start and a template produce the same kind of records.
 * @param opts - The install.
 * @param opts.orgId - The project.
 * @param opts.workspaceDir - Its workspace folder.
 * @param opts.appId - The app.
 * @param opts.plan - The plan, as previewed and edited.
 * @param opts.installer - Accountable for every team it stands up.
 * @param opts.installer.email - Their email.
 * @param opts.appliedBy - For the workspace_version row.
 */
export async function installFunctionPlan(opts: { orgId: string; workspaceDir: string; appId: string; plan: unknown; installer: { email: string }; appliedBy: string }): Promise<TemplateInstallReceipt & { undo: InstallUndo }> {
  let app;
  try {
    app = loadApp(opts.appId);
  } catch (error) {
    throw new AppTemplateError('unknown', error instanceof Error ? error.message : String(error));
  }
  const plan = checkedPlan(opts.appId, opts.plan);
  const files = renderFunctionPlan(plan, { installer: opts.installer, catalog: catalogReader() });
  return installRendered({
    orgId: opts.orgId,
    workspaceDir: opts.workspaceDir,
    installer: opts.installer,
    appliedBy: opts.appliedBy,
    source: {
      app: opts.appId,
      template: 'blank',
      name: plan.name,
      files,
      plugins: [...app.plugins, ...plan.reuse.plugins.map(p => p.slug)],
      lead: planLead(plan),
      contents: planContents(plan, files),
    },
  });
}

/**
 * The project-level blank install: the project's own folder, then {@link installFunctionPlan}.
 * @param opts - See {@link installFunctionPlan}; the folder is found here.
 * @param opts.orgId - The project.
 * @param opts.appId - The app.
 * @param opts.plan - The plan.
 * @param opts.installer - Accountable for it.
 * @param opts.installer.email - Their email.
 * @param opts.appliedBy - For the workspace_version row.
 */
export async function installFunctionPlanForProject(opts: { orgId: string; appId: string; plan: unknown; installer: { email: string }; appliedBy: string }): Promise<TemplateInstallReceipt & { undo: InstallUndo }> {
  const target = await templateWriteTarget(opts.orgId);
  if (!target.ok) {
    throw new AppTemplateError('blocked', target.reason);
  }
  return installFunctionPlan({ ...opts, workspaceDir: target.dir });
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

/** The app's blank start as the start page shows it. */
export type BlankStartData = {
  label: string;
  description: string;
  describe: { question: string; placeholder: string | null; help: string | null; maxLength: number };
  interview: AppTemplateCardData['interview'];
};

export type AppTemplatesView = {
  app: { id: string; name: string; description: string; icon: string };
  templates: AppTemplateCardData[];
  /** Describe your own: the app's blank start, when it has one. */
  blank: BlankStartData | null;
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
    blank: app.blank
      ? {
          label: app.blank.label,
          description: app.blank.description,
          describe: { question: app.blank.describe.question, placeholder: app.blank.describe.placeholder ?? null, help: app.blank.describe.help ?? null, maxLength: app.blank.describe.maxLength },
          interview: app.blank.interview.map(q => ({
            key: q.key,
            question: q.question,
            placeholder: q.placeholder ?? null,
            help: q.help ?? null,
            defaultValue: q.default ? fillPlaceholders(q.default, builtins) : null,
            maxLength: q.maxLength,
          })),
        }
      : null,
    writable: target.ok ? { ok: true } : { ok: false, reason: target.reason },
  };
}
