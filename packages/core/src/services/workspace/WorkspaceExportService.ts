/**
 * WorkspaceExportService — a workspace as files, as it is running now.
 *
 * What an admin downloads from Workforce › Settings › Context, what
 * `npm run workspace:export` writes, and what an import merges into
 * (`WorkspaceImportService.ts`): every kind the loader reads, in the folder
 * layout `workspace:apply` takes, so the result applies to any project on any
 * host.
 *
 * Where the files come from, in one rule: **the authored file wherever it
 * still says what runs; the row wherever it does not.**
 *
 *   1. The base is the project's stored files (`workspace_file`), as authored —
 *      comments, layout and `{{env.NAME}}` tokens intact, so no per-host value
 *      is written down. A project with nothing stored starts from its own
 *      folder on this host instead (the files its next apply would store), and
 *      a project with neither (a personal workspace, one an operator made by
 *      script) from a `workspace.yaml` written from its project row.
 *   2. That base is loaded and dry-run against the project. A resource the
 *      base declares whose row differs — changed in the app since its file —
 *      is written from its row instead.
 *   3. Every live row the base does not account for is written from its row:
 *      an agent hired from the catalog, a connector added on the Connect page,
 *      the trust rules, learning steps and eval datasets a git workspace never
 *      stored, the voice and operating intent on the project row.
 *   4. `workspace.yaml` keeps its authored text, with only the settings the
 *      row has moved on from rewritten in place.
 *
 * Inherited resources — a plugin's, the base pack's — are never written out:
 * they come back from `plugins:` and `extends:`. Nothing that opens anything
 * is written either: credentials, connector logins and tokens are rows of
 * their own and never leave. `EXPORT.md` at the root says where each file came
 * from and what the export does not carry.
 *
 * Reads only. The dry run writes nothing (`applier.ts`).
 */

import type { LoadedWorkspace } from '@/libs/workspace';
import type { ExportFile } from '@/libs/workspace/export';
import { sep } from 'node:path';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { parseDocument } from 'yaml';
import { actionForPolicyKey } from '@/libs/actions/policyKey';
import { db } from '@/libs/DB';
import { logger } from '@/libs/Logger';
import { canonical } from '@/libs/sources/upsert';
import { applyWorkspace, loadWorkspace, resolvePlugins } from '@/libs/workspace';
import { projectSettingsFrom } from '@/libs/workspace/applier';
import { workspacePathProblem } from '@/libs/workspace/archivePaths';
import { declaredResources, fileText, yamlMap } from '@/libs/workspace/declared';
import { agentFiles, automationFile, evalDatasetFile, learningStepFile, manifestSettingsFromProject, missionFile, objectTypeFiles, operatingIntentFile, sourceFile, teamFile, textFile, trustFile, voiceFile, workflowFile, yamlFile } from '@/libs/workspace/export';
import { collectWorkspaceFiles, MANIFEST_FILES } from '@/libs/workspace/snapshot';
import { agentSchema, automationSchema, autonomyPolicySchema, businessObjectTypeSchema, evalDatasetSchema, evalEvaluatorSchema, knowledgeSourceSchema, memoryNamespaceSchema, missionSchema, playbookSchema, projectSchema, teamSchema, trustRuleSchema, userSchema, workflowSchema } from '@/models/Schema';
import { defaultRiskTier, rungFromTrustRule } from '@/services/autonomy/rungs';
import { getNamespace } from '@/services/MemoryService';
import { pinSourceRows, withStagedWorkspace } from './staging';
import { ownWorkspaceFolder, readAllStoredFiles } from './WorkspaceFileService';

/** How a seeded learning rule names the authored rule it came from (`seedLearningRules`). */
const WORKSPACE_RULE_SOURCE = 'workspace:';

/** The report at the root of every export. Not part of the workspace: an import drops it. */
export const EXPORT_REPORT_FILE = 'EXPORT.md';

/** What a resource written from its row is, by the name a person reads. */
export type ExportKind = 'agent' | 'team' | 'object type' | 'mission' | 'automation' | 'workflow' | 'connector' | 'eval dataset' | 'learning step' | 'skill' | 'playbook' | 'trust rules' | 'voice rules' | 'operating intent' | 'settings';

export type WorkspaceExportReport = {
  /**
   * Where the files started: the project's stored files, its own folder on
   * this host, or — with neither — its rows alone.
   */
  base: 'stored' | 'folder' | 'rows';
  /** Resources written from their rows, and why: no file said them, or the app changed them since their file. */
  fromRows: Array<{ kind: ExportKind; slug: string; why: 'not in the files' | 'changed in the app' }>;
  /** What is running but could not be exported, and why. */
  left: Array<{ kind: ExportKind; slug: string; reason: string }>;
  /** What went wrong reading or checking the workspace. The export still went out; these say what to check. */
  problems: string[];
};

export type WorkspaceExport = {
  project: { id: string; slug: string; name: string };
  exportedAt: Date;
  /** Every file, sorted by path, `EXPORT.md` included. */
  files: ExportFile[];
  report: WorkspaceExportReport;
};

export class WorkspaceExportError extends Error {
  constructor(public readonly code: 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'WorkspaceExportError';
  }
}

type ProjectRow = typeof projectSchema.$inferSelect;

/**
 * The project's workspace as files, as it is running now. See the module note.
 * @param orgId - The project.
 */
export async function exportWorkspace(orgId: string): Promise<WorkspaceExport> {
  const [project] = await db.select().from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  if (!project) {
    throw new WorkspaceExportError('NOT_FOUND', `no workspace ${orgId}`);
  }
  const report: WorkspaceExportReport = { base: 'rows', fromRows: [], left: [], problems: [] };
  const rows = await readRows(orgId);
  const ownerEmails = await emailsOf([project.accountableUserId, ...rows.teams.map(t => t.accountableUserId)]);

  const files = await baseFiles(orgId, report);
  if (!MANIFEST_FILES.some(name => files.has(name))) {
    files.set('workspace.yaml', manifestFromProject(project, ownerEmails, report));
  }
  const seeded = await seededRules(orgId, rows.learningSteps.map(l => l.name));
  const kinds = kindsOf(rows, ownerEmails, seeded);

  // Rows no file accounts for go in first, before anything is loaded: a file
  // may name one (a manifest's lead, a team's lead, an agent's team), and the
  // files alone would not load without it. A plugin's or the base pack's
  // resources are accounted for by `plugins:` and `extends:`.
  const declared = new Set([...declaredResources([...files.values()]).keys(), ...await inheritedResources(files)]);
  const fromRows = new Set<string>();
  for (const k of kinds) {
    for (const row of k.rows) {
      if (!declared.has(`${k.top}:${row.slug}`)) {
        fromRows.add(`${k.top}:${row.slug}`);
        writeFromRow(files, k, row, [], 'not in the files', report);
      }
    }
  }

  await withStagedWorkspace([...files.values()], async (dir) => {
    let loaded: LoadedWorkspace;
    try {
      loaded = loadWorkspace(dir);
    } catch (error) {
      // A workspace that does not load cannot be compared with the rows. It
      // goes out as it is, and the report says why nothing was checked.
      report.problems.push(`The workspace's files could not be read on this host, so nothing was checked against what is running: ${message(error, dir)}`);
      return;
    }
    // A connector is compared as it is stored, not as declared from this
    // staging folder: where a file sat on disk is not a change to it.
    pinSourceRows(loaded, rows.sources);
    const dry = await applyWorkspace(loaded, { orgId, dryRun: true });
    const changedInApp = new Set(dry.changes.filter(c => c.outcome === 'updated').map(c => `${c.resource}:${c.slug}`));
    const own = (sourceFile: string) => sourceFile.startsWith(loaded.sourcePath + sep);
    const relative = (abs: string) => abs.slice(loaded.sourcePath.length + 1).split(sep).join('/');

    // A resource whose file no longer says what runs — changed in the app
    // since — is written from its row in place of that file. One written from
    // its row above is what runs already.
    for (const k of kinds) {
      const entries = new Map(k.entries(loaded).map(e => [e.slug, e]));
      for (const row of k.rows) {
        const entry = entries.get(row.slug);
        if (fromRows.has(`${k.top}:${row.slug}`)) {
          continue;
        }
        if (!entry) {
          writeFromRow(files, k, row, [], 'not in the files', report);
        } else if (own(entry.sourceFile) && changedInApp.has(`${k.resource}:${row.slug}`)) {
          const file = relative(entry.sourceFile);
          const dirOf = file.slice(0, file.lastIndexOf('/') + 1);
          const made = [file, ...(entry.siblings ?? []).filter((x): x is string => !!x).map(x => `${dirOf}${x}`)].filter(path => files.has(path));
          writeFromRow(files, k, row, made, 'changed in the app', report);
        }
      }
    }

    // A SKILL.md body lives in the stored files, not on its catalog row, so a
    // skill the files do not hold cannot be written from its row.
    const folders = new Set([...loaded.skills, ...loaded.playbooks].map(f => f.slug));
    for (const row of rows.playbooks) {
      if (!folders.has(row.slug) && row.origin !== 'core') {
        report.left.push({ kind: row.kind === 'skill' ? 'skill' : 'playbook', slug: row.slug, reason: 'its body is not stored with the workspace — apply the workspace it came from once, then export again' });
      }
    }

    single(files, 'trust rules', ['trust.yaml', 'trust.yml'], sameTrust(rows.trust, loaded.trust), () => trustFile(rows.trust, trustDefaults), report);
    single(files, 'voice rules', ['voice.yaml', 'voice.yml'], canonical(project.voiceRules ?? null) === canonical(loaded.voice ?? null), () => voiceFile(project.voiceRules), report);
    single(files, 'operating intent', ['operating-intent.yaml', 'operating-intent.yml'], canonical(project.operatingIntent ?? null) === canonical(loaded.operatingIntent ?? null), () => operatingIntentFile(project.operatingIntent), report);

    patchSettings(files, project, loaded, ownerEmails, report);
  });

  const exportedAt = new Date();
  const out = [...files.values()].filter(f => f.path !== EXPORT_REPORT_FILE);
  await checkLoads(out, report);
  out.push(textFile(EXPORT_REPORT_FILE, reportText(project, exportedAt, out.length, report)));
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { project: { id: project.id, slug: project.slug, name: project.name }, exportedAt, files: out, report };
}

/**
 * The files the export starts from: the project's stored files, else its own
 * folder's (what its next apply would store), else none.
 * @param orgId - The project.
 * @param report - Where the source is recorded.
 */
async function baseFiles(orgId: string, report: WorkspaceExportReport): Promise<Map<string, ExportFile>> {
  const files = new Map<string, ExportFile>();
  const stored = await readAllStoredFiles(orgId);
  if (stored.some(f => (MANIFEST_FILES as readonly string[]).includes(f.path))) {
    report.base = 'stored';
    for (const f of stored) {
      if (!workspacePathProblem(f.path)) {
        files.set(f.path, { path: f.path, content: f.content, encoding: f.encoding });
      }
    }
    return files;
  }
  const own = await ownWorkspaceFolder(orgId);
  if (!own) {
    return files;
  }
  try {
    const loaded = loadWorkspace(own.path);
    const collected = collectWorkspaceFiles(loaded.sourcePath, [...loaded.skills, ...loaded.playbooks]);
    for (const f of collected.files) {
      files.set(f.path, { path: f.path, content: f.content, encoding: f.encoding });
    }
    for (const skipped of collected.skipped) {
      report.problems.push(`${skipped.path} is not in the export: it ${skipped.reason}.`);
    }
    report.base = 'folder';
  } catch (error) {
    report.problems.push(`This workspace's folder on this host could not be read, so the export was written from what is running: ${message(error, own.path)}`);
  }
  return files;
}

/** Every row the export may write a file from, live ones only. */
type Rows = Awaited<ReturnType<typeof readRows>>;

async function readRows(orgId: string) {
  const [agents, teams, objectTypes, missions, automations, workflows, sources, evalDatasets, evaluators, namespaces, playbooks, trustRules, policies] = await Promise.all([
    db.select().from(agentSchema).where(and(eq(agentSchema.orgId, orgId), ne(agentSchema.active, 'false'))),
    db.select().from(teamSchema).where(eq(teamSchema.orgId, orgId)),
    db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, orgId)),
    db.select().from(missionSchema).where(and(eq(missionSchema.orgId, orgId), ne(missionSchema.status, 'disabled'))),
    db.select().from(automationSchema).where(and(eq(automationSchema.orgId, orgId), ne(automationSchema.status, 'disabled'))),
    db.select().from(workflowSchema).where(and(eq(workflowSchema.orgId, orgId), ne(workflowSchema.status, 'retired'))),
    db.select().from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId)),
    db.select().from(evalDatasetSchema).where(eq(evalDatasetSchema.orgId, orgId)),
    db.select().from(evalEvaluatorSchema).where(eq(evalEvaluatorSchema.orgId, orgId)),
    db.select().from(memoryNamespaceSchema).where(eq(memoryNamespaceSchema.orgId, orgId)),
    db.select({ slug: playbookSchema.slug, kind: playbookSchema.kind, origin: playbookSchema.origin }).from(playbookSchema).where(eq(playbookSchema.orgId, orgId)),
    db.select({ actionId: trustRuleSchema.actionId, threshold: trustRuleSchema.threshold, enabled: trustRuleSchema.enabled }).from(trustRuleSchema).where(eq(trustRuleSchema.orgId, orgId)),
    db.select({ actionId: autonomyPolicySchema.actionId, rung: autonomyPolicySchema.rung, riskTier: autonomyPolicySchema.riskTier, source: autonomyPolicySchema.source }).from(autonomyPolicySchema).where(eq(autonomyPolicySchema.orgId, orgId)),
  ]);
  return {
    agents,
    teams,
    objectTypes,
    missions,
    automations,
    workflows,
    sources,
    evalDatasets,
    evaluators,
    // A learning step a workspace authored keeps its own name; the memory
    // buckets the app makes for an agent, a person or a record are named for
    // their path, and are memory, not authoring.
    learningSteps: namespaces.filter(n => n.name !== n.path.replace(/\//g, '-')),
    playbooks,
    trust: { rules: trustRules, policies },
  };
}

/**
 * The rules each learning step was seeded with from its file, by authored id
 * (`seedLearningRules` in the applier stores each under `source:
 * workspace:<id>`). A step that cannot be read has none here.
 * @param orgId - The project.
 * @param names - The learning steps.
 */
async function seededRules(orgId: string, names: readonly string[]): Promise<Map<string, Array<{ id: string; text: string }>>> {
  const out = new Map<string, Array<{ id: string; text: string }>>();
  for (const name of names) {
    try {
      const ns = await getNamespace(orgId, name);
      out.set(name, ns.rules
        .filter(r => r.source?.startsWith(WORKSPACE_RULE_SOURCE))
        .map(r => ({ id: r.source!.slice(WORKSPACE_RULE_SOURCE.length), text: r.ruleText })));
    } catch (error) {
      logger.warn('a learning step\'s seeded rules could not be read for an export', { orgId, name, error: message(error) });
    }
  }
  return out;
}

/**
 * Email by user id, for the owners a manifest names by email.
 * @param ids - User ids, nulls allowed.
 */
async function emailsOf(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  if (wanted.length === 0) {
    return new Map();
  }
  const users = await db.select({ id: userSchema.id, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, wanted));
  return new Map(users.map(u => [u.id, u.email]));
}

/**
 * Surfaces the plugins turn on by themselves, which a manifest need not list.
 * @param plugins - Plugin slugs.
 */
function pluginSurfaces(plugins: readonly string[]): Set<string> {
  try {
    return new Set(resolvePlugins(plugins).flatMap(p => p.manifest.surfaces));
  } catch {
    return new Set();
  }
}

/**
 * `workspace.yaml` from the project row, for a project with no manifest stored.
 * @param project - The project row.
 * @param ownerEmails - Owners' emails, by user id.
 * @param report - Where it is recorded as written from the row.
 */
function manifestFromProject(project: ProjectRow, ownerEmails: Map<string, string>, report: WorkspaceExportReport): ExportFile {
  report.fromRows.push({ kind: 'settings', slug: 'workspace.yaml', why: 'not in the files' });
  return yamlFile('workspace.yaml', {
    version: 1,
    orgId: project.id,
    name: project.name,
    ...(project.description ? { description: project.description } : {}),
    ...manifestSettingsFromProject(project, { ownerEmails, pluginSurfaces: pluginSurfaces(project.enabledPlugins ?? []) }),
  });
}

/** A loaded resource: its slug, the file that declared it, and files beside it it names. */
type LoadedEntry = { slug: string; sourceFile: string; siblings?: ReadonlyArray<string | undefined> };

/** One kind the export can write from its rows. */
type RowKind = {
  /** Its folder in the workspace — how `declaredResources` keys it. */
  top: string;
  /** Its name in the apply's outcomes. */
  resource: string;
  /** Its name for a person. */
  kind: ExportKind;
  rows: ReadonlyArray<{ slug: string }>;
  /** What a loaded workspace declares of it, inherited resources included. */
  entries: (loaded: LoadedWorkspace) => LoadedEntry[];
  render: (row: never) => ExportFile[];
};

/**
 * The kinds written from rows, each with how the loader sees it and how a row
 * becomes its files.
 * @param rows - The live rows.
 * @param ownerEmails - Owners' emails, by user id.
 * @param seeded - Each learning step's seeded rules.
 */
function kindsOf(rows: Rows, ownerEmails: Map<string, string>, seeded: Map<string, Array<{ id: string; text: string }>>): RowKind[] {
  const kind = <R extends { slug: string }>(k: Omit<RowKind, 'rows' | 'render'> & { rows: readonly R[]; render: (row: R) => ExportFile[] }): RowKind => k as unknown as RowKind;
  return [
    kind({ top: 'agents', resource: 'agents', kind: 'agent', rows: rows.agents, entries: l => l.agents.map(a => ({ slug: a.slug, sourceFile: a.sourceFile, siblings: [a.systemPromptFile, ...a.subagents.map(x => x.systemPromptFile)] })), render: row => agentFiles(row, rows.teams) }),
    kind({ top: 'teams', resource: 'teams', kind: 'team', rows: rows.teams, entries: l => l.teams, render: row => [teamFile(row, ownerEmails)] }),
    kind({ top: 'objects', resource: 'objectTypes', kind: 'object type', rows: rows.objectTypes, entries: l => l.objectTypes.map(o => ({ slug: o.slug, sourceFile: o.sourceFile, siblings: [o.classificationPromptFile] })), render: row => objectTypeFiles(row) }),
    kind({ top: 'missions', resource: 'missions', kind: 'mission', rows: rows.missions, entries: l => l.missions, render: row => [missionFile(row)] }),
    kind({ top: 'automations', resource: 'automations', kind: 'automation', rows: rows.automations, entries: l => l.automations, render: row => [automationFile(row)] }),
    kind({ top: 'workflows', resource: 'workflows', kind: 'workflow', rows: rows.workflows, entries: l => l.workflows, render: row => [workflowFile(row)] }),
    kind({ top: 'sources', resource: 'sources', kind: 'connector', rows: rows.sources, entries: l => l.sources, render: row => [sourceFile(row)] }),
    kind({ top: 'evals', resource: 'evalDatasets', kind: 'eval dataset', rows: rows.evalDatasets, entries: l => l.evalDatasets, render: row => [evalDatasetFile(row, rows.evaluators)] }),
    kind({ top: 'learnings', resource: 'learningSteps', kind: 'learning step', rows: rows.learningSteps.map(l => ({ ...l, slug: l.name })), entries: l => l.learningSteps.map(x => ({ slug: x.name, sourceFile: x.sourceFile })), render: row => [learningStepFile(row, seeded.get(row.name))] }),
  ];
}

/**
 * Write one resource from its row, in place of the files it was made of.
 * A path another resource already holds is not overwritten; the report says so.
 * @param files - The export so far.
 * @param k - Its kind.
 * @param row - Its row.
 * @param row.slug - Its slug.
 * @param replaced - The files it replaces.
 * @param why - Why it is written from its row.
 * @param report - Where it is recorded.
 */
function writeFromRow(files: Map<string, ExportFile>, k: RowKind, row: { slug: string }, replaced: readonly string[], why: 'not in the files' | 'changed in the app', report: WorkspaceExportReport): void {
  const written = k.render(row as never);
  const taken = written.find(f => files.has(f.path) && !replaced.includes(f.path));
  if (taken) {
    report.problems.push(`${k.kind} "${row.slug}" was not written from what is running: ${taken.path} already holds another file.`);
    return;
  }
  for (const path of replaced) {
    files.delete(path);
  }
  for (const f of written) {
    files.set(f.path, f);
  }
  report.fromRows.push({ kind: k.kind, slug: row.slug, why });
}

/**
 * One top-level file (`trust.yaml`): left as it is when it says what runs,
 * else written from the rows — or removed, when nothing runs that it says.
 * @param files - The export so far.
 * @param kind - The file's name for a person.
 * @param names - Its spellings.
 * @param same - Whether what the files say is what runs.
 * @param render - The file from the rows, or null for nothing.
 * @param report - Where it is recorded.
 */
function single(files: Map<string, ExportFile>, kind: ExportKind, names: readonly string[], same: boolean, render: () => ExportFile | null, report: WorkspaceExportReport): void {
  if (same) {
    return;
  }
  const had = names.find(name => files.has(name));
  if (had) {
    files.delete(had);
  }
  const written = render();
  if (written) {
    files.set(written.path, written);
  }
  report.fromRows.push({ kind, slug: written?.path ?? had ?? names[0]!, why: had ? 'changed in the app' : 'not in the files' });
}

/**
 * What the plugins and the base pack the manifest turns on bring with them,
 * keyed as `declaredResources` keys a file: read by loading the manifest's
 * layering alone, with nothing of the workspace's own.
 * @param files - The export so far; its manifest is read.
 */
async function inheritedResources(files: Map<string, ExportFile>): Promise<string[]> {
  const name = MANIFEST_FILES.find(n => files.has(n));
  const manifest = name ? yamlMap(fileText(files.get(name)!)) : null;
  if (!manifest) {
    return [];
  }
  const bare = Object.fromEntries(['version', 'orgId', 'name', 'extends', 'use', 'disable', 'plugins', 'pluginSettings'].filter(k => k in manifest).map(k => [k, manifest[k]]));
  return withStagedWorkspace([yamlFile('workspace.yaml', bare)], async (dir) => {
    try {
      const l = loadWorkspace(dir);
      return [
        ...l.agents.map(x => `agents:${x.slug}`),
        ...l.teams.map(x => `teams:${x.slug}`),
        ...l.objectTypes.map(x => `objects:${x.slug}`),
        ...l.missions.map(x => `missions:${x.slug}`),
        ...l.automations.map(x => `automations:${x.slug}`),
        ...l.workflows.map(x => `workflows:${x.slug}`),
        ...l.sources.map(x => `sources:${x.slug}`),
        ...l.evalDatasets.map(x => `evals:${x.slug}`),
        ...l.learningSteps.map(x => `learnings:${x.name}`),
      ];
    } catch {
      // The full load names the fault; here it only means nothing is inherited.
      return [];
    }
  });
}

/**
 * The rung and risk tier an apply gives a trust rule that names neither,
 * so a rule whose policy holds exactly those is written without them.
 * @param actionId - The action kind.
 * @param enabled - Whether the rule is on.
 */
function trustDefaults(actionId: string, enabled: boolean): { rung: string; risk: string } {
  const action = actionForPolicyKey(actionId);
  return { rung: rungFromTrustRule({ enabled }), risk: defaultRiskTier(actionId, action?.external, action?.id) };
}

/**
 * Whether the stored trust rules are what the loaded workspace (plugins
 * included) says — action, threshold and switch, compared as sets.
 * @param rows - The stored rules.
 * @param rows.rules - The trust rules.
 * @param loaded - The loaded trust, or null.
 */
function sameTrust(rows: { rules: ReadonlyArray<{ actionId: string; threshold: number; enabled: string }> }, loaded: LoadedWorkspace['trust']): boolean {
  const stored = rows.rules.map(r => [r.actionId, r.threshold, r.enabled === 'true'] as const).sort((a, b) => a[0].localeCompare(b[0]));
  const authored = (loaded?.rules ?? []).map(r => [r.action, r.autoApproveAbove, r.enabled] as const).sort((a, b) => a[0].localeCompare(b[0]));
  return canonical(stored) === canonical(authored);
}

/**
 * Rewrite, in the authored `workspace.yaml`, only the settings the project row
 * has moved on from — a plugin turned on in the app, a lead changed — so the
 * rest of the file, comments included, goes out as written. An owner the row
 * does not hold is left as authored: it may simply not have signed up on this
 * host yet.
 * @param files - The export so far.
 * @param project - The project row.
 * @param loaded - The loaded base.
 * @param ownerEmails - Owners' emails, by user id.
 * @param report - Where a rewrite is recorded.
 */
function patchSettings(files: Map<string, ExportFile>, project: ProjectRow, loaded: LoadedWorkspace, ownerEmails: Map<string, string>, report: WorkspaceExportReport): void {
  const name = MANIFEST_FILES.find(n => files.has(n));
  if (!name) {
    return;
  }
  const authored = projectSettingsFrom(loaded);
  const fromRow = manifestSettingsFromProject(project, { ownerEmails, pluginSurfaces: new Set(loaded.plugins.flatMap(p => p.manifest.surfaces)) }) as Record<string, unknown> & { defaults?: Record<string, unknown> };
  const rowDefaults = fromRow.defaults ?? {};
  const patches: Array<{ path: string[]; value: unknown }> = [];
  const differs = (a: unknown, b: unknown) => canonical(a ?? null) !== canonical(b ?? null);
  if (differs(project.leadAgentSlug, authored.leadAgentSlug)) {
    patches.push({ path: ['lead'], value: fromRow.lead });
  }
  if (differs(project.goal, authored.goal)) {
    patches.push({ path: ['goal'], value: fromRow.goal });
  }
  if (differs(project.timeZone, authored.timeZone)) {
    patches.push({ path: ['defaults', 'timezone'], value: rowDefaults.timezone });
  }
  if (differs(project.embeddingConfig, authored.embeddingConfig)) {
    patches.push({ path: ['defaults', 'embeddingProvider'], value: rowDefaults.embeddingProvider }, { path: ['defaults', 'embeddingModel'], value: rowDefaults.embeddingModel });
  }
  if (differs(project.regenerateSkills, authored.regenerateSkills)) {
    patches.push({ path: ['defaults', 'regenerateSkills'], value: rowDefaults.regenerateSkills });
  }
  if (differs(project.clientFacingPlaybooks, authored.clientFacingPlaybooks)) {
    patches.push({ path: ['defaults', 'clientFacingPlaybooks'], value: rowDefaults.clientFacingPlaybooks });
  }
  if (differs(project.learningEagerness, authored.learningEagerness)) {
    patches.push({ path: ['defaults', 'learningEagerness'], value: rowDefaults.learningEagerness });
  }
  if (differs(project.enabledPlugins, authored.enabledPlugins)) {
    patches.push({ path: ['plugins'], value: fromRow.plugins });
  }
  if (differs(project.enabledSurfaces, authored.enabledSurfaces)) {
    patches.push({ path: ['surfaces'], value: fromRow.surfaces });
  }
  if (differs(project.enabledDurable, authored.enabledDurable)) {
    patches.push({ path: ['durable'], value: fromRow.durable });
  }
  const owner = project.accountableUserId ? ownerEmails.get(project.accountableUserId) : undefined;
  if (owner && owner.toLowerCase() !== loaded.manifest.accountableUser?.toLowerCase()) {
    patches.push({ path: ['accountableUser'], value: owner });
  }
  if (patches.length === 0) {
    return;
  }
  const file = files.get(name)!;
  const doc = parseDocument(file.content);
  for (const patch of patches) {
    if (patch.value === undefined || patch.value === null || (Array.isArray(patch.value) && patch.value.length === 0)) {
      doc.deleteIn(patch.path);
    } else {
      doc.setIn(patch.path, patch.value);
    }
  }
  files.set(name, textFile(name, doc.toString({ lineWidth: 0 })));
  report.fromRows.push({ kind: 'settings', slug: name, why: 'changed in the app' });
}

/**
 * Load the export as a workspace once more, so one that would not apply says
 * so in its own report instead of failing at the import.
 * @param files - The export, without its report.
 * @param report - Where a failure is recorded.
 */
async function checkLoads(files: readonly ExportFile[], report: WorkspaceExportReport): Promise<void> {
  await withStagedWorkspace(files, async (dir) => {
    try {
      loadWorkspace(dir);
    } catch (error) {
      report.problems.push(`This export does not load as a workspace on this host: ${message(error, dir)}`);
      logger.warn('a workspace export does not load', { error: message(error, dir) });
    }
  });
}

/**
 * `EXPORT.md`: where each file came from and what the export does not carry.
 * @param project - The project row.
 * @param at - When.
 * @param fileCount - How many workspace files.
 * @param report - The report.
 */
function reportText(project: ProjectRow, at: Date, fileCount: number, report: WorkspaceExportReport): string {
  const lines = [
    `# ${project.name} — workspace export`,
    '',
    `Exported from the workspace \`${project.slug}\` on ${at.toISOString()}: ${fileCount} file${fileCount === 1 ? '' : 's'}.`,
    '',
    'This folder is a Vocion workspace. Import the zip in Workforce › Settings › Context of another workspace, or apply the folder with `npm run workspace:apply -- <folder> --project <id|slug>`.',
    '',
    '## Where the files came from',
    '',
    {
      stored: '- The files stored with the workspace, as they were authored (comments and `{{env.NAME}}` tokens kept).',
      folder: '- The workspace\'s folder on this host, as its next apply would store it.',
      rows: '- Nothing was stored with this workspace, so every file below was written from what is running.',
    }[report.base],
  ];
  if (report.fromRows.length > 0) {
    lines.push('- Written from what is running, because no file said it or it changed in the app since its file:');
    for (const r of report.fromRows) {
      lines.push(`  - ${r.kind} \`${r.slug}\` (${r.why})`);
    }
  }
  lines.push(
    '',
    '## Not in this export',
    '',
    '- Credentials, connector logins and API tokens. Reconnect each connector in the workspace this is imported into.',
    '- The sync schedule of a connector added in the app (one declared in a file keeps its own). Imported into a workspace that has it, a connector keeps the schedule it has there.',
    '- Files a connector reads from this server\'s disk (a local folder or file it is pointed at). The connector is exported; the files are not.',
    '- Records, documents and wiki pages, conversations, runs, and their history.',
    '- Rules the workspace learned from feedback, spend caps set in the app, and people\'s own settings.',
  );
  for (const l of report.left) {
    lines.push(`- ${l.kind} \`${l.slug}\`: ${l.reason}.`);
  }
  if (report.problems.length > 0) {
    lines.push('', '## Problems', '');
    for (const p of report.problems) {
      lines.push(`- ${p}`);
    }
  }
  return lines.join('\n');
}

/**
 * An error's message, with the folder it was read from taken out: a report an
 * admin downloads names files by their path inside the workspace, never where
 * this host keeps them.
 * @param error - What was thrown.
 * @param root - The folder its paths are under, when they are.
 */
function message(error: unknown, root?: string): string {
  const text = error instanceof Error ? error.message : String(error);
  return root ? text.split(root + sep).join('').split(root).join('the workspace folder') : text;
}
