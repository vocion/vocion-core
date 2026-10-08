import type { ZodType } from 'zod';
import type { ActivatedPack, ComposedEntry, FolderEntry, PackRaw, RawEntry } from './compose';
import type { Origin } from './merge';
import type { LoadedPlugin } from './plugins';
import type { AgentManifest, AutomationManifest, EvalDatasetManifest, LearningStepManifest, MissionManifest, NotificationRuleManifest, ObjectTypeManifest, OperatingIntentManifest, PackManifest, PlaybookManifest, SourceManifest, TeamManifest, TrustManifest, VoiceManifest, WorkflowManifest, WorkspaceManifest } from './schemas';
import type { LoadedWikiPage } from './wiki-pages';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isSurfaceId, SURFACE_IDS } from '@/features/navigation/surfaces';
import { assignTypeCodes } from '@/libs/codes';
import { fromRepoRoot } from '@/libs/repo-root';
import { composeKind, resolveActivation } from './compose';
import { assertEvalCheckPaths } from './evalCheckPaths';
import { assertAgentHierarchy } from './hierarchy';
import { EXTENDS_CORE } from './merge';
import { assertDoTargets, assertOwnership } from './ownership';
import { resolvePlugins } from './plugins';
import {
  AgentManifestSchema,
  AutomationManifestSchema,
  EvalDatasetManifestSchema,
  LearningStepManifestSchema,
  MissionManifestSchema,
  ObjectTypeManifestSchema,
  OperatingIntentManifestSchema,
  PackManifestSchema,
  PlaybookManifestSchema,
  SourceManifestSchema,
  TeamManifestSchema,
  TrustManifestSchema,
  VoiceManifestSchema,
  WorkflowManifestSchema,
  WorkspaceManifestSchema,
} from './schemas';
import { computeWorkspaceSha } from './sha';
import { assertTeams } from './teams';
import { readWorkspaceTextFile } from './template-vars';
import { loadWikiPages } from './wiki-pages';

export type LoadedAgent = AgentManifest & {
  resolvedSystemPrompt: string;
  resolvedSubagents: Array<{
    name: string;
    description: string;
    systemPrompt: string;
    tools?: string[];
    model?: string;
  }>;
  sourceFile: string;
  /** Provenance: base default, workspace resource, or a merge of the two. */
  origin: Origin;
};
/** `resolvedCode` is the code this type's records read by, settled across the workspace (`libs/codes.ts`). */
export type LoadedObjectType = ObjectTypeManifest & { resolvedClassificationPrompt: string | null; sourceFile: string; origin: Origin; resolvedCode?: string };
export type LoadedWorkflow = WorkflowManifest & { sourceFile: string };
export type LoadedMission = MissionManifest & { sourceFile: string; origin: Origin };
export type LoadedAutomation = AutomationManifest & { sourceFile: string };

/**
 * A declared notification kind, and the layer that declared it: `workspace`,
 * or `plugin:<slug>` (backlog 048).
 */
export type LoadedNotification = NotificationRuleManifest & { source: string };

/**
 * The notification kinds a workspace has on: every enabled plugin's, in load
 * order, then the workspace's own, a workspace entry replacing a plugin's of
 * the same kind whole (the whole-file rule automations use). Two plugins
 * declaring one kind is an error — a kind belongs to one plugin.
 * @param plugins - The resolved plugins.
 * @param manifest - The workspace manifest.
 */
export function composeNotifications(plugins: readonly LoadedPlugin[], manifest: Pick<WorkspaceManifest, 'notifications'>): LoadedNotification[] {
  const byKind = new Map<string, LoadedNotification>();
  for (const plugin of plugins) {
    for (const rule of plugin.manifest.notifications ?? []) {
      const prior = byKind.get(rule.kind);
      if (prior) {
        throw new Error(`notification kind "${rule.kind}" is declared by both ${prior.source} and plugin:${plugin.manifest.slug} — a kind belongs to one plugin`);
      }
      byKind.set(rule.kind, { ...rule, source: `plugin:${plugin.manifest.slug}` });
    }
  }
  for (const rule of manifest.notifications ?? []) {
    byKind.set(rule.kind, { ...rule, source: 'workspace' });
  }
  return [...byKind.values()];
}

export type LoadedLearningStep = LearningStepManifest & { sourceFile: string };
export type LoadedEvalDataset = EvalDatasetManifest & { sourceFile: string };
/**
 * A source, plus where it was declared. `manifestDir` is the absolute
 * directory of the workspace manifest that carried it — connectors
 * resolve relative path options (e.g. local-files `directory`) against
 * it, so a template's bundled sample data works from any path rather
 * than only from the workspace root.
 */
export type LoadedSource = SourceManifest & {
  sourceFile: string;
  manifestDir: string;
  /**
   * The display name to store with the connector (`_name`), when the apply
   * should write one. A folder's apply leaves it unset, as it always has; an
   * import sets it so a connector keeps the name its row has, and a new one
   * takes its file's (`services/workspace/staging.ts`).
   */
  storedName?: string;
};
/** A team — slug derived from the filename (teams/<slug>.yaml). */
export type LoadedTeam = TeamManifest & { slug: string; sourceFile: string };

/** Where a SKILL.md folder came from, driving mount-path resolution. */
export type FolderOrigin = 'core' | 'workspace' | 'override';

export type LoadedPlaybook = PlaybookManifest & {
  /** Markdown body (everything after the YAML frontmatter). */
  body: string;
  /** SHA-256 of the body (not the frontmatter). */
  contentSha: string;
  /**
   * Sibling resource paths, relative to the folder. For an override this
   * is the union of workspace and base siblings, merged by path — the
   * workspace file wins when both ship the same relative path.
   */
  sourceFiles: string[];
  /** Absolute path of the SKILL.md file that won (workspace on override). */
  sourceFile: string;
  /** skill (the deepagents unit) or playbook (attached context). */
  kind: 'skill' | 'playbook';
  /**
   * core: shipped by the base pack, no workspace copy.
   * workspace: workspace-only, no base twin.
   * override: workspace copy whole-file-replacing an activated base twin.
   */
  origin: FolderOrigin;
  /**
   * On an override: the SHA-256 of the body it replaces — the base or
   * plugin twin's SKILL.md as it stands at this load. The applier keeps the
   * one in force when the override was last edited, so a later change to the
   * twin reads as drift (`services/plugins/configureData.ts`).
   */
  baseSha?: string;
};

/**
 * The base pack a workspace `extends`, resolved and pin-checked. Step-1 is
 * identity-only (no resources); ticket-007 step 3 composes its resources under
 * the workspace. `null` on a LoadedWorkspace whenever `extends` is omitted —
 * which is the byte-for-byte-unchanged path.
 */
export type LoadedPack = {
  manifest: PackManifest;
  /** Absolute path of the pack directory (packages/core/templates/<name>). */
  sourcePath: string;
};

export type LoadedWorkspace = {
  manifest: WorkspaceManifest;
  /** The resolved base pack when `manifest.extends` is set, else null. */
  pack: LoadedPack | null;
  /**
   * The plugins `manifest.plugins` resolves to — dependencies included, in
   * load order. Their resources are composed into the lists below with
   * origin `core` (inherited), exactly like activated base defaults.
   */
  plugins: LoadedPlugin[];
  /** Slugs of `plugins`, in the same order — what lands on `project.enabled_plugins`. */
  enabledPlugins: string[];
  /**
   * `manifest.surfaces` plus every surface an enabled plugin declares,
   * deduped and validated — what lands on `project.enabled_surfaces`.
   */
  effectiveSurfaces: string[];
  agents: LoadedAgent[];
  /** SKILL.md skill folders — the deepagents unit (kind: 'skill'). */
  skills: LoadedPlaybook[];
  objectTypes: LoadedObjectType[];
  workflows: LoadedWorkflow[];
  missions: LoadedMission[];
  automations: LoadedAutomation[];
  /** Declared notification kinds, plugins' and the workspace's (`composeNotifications`). */
  notifications: LoadedNotification[];
  trust: TrustManifest | null;
  /** The workspace's voice rules from voice.yaml, or null when unauthored. */
  voice: VoiceManifest | null;
  /**
   * The workspace's operating intent from operating-intent.yaml, or null when
   * unauthored: what a person wants the factory to be doing now.
   */
  operatingIntent: OperatingIntentManifest | null;
  playbooks: LoadedPlaybook[];
  learningSteps: LoadedLearningStep[];
  evalDatasets: LoadedEvalDataset[];
  sources: LoadedSource[];
  teams: LoadedTeam[];
  /**
   * Wiki pages the workspace seeds from `wiki/<slug>.md` (`wiki-pages.ts`).
   * Workspace files only — a plugin ships its wiki through its curator, not
   * through files. Empty when the directory is absent.
   */
  wikiPages: LoadedWikiPage[];
  sha: string;
  sourcePath: string;
  fileCount: number;
};

/**
 * Read and validate a workspace directory. Throws on schema violations with a clear message.
 * @param contextPath
 */
export function loadWorkspace(contextPath: string): LoadedWorkspace {
  const abs = resolve(contextPath.startsWith('/') ? contextPath : fromRepoRoot(contextPath));
  const manifest = loadManifest(abs);
  // Base-pack layer (ticket 007). Omitting `extends` keeps `pack` null and the
  // rest of the load byte-for-byte identical to pre-007 behavior. When set, we
  // resolve + pin-check the pack here; composing its resources is a later step.
  const pack = manifest.extends ? loadPack(manifest.extends) : null;
  // Plugins (workspace.yaml `plugins:`), dependency-closed and ordered. Each
  // is a fully-active inherited layer composed over the base pack and under
  // the workspace — see `plugins.ts` and {@link composeInherited}.
  const plugins = resolvePlugins(manifest.plugins);
  const files: string[] = [];

  // Base-pack compose (ticket 007). With no pack and no plugins, `layer` is
  // null and every composable kind reduces to "workspace files only, origin:
  // workspace" — the byte-for-byte-unchanged path. With a pack, base defaults
  // the workspace activated are merged in per-slug (see compose.ts); a
  // plugin's resources join that inherited layer, always active.
  const packRaw = pack ? loadPackRaw(pack) : null;
  const activated = packRaw ? resolveActivation(packRaw, manifest.use, manifest.disable) : null;
  const layer = composeInherited(packRaw, activated, plugins, manifest.disable);

  const agents = composeEntries('agent', join(abs, 'agents'), isYamlFile, layer?.full.agents, layer?.active.agents, files)
    .map((entry) => {
      const parsed = validateOrThrow(AgentManifestSchema, entry.raw, entry.sourceFile, 'agent');
      const resolvedSystemPrompt = resolvePromptField(entry.sourceFile, parsed.systemPromptFile, parsed.systemPrompt, files);
      // Resolve each subagent's systemPrompt — either inline or from a sibling file.
      const resolvedSubagents = parsed.subagents.map(s => ({
        name: s.name,
        description: s.description,
        systemPrompt: resolvePromptField(entry.sourceFile, s.systemPromptFile, s.systemPrompt, files),
        tools: s.tools,
        model: s.model,
      }));
      return { ...parsed, resolvedSystemPrompt, resolvedSubagents, sourceFile: entry.sourceFile, origin: entry.origin };
    });

  // Skills — SKILL.md folders, the deepagents unit. The operations layer
  // (typed YAML prompt templates) is gone; a leftover operations/ dir is a
  // hard error so a stale workspace fails loudly instead of silently
  // shipping nothing.
  if (walkDir(join(abs, 'operations')).length > 0) {
    throw new Error(
      `workspace ${abs} still has an operations/ directory — operations were removed; convert each to a skill folder under skills/<slug>/SKILL.md`,
    );
  }
  const skills = composeFolders('skill', join(abs, 'skills'), layer?.active.skills, layer?.full.skills, files);

  const objectTypes: LoadedObjectType[] = composeEntries('object type', join(abs, 'objects'), isObjectFile, layer?.full.objectTypes, layer?.active.objectTypes, files)
    .map((entry) => {
      const parsed = validateOrThrow(ObjectTypeManifestSchema, entry.raw, entry.sourceFile, 'objectType');
      const resolvedClassificationPrompt = parsed.classificationPromptFile || parsed.classificationPrompt
        ? resolvePromptField(entry.sourceFile, parsed.classificationPromptFile, parsed.classificationPrompt, files)
        : null;
      return { ...parsed, resolvedClassificationPrompt, sourceFile: entry.sourceFile, origin: entry.origin };
    });

  const workflows = walkDir(join(abs, 'workflows'))
    .filter(f => (basename(f) === 'workflow.yaml' || basename(f) === 'workflow.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, WorkflowManifestSchema, 'workflow');
      return { ...parsed, sourceFile: file };
    });

  const missions = composeEntries('mission', join(abs, 'missions'), isYamlFile, layer?.full.missions, layer?.active.missions, files)
    .map((entry) => {
      const parsed = validateOrThrow(MissionManifestSchema, entry.raw, entry.sourceFile, 'mission');
      return { ...parsed, sourceFile: entry.sourceFile, origin: entry.origin };
    });

  // turbopackIgnore: this path is only known at runtime, so the build must not
  // trace it, or Next copies the whole project into the image (next.config.ts, #832).
  const trustPath = ['trust.yaml', 'trust.yml'].map(n => join(/* turbopackIgnore: true */ abs, n)).find(existsSync) ?? null;
  const workspaceTrust: TrustManifest | null = trustPath
    ? (() => {
        files.push(trustPath);
        return parseFile(trustPath, TrustManifestSchema, 'trust') as TrustManifest;
      })()
    : null;
  const extras = loadPluginExtras(plugins, manifest.pluginSettings ?? {});
  const trust = mergeTrust(extras.trust, workspaceTrust);

  // Voice rules: one top-level file, same shape as trust.yaml. Absent means
  // the workspace inherits core's platform floor and nothing else.
  const voicePath = ['voice.yaml', 'voice.yml'].map(n => join(/* turbopackIgnore: true */ abs, n)).find(existsSync) ?? null;
  const voice: VoiceManifest | null = voicePath
    ? (() => {
        files.push(voicePath);
        return parseFile(voicePath, VoiceManifestSchema, 'voice') as VoiceManifest;
      })()
    : null;

  // Operating intent: the person's standing instructions to the factory, one
  // top-level file, same shape as trust.yaml and voice.yaml. Absent means the
  // factory has been told nothing, which is not the same as being told
  // "anything goes", and the agents say so rather than assuming.
  const intentPath = ['operating-intent.yaml', 'operating-intent.yml'].map(n => join(/* turbopackIgnore: true */ abs, n)).find(existsSync) ?? null;
  const operatingIntent: OperatingIntentManifest | null = intentPath
    ? (() => {
        files.push(intentPath);
        return parseFile(intentPath, OperatingIntentManifestSchema, 'operating intent') as OperatingIntentManifest;
      })()
    : null;

  // Automations, teams and learning steps are not composable kinds (no deep
  // merge): a plugin's file is appended, and a workspace file with the same
  // slug replaces it outright — the same whole-file rule SKILL.md folders use.
  const automations = inheritBy(
    walkDir(join(abs, 'automations'))
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((file) => {
        files.push(file);
        const parsed = parseFile(file, AutomationManifestSchema, 'automation');
        if (parsed.setting) {
          throw new Error(`automation "${parsed.slug}" (${file}): setting: is for a plugin's automations — a workspace turns its own on or off with status:`);
        }
        return { ...parsed, sourceFile: file };
      }),
    extras.automations,
    a => a.slug,
  );

  const playbooks = composeFolders('playbook', join(abs, 'playbooks'), layer?.active.playbooks, layer?.full.playbooks, files);

  const learningSteps = inheritBy(
    walkDir(join(abs, 'learnings'))
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((file) => {
        files.push(file);
        const parsed = parseFile(file, LearningStepManifestSchema, 'learningStep');
        return { ...parsed, sourceFile: file };
      }),
    extras.learningSteps,
    l => l.name,
  );

  const evalDatasets = walkDir(join(abs, 'evals'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, EvalDatasetManifestSchema, 'evalDataset');
      return { ...parsed, sourceFile: file };
    });

  const sources = walkDir(join(abs, 'sources'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, SourceManifestSchema, 'source');
      return { ...parsed, sourceFile: file, manifestDir: abs };
    });

  // Teams (F1): slug comes from the filename, so a team can't disagree
  // with its own path. teams/revenue-ops.yaml → slug "revenue-ops".
  const teams = inheritBy(
    walkDir(join(abs, 'teams'))
      .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map(file => loadTeam(file, files)),
    extras.teams,
    t => t.slug,
  );

  // Wiki pages seeded from the repo — read as written, validated, sha-tracked
  // like any other workspace file. The applier turns them into artifacts.
  const wikiPages = loadWikiPages(abs, files);

  // Surfaces name a core-registered route, never a URL — so an unknown id is
  // caught here at `workspace:check` instead of rendering a dead sidebar link.
  // A plugin's surfaces join the workspace's; the error names the plugin.
  const unknownSurfaces = manifest.surfaces.filter(id => !isSurfaceId(id));
  if (unknownSurfaces.length > 0) {
    throw new WorkspaceValidationError(
      join(abs, 'workspace.yaml'),
      'workspace manifest',
      unknownSurfaces.map(id => `unknown surface "${id}" — this core registers: ${SURFACE_IDS.join(', ')}`),
    );
  }
  for (const plugin of plugins) {
    const unknown = plugin.manifest.surfaces.filter(id => !isSurfaceId(id));
    if (unknown.length > 0) {
      throw new WorkspaceValidationError(join(plugin.sourcePath, 'plugin.yaml'), 'plugin manifest', unknown.map(id => `unknown surface "${id}" — this core registers: ${SURFACE_IDS.join(', ')}`));
    }
  }
  const effectiveSurfaces = [...new Set([...manifest.surfaces, ...plugins.flatMap(p => p.manifest.surfaces)])];

  assertUniqueSlugs(agents, 'agent');
  assertAgentHierarchy(agents);
  assertUniqueSlugs(teams, 'team');
  assertTeams(agents, teams, manifest);
  assertUniqueSlugs(skills, 'skill');
  assertUniqueSlugs(objectTypes, 'object type');
  const objectTypeCodes = assertTypeCodes(objectTypes);
  for (const ot of objectTypes) {
    ot.resolvedCode = objectTypeCodes.get(ot.slug);
  }
  assertNamedRefs(agents, skills, playbooks);
  assertUniqueSlugs(workflows, 'workflow');
  assertUniqueSlugs(missions, 'mission');
  assertUniqueSlugs(automations, 'automation');
  assertUniqueSlugs(playbooks, 'playbook');
  assertUniqueNames(learningSteps, 'learning step');
  assertUniqueSlugs(evalDatasets, 'eval dataset');
  assertEvalCheckPaths(evalDatasets, objectTypes);
  assertUniqueSlugs(sources, 'source');
  assertOwnership(agents, automations, workflows);
  assertDoTargets(automations, missions, workflows);

  // Provenance: fold the pinned base-pack version into the workspace sha so
  // `workspace_sha` still answers "exactly what ran" — a workspace on
  // core@1.0.0 and the same workspace on core@1.1.0 are distinguishable even
  // though not one workspace file changed. No pack → sha is unchanged.
  // Same for plugins: each enabled plugin's version folds in, so turning one
  // on, off, or shipping a new version of it is a new sha.
  const baseSha = computeWorkspaceSha(abs, files);
  const withPack = pack ? `${baseSha}+${pack.manifest.name}@${pack.manifest.version}` : baseSha;
  const sha = plugins.reduce((acc, p) => `${acc}+${p.manifest.slug}@${p.manifest.version}`, withPack);

  return {
    manifest,
    pack,
    plugins,
    enabledPlugins: plugins.map(p => p.manifest.slug),
    effectiveSurfaces,
    agents,
    skills,
    objectTypes,
    workflows,
    missions,
    automations,
    notifications: composeNotifications(plugins, manifest),
    trust,
    voice,
    operatingIntent,
    playbooks,
    learningSteps,
    evalDatasets,
    sources,
    teams,
    wikiPages,
    sha,
    sourcePath: abs,
    fileCount: files.length + 1,
  };
}

function loadManifest(abs: string): WorkspaceManifest {
  const candidates = ['workspace.yaml', 'workspace.yml'];
  for (const c of candidates) {
    const p = join(/* turbopackIgnore: true */ abs, c);
    try {
      const raw = readWorkspaceTextFile(p);
      const parsed = parseYaml(raw);
      return validateOrThrow(WorkspaceManifestSchema, parsed, p, 'workspace manifest');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }
  throw new Error(`workspace manifest not found at ${abs}/workspace.yaml`);
}

/**
 * Parse a workspace `extends` pin into a pack name + optional version.
 *   `core@1.4.0` → { name: 'core', version: '1.4.0' }
 *   `core`       → { name: 'core', version: null }   (track the shipped version)
 * @param spec - the raw `extends:` value from workspace.yaml
 */
function parseExtends(spec: string): { name: string; version: string | null } {
  const at = spec.indexOf('@');
  const name = (at === -1 ? spec : spec.slice(0, at)).trim();
  const version = at === -1 ? null : spec.slice(at + 1).trim();
  if (!name) {
    throw new Error(`invalid \`extends\` pin "${spec}" — expected e.g. "core@1.4.0" or "core"`);
  }
  return { name, version: version || null };
}

/**
 * Locate a base pack shipped inside the runtime. Only `core` exists today,
 * at packages/core/templates/base/.
 * @param name - the pack name from the `extends` pin
 */
function resolvePackDir(name: string): string {
  if (name !== 'core') {
    throw new Error(`unknown base pack "${name}" — only "core" is available`);
  }
  return fromRepoRoot('packages/core/templates/base');
}

/**
 * Resolve, read, and pin-check the base pack a workspace `extends`. Step-1
 * (ticket 007) loads identity only — pack.yaml — proving the second-directory
 * read; composing the pack's resources under the workspace comes later. Throws
 * with a clear message on an unknown pack, a missing pack.yaml, or a pin that
 * doesn't match the shipped version.
 * @param spec - the raw `extends:` value from workspace.yaml
 */
function loadPack(spec: string): LoadedPack {
  const { name, version } = parseExtends(spec);
  const dir = resolvePackDir(name);
  const packFile = ['pack.yaml', 'pack.yml'].map(n => join(/* turbopackIgnore: true */ dir, n)).find(existsSync);
  if (!packFile) {
    throw new Error(`base pack "${name}" is missing pack.yaml at ${dir}`);
  }
  const manifest = parseFile(packFile, PackManifestSchema, 'pack');
  if (version !== null && manifest.version !== version) {
    throw new Error(
      `workspace pins ${name}@${version} but the shipped pack is ${name}@${manifest.version} `
      + `— bump the \`extends\` pin or ship the pinned pack version`,
    );
  }
  return { manifest, sourcePath: dir };
}

function isYamlFile(f: string): boolean {
  return f.endsWith('.yaml') || f.endsWith('.yml');
}

function isObjectFile(f: string): boolean {
  const b = basename(f);
  return b === 'type.yaml' || b === 'type.yml';
}

/**
 * Read + YAML-parse every matching file in `dir` into unvalidated raw entries.
 * @param dir
 * @param matches
 */
function readRawEntries(dir: string, matches: (f: string) => boolean): RawEntry[] {
  return walkDir(dir)
    .filter(matches)
    .map((file) => {
      const raw = (parseYaml(readWorkspaceTextFile(file)) ?? {}) as Record<string, unknown>;
      const slug = typeof raw.slug === 'string' ? raw.slug : '';
      return { slug, raw, sourceFile: file };
    });
}

/**
 * Resolve one composable kind (agents / skills / objects / missions) into a
 * provenance-tagged list of raw entries. With no active pack, this is just the
 * workspace files (origin: workspace) — and an orphan `extends: core` marker is
 * a clear error. With a pack, it delegates to {@link composeKind}.
 * @param kind - resource kind, for error messages
 * @param workspaceDir - the workspace directory to walk for this kind
 * @param matches - filename filter for this kind
 * @param fullBase - the FULL base map for this kind (for collision detection), or undefined when no pack
 * @param activatedBase - the ACTIVATED base map for this kind, or undefined when no pack
 * @param files - sha-tracking list; workspace files are appended here
 */
function composeEntries(
  kind: 'agent' | 'object type' | 'mission',
  workspaceDir: string,
  matches: (f: string) => boolean,
  fullBase: Map<string, RawEntry> | undefined,
  activatedBase: Map<string, RawEntry> | undefined,
  files: string[],
): ComposedEntry[] {
  const wsEntries = readRawEntries(workspaceDir, matches);
  for (const e of wsEntries) {
    files.push(e.sourceFile);
  }

  if (!activatedBase || !fullBase) {
    for (const e of wsEntries) {
      if (e.raw.extends === EXTENDS_CORE) {
        throw new Error(
          `${kind} "${e.slug}" is marked \`extends: core\` but this workspace pins no base pack — set \`extends:\` in workspace.yaml or drop the marker (${e.sourceFile})`,
        );
      }
    }
    return wsEntries.map(e => ({ raw: e.raw, sourceFile: e.sourceFile, origin: 'workspace' as const }));
  }

  return composeKind(kind, wsEntries, activatedBase, new Set(fullBase.keys()));
}

/**
 * Read the base pack's resources into raw, self-contained entries (prompt-file
 * fields inlined against the pack dir so a base default never depends on a path
 * that only makes sense inside the pack). No validation here — the composed
 * result is validated by the normal schema in loadWorkspace. Base files are not
 * tracked in the sha file list; the pinned pack version covers base provenance.
 * @param pack - the resolved base pack
 */
function loadPackRaw(pack: LoadedPack): PackRaw {
  return {
    agents: readPackKind(pack.sourcePath, 'agents', isYamlFile, [{ file: 'systemPromptFile', inline: 'systemPrompt' }]),
    objectTypes: readPackKind(pack.sourcePath, 'objects', isObjectFile, [{ file: 'classificationPromptFile', inline: 'classificationPrompt' }]),
    missions: readPackKind(pack.sourcePath, 'missions', isYamlFile, []),
    skills: readPackFolders(pack.sourcePath, 'skills'),
    playbooks: readPackFolders(pack.sourcePath, 'playbooks'),
  };
}

/**
 * Index the pack's SKILL.md folders of one kind: slug + the playbook
 * slugs the frontmatter attaches. Full folder bodies load lazily in
 * {@link composeFolders} only for activated slugs.
 * @param root - pack directory
 * @param dirName - 'skills' or 'playbooks'
 * @param label
 */
function readPackFolders(root: string, dirName: 'skills' | 'playbooks', label: string = 'base pack'): Map<string, FolderEntry> {
  const map = new Map<string, FolderEntry>();
  for (const file of walkDir(join(root, dirName)).filter(f => basename(f) === 'SKILL.md')) {
    // Inherited layer, not a tenant file: no {{env.NAME}} substitution.
    const fm = parseFrontmatter(readFileSync(file, 'utf8'), file);
    const data = fm.data as { slug?: unknown; playbooks?: unknown } | null;
    const slug = typeof data?.slug === 'string' ? data.slug : '';
    if (!slug) {
      throw new Error(`${label} ${dirName} SKILL.md has no slug: ${file}`);
    }
    if (map.has(slug)) {
      throw new Error(`duplicate ${dirName} slug "${slug}" in the ${label}`);
    }
    const playbooks = Array.isArray(data?.playbooks) ? data.playbooks.filter((p): p is string => typeof p === 'string') : [];
    map.set(slug, { slug, playbooks, dir: dirname(file) });
  }
  return map;
}

/**
 * Compose one SKILL.md folder kind across the base pack and the
 * workspace. Unlike the YAML kinds there is no deep merge: a workspace
 * folder with an activated base twin replaces it OUTRIGHT (whole-file
 * replace), with sibling resources merged by path — the workspace file
 * wins where both ship the same relative path.
 * @param kind - 'skill' or 'playbook'
 * @param workspaceDir - workspace directory for this kind
 * @param pack - the resolved base pack (null without `extends`)
 * @param activatedSlugs - base slugs the workspace activated
 * @param packEntries - the FULL base index for this kind
 * @param files - sha-tracking list; workspace files are appended here
 */
function composeFolders(
  kind: 'skill' | 'playbook',
  workspaceDir: string,
  activatedSlugs: Set<string> | undefined,
  packEntries: Map<string, FolderEntry> | undefined,
  files: string[],
): LoadedPlaybook[] {
  const out: LoadedPlaybook[] = [];
  const wsSlugs = new Set<string>();

  for (const file of walkDir(workspaceDir).filter(f => basename(f) === 'SKILL.md')) {
    files.push(file);
    const loaded = loadPlaybook(file, kind, files);
    wsSlugs.add(loaded.slug);
    const isOverride = !!activatedSlugs?.has(loaded.slug);
    const baseFolder = packEntries?.get(loaded.slug)?.dir ?? null;
    if (isOverride && baseFolder) {
      // Merge base siblings by path — workspace files win, base fills gaps.
      const baseSiblings = walkDir(baseFolder)
        .filter(f => basename(f) !== 'SKILL.md' && !basename(f).startsWith('.'))
        .map(f => relative(baseFolder, f));
      const merged = new Set([...loaded.sourceFiles, ...baseSiblings]);
      out.push({ ...loaded, origin: 'override', sourceFiles: [...merged], resources: [...merged], baseSha: skillBodySha(join(baseFolder, 'SKILL.md')) ?? undefined });
    } else {
      if (packEntries?.has(loaded.slug) && !isOverride) {
        throw new Error(
          `${kind} slug "${loaded.slug}" collides with a base default the workspace has not activated — add it to workspace.yaml \`use:\` to override it, or rename (${file})`,
        );
      }
      out.push(loaded);
    }
  }

  // Activated base folders with no workspace twin mount as shipped.
  for (const slug of activatedSlugs ?? []) {
    const dir = packEntries?.get(slug)?.dir;
    if (wsSlugs.has(slug) || !dir) {
      continue;
    }
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file)) {
      throw new Error(`inherited ${kind} "${slug}" is missing its SKILL.md at ${file}`);
    }
    // Base files are not sha-tracked; the pinned pack version covers them.
    out.push({ ...loadPlaybook(file, kind, [], false), origin: 'core' });
  }

  return out;
}

/**
 * Read one team file. Slug comes from the filename (teams/<slug>.yaml), so a
 * team cannot disagree with its own path.
 * @param file - absolute path of the team YAML
 * @param files - sha-tracking list; pass `null` for an inherited (plugin) file
 */
function loadTeam(file: string, files: string[] | null): LoadedTeam {
  files?.push(file);
  const parsed = files ? parseFile(file, TeamManifestSchema, 'team') : validateOrThrow(TeamManifestSchema, parseYaml(readFileSync(file, 'utf8')), file, 'team');
  const slug = basename(file, extname(file));
  if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
    throw new WorkspaceValidationError(file, 'team', [`filename "${slug}" is not a valid team slug (lowercase, start with a letter, letters/numbers/dashes/underscores)`]);
  }
  return { ...parsed, slug, sourceFile: file };
}

/** The inherited layer the workspace composes over: every slug it ships (for collisions) and the active subset. */
type InheritedLayer = { full: PackRaw; active: ActivatedPack };

/**
 * Fold the activated base pack and every enabled plugin into ONE inherited
 * layer. Plugin resources are always active. A plugin may shadow a same-slug
 * base default (the plugin is the more specific layer); two plugins shipping
 * one slug is an authoring error. `disable:` applies to the merged result,
 * so the escape hatch reaches a plugin's agent or skill as well.
 *
 * Null when there is neither a pack nor a plugin — the unchanged path.
 * @param packRaw - the full base pack, or null
 * @param activated - the pack's activated subset, or null
 * @param plugins - enabled plugins, in load order
 * @param disable - the workspace `disable:` selector
 * @param disable.agents
 * @param disable.skills
 * @param disable.playbooks
 */
function composeInherited(
  packRaw: PackRaw | null,
  activated: ActivatedPack | null,
  plugins: LoadedPlugin[],
  disable?: { agents?: string[]; skills?: string[]; playbooks?: string[] },
): InheritedLayer | null {
  if (!packRaw && plugins.length === 0) {
    return null;
  }
  const full: PackRaw = {
    agents: new Map(packRaw?.agents ?? []),
    objectTypes: new Map(packRaw?.objectTypes ?? []),
    missions: new Map(packRaw?.missions ?? []),
    skills: new Map(packRaw?.skills ?? []),
    playbooks: new Map(packRaw?.playbooks ?? []),
  };
  const active: ActivatedPack = {
    agents: new Map(activated?.agents ?? []),
    objectTypes: new Map(activated?.objectTypes ?? []),
    missions: new Map(activated?.missions ?? []),
    skills: new Set(activated?.skills ?? []),
    playbooks: new Set(activated?.playbooks ?? []),
  };
  const owner = new Map<string, string>(); // `${kind}:${slug}` → plugin slug, for the two-plugins error

  for (const plugin of plugins) {
    const raw = loadLayerRaw(plugin.sourcePath, `plugin "${plugin.manifest.slug}"`);
    const take = <V>(kind: string, source: Map<string, V>, fullMap: Map<string, V>, activeSet: Map<string, V> | Set<string>) => {
      for (const [slug, entry] of source) {
        const key = `${kind}:${slug}`;
        const prior = owner.get(key);
        if (prior) {
          throw new Error(`${kind} "${slug}" is shipped by both plugin "${prior}" and plugin "${plugin.manifest.slug}" — a slug belongs to one plugin`);
        }
        owner.set(key, plugin.manifest.slug);
        fullMap.set(slug, entry);
        if (activeSet instanceof Set) {
          activeSet.add(slug);
        } else {
          activeSet.set(slug, entry);
        }
      }
    };
    take('agent', raw.agents, full.agents, active.agents);
    take('object type', raw.objectTypes, full.objectTypes, active.objectTypes);
    take('mission', raw.missions, full.missions, active.missions);
    take('skill', raw.skills, full.skills, active.skills);
    take('playbook', raw.playbooks, full.playbooks, active.playbooks);
    // A plugin skill carries its attached playbooks, like an activated base skill.
    for (const entry of raw.skills.values()) {
      for (const pb of entry.playbooks) {
        if (full.playbooks.has(pb)) {
          active.playbooks.add(pb);
        }
      }
    }
  }

  for (const slug of disable?.agents ?? []) {
    active.agents.delete(slug);
  }
  for (const slug of disable?.skills ?? []) {
    active.skills.delete(slug);
  }
  for (const slug of disable?.playbooks ?? []) {
    active.playbooks.delete(slug);
  }
  return { full, active };
}

/**
 * Read one inherited layer's composable kinds (base pack or plugin) into raw
 * entries — prompt files inlined against the layer dir.
 * @param root - the layer directory
 * @param label - how the layer is named in errors
 */
function loadLayerRaw(root: string, label: string): PackRaw {
  return {
    agents: readPackKind(root, 'agents', isYamlFile, [{ file: 'systemPromptFile', inline: 'systemPrompt' }], label),
    objectTypes: readPackKind(root, 'objects', isObjectFile, [{ file: 'classificationPromptFile', inline: 'classificationPrompt' }], label),
    missions: readPackKind(root, 'missions', isYamlFile, [], label),
    skills: readPackFolders(root, 'skills', label),
    playbooks: readPackFolders(root, 'playbooks', label),
  };
}

type PluginExtras = {
  automations: LoadedAutomation[];
  teams: LoadedTeam[];
  learningSteps: LoadedLearningStep[];
  trust: TrustManifest[];
};

/**
 * Every `pluginSettings` entry names an enabled plugin and a setting it
 * declares, so a typo fails the load instead of leaving a switch silently off.
 * @param plugins - enabled plugins
 * @param pluginSettings - workspace.yaml `pluginSettings`
 */
function assertPluginSettings(plugins: LoadedPlugin[], pluginSettings: Record<string, Record<string, boolean>>): void {
  for (const [slug, values] of Object.entries(pluginSettings)) {
    const plugin = plugins.find(p => p.manifest.slug === slug);
    if (!plugin) {
      throw new Error(`pluginSettings names plugin "${slug}", which is not on — add it to plugins: first`);
    }
    const declared = plugin.manifest.settings ?? {};
    for (const key of Object.keys(values)) {
      if (!declared[key]) {
        const known = Object.keys(declared);
        throw new Error(`pluginSettings.${slug}.${key}: plugin "${slug}" has no setting "${key}"${known.length > 0 ? ` (it has ${known.join(', ')})` : ' (it declares none)'}`);
      }
    }
  }
}

/**
 * Whether a plugin automation runs here: always, unless it names a `setting`
 * — then that setting's value in this workspace, else the plugin's default.
 * @param plugin - the plugin that ships it
 * @param automation - the parsed automation
 * @param automation.slug - its slug
 * @param automation.setting - the setting it waits for, if any
 * @param pluginSettings - workspace.yaml `pluginSettings`
 */
function settingAllows(plugin: LoadedPlugin, automation: { slug: string; setting?: string }, pluginSettings: Record<string, Record<string, boolean>>): boolean {
  if (!automation.setting) {
    return true;
  }
  const slug = plugin.manifest.slug;
  const declared = plugin.manifest.settings?.[automation.setting];
  if (!declared) {
    throw new Error(`automation "${automation.slug}" of plugin "${slug}" waits for setting "${automation.setting}", which the plugin does not declare under settings:`);
  }
  return pluginSettings[slug]?.[automation.setting] ?? declared.default;
}

/**
 * The non-composable kinds a plugin ships: automations, teams, learning steps
 * and trust rules. Read as shipped (no {{env}} substitution, not sha-tracked —
 * the plugin version covers provenance). Two plugins shipping one automation or
 * team slug is an error, like the composable kinds.
 * @param plugins - enabled plugins, in load order
 * @param pluginSettings - workspace.yaml `pluginSettings`, which turns setting-gated automations on
 */
function loadPluginExtras(plugins: LoadedPlugin[], pluginSettings: Record<string, Record<string, boolean>> = {}): PluginExtras {
  const out: PluginExtras = { automations: [], teams: [], learningSteps: [], trust: [] };
  assertPluginSettings(plugins, pluginSettings);
  const seen = new Map<string, string>();
  const claim = (kind: string, slug: string, plugin: string) => {
    const key = `${kind}:${slug}`;
    const prior = seen.get(key);
    if (prior) {
      throw new Error(`${kind} "${slug}" is shipped by both plugin "${prior}" and plugin "${plugin}" — a slug belongs to one plugin`);
    }
    seen.set(key, plugin);
  };
  for (const plugin of plugins) {
    const root = plugin.sourcePath;
    const name = plugin.manifest.slug;
    for (const file of walkDir(join(root, 'automations')).filter(isYamlFile)) {
      const parsed = validateOrThrow(AutomationManifestSchema, parseYaml(readFileSync(file, 'utf8')), file, 'automation');
      claim('automation', parsed.slug, name);
      out.automations.push({ ...parsed, status: settingAllows(plugin, parsed, pluginSettings) ? parsed.status : 'disabled', sourceFile: file });
    }
    for (const file of walkDir(join(root, 'teams')).filter(isYamlFile)) {
      const team = loadTeam(file, null);
      claim('team', team.slug, name);
      out.teams.push(team);
    }
    for (const file of walkDir(join(root, 'learnings')).filter(isYamlFile)) {
      const parsed = validateOrThrow(LearningStepManifestSchema, parseYaml(readFileSync(file, 'utf8')), file, 'learningStep');
      claim('learning step', parsed.name, name);
      out.learningSteps.push({ ...parsed, sourceFile: file });
    }
    const trustFile = ['trust.yaml', 'trust.yml'].map(n => join(/* turbopackIgnore: true */ root, n)).find(existsSync);
    if (trustFile) {
      out.trust.push(validateOrThrow(TrustManifestSchema, parseYaml(readFileSync(trustFile, 'utf8')), trustFile, 'trust') as TrustManifest);
    }
  }
  return out;
}

/**
 * Workspace entries win over inherited ones with the same key; everything
 * else is appended in load order. Whole-file replace, no merge.
 * @param workspace - the workspace's own entries
 * @param inherited - plugin entries, in load order
 * @param keyOf - the identity to compare on (slug, or name for learning steps)
 */
function inheritBy<T>(workspace: T[], inherited: T[], keyOf: (t: T) => string): T[] {
  const taken = new Set(workspace.map(keyOf));
  return [...workspace, ...inherited.filter(t => !taken.has(keyOf(t)))];
}

/**
 * Trust rules compose per action id: a plugin's rule stands unless the
 * workspace's trust.yaml names the same action, in which case the workspace
 * rule replaces it; risk tiers merge the same way. Null when nobody authored
 * any — the unchanged path.
 * @param inherited - plugin trust manifests, in load order
 * @param workspace - the workspace's own trust.yaml, or null
 */
function mergeTrust(inherited: TrustManifest[], workspace: TrustManifest | null): TrustManifest | null {
  if (inherited.length === 0) {
    return workspace;
  }
  const rules = new Map<string, TrustManifest['rules'][number]>();
  const risk: Record<string, 'low' | 'medium' | 'high'> = {};
  for (const t of [...inherited, ...(workspace ? [workspace] : [])]) {
    for (const rule of t.rules) {
      rules.set(rule.action, rule);
    }
    Object.assign(risk, t.risk ?? {});
  }
  return { rules: [...rules.values()], ...(Object.keys(risk).length > 0 ? { risk } : {}) };
}

function readPackKind(
  root: string,
  dirName: string,
  matches: (f: string) => boolean,
  promptFields: Array<{ file: string; inline: string }>,
  label: string = 'base pack',
): Map<string, RawEntry> {
  const map = new Map<string, RawEntry>();
  for (const file of walkDir(join(root, dirName)).filter(matches)) {
    // Base pack, not a tenant file: no {{env.NAME}} substitution.
    const raw = (parseYaml(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>;
    for (const { file: fileKey, inline } of promptFields) {
      const rel = raw[fileKey];
      if (typeof rel === 'string' && rel) {
        raw[inline] = readFileSync(resolve(dirname(file), rel), 'utf8').trim();
        delete raw[fileKey];
      }
    }
    const slug = typeof raw.slug === 'string' ? raw.slug : '';
    if (!slug) {
      throw new Error(`${label} ${dirName} file has no slug: ${file}`);
    }
    if (map.has(slug)) {
      throw new Error(`duplicate ${dirName} slug "${slug}" in the ${label}`);
    }
    map.set(slug, { slug, raw, sourceFile: file });
  }
  return map;
}

function parseFile<T>(file: string, schema: ZodType<T>, kind: string): T {
  const raw = readWorkspaceTextFile(file);
  const parsed = parseYaml(raw);
  return validateOrThrow(schema, parsed, file, kind);
}

function validateOrThrow<T>(schema: ZodType<T>, value: unknown, file: string, kind: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const messages = result.error.issues.map(issue => `${issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'}: ${issue.message}`);
    throw new WorkspaceValidationError(file, kind, messages);
  }
  return result.data;
}

/**
 * Parse a SKILL.md file (skill or playbook): split YAML frontmatter from
 * markdown body, validate the frontmatter via
 * {@link PlaybookManifestSchema}, compute a SHA-256 of the body, and
 * discover sibling resource files. Origin defaults to 'workspace'; the
 * folder compose overrides it for base and override entries.
 *
 * `isWorkspaceFile` is false for a base-pack folder, which is read
 * exactly as shipped — see `template-vars.ts` for why.
 * @param file - absolute path to the SKILL.md.
 * @param kind - skill or playbook.
 * @param filesTracked - collects sibling paths for the workspace sha.
 * @param isWorkspaceFile - false for a base-pack folder (no substitution).
 */
function loadPlaybook(
  file: string,
  kind: 'skill' | 'playbook',
  filesTracked: string[],
  isWorkspaceFile: boolean = true,
): LoadedPlaybook {
  // Only a tenant's own files carry {{env.NAME}} tokens; the base pack
  // ships the same bytes to everyone.
  const raw = isWorkspaceFile ? readWorkspaceTextFile(file) : readFileSync(file, 'utf8');
  const fm = parseFrontmatter(raw, file);
  const parsed = validateOrThrow(PlaybookManifestSchema, fm.data, file, 'playbook');
  const contentSha = createHash('sha256').update(fm.body, 'utf8').digest('hex');

  // Walk sibling files within the playbook folder; skip the SKILL.md
  // itself and anything dotted.
  const folder = dirname(file);
  const siblings = walkDir(folder)
    .filter(f => f !== file && !basename(f).startsWith('.'))
    .map(f => relative(folder, f));
  for (const s of siblings) {
    filesTracked.push(join(folder, s));
  }

  return {
    ...parsed,
    body: fm.body,
    contentSha,
    sourceFiles: siblings,
    sourceFile: file,
    kind,
    origin: 'workspace',
    // If the manifest didn't declare `resources` explicitly, fall back
    // to every sibling we discovered.
    resources: parsed.resources.length > 0 ? parsed.resources : siblings,
  };
}

/**
 * Every by-name reference must resolve: an agent's `skills:` to a loaded
 * skill, an agent's `playbooks:` and a skill's `playbooks:` to a loaded
 * playbook. Caught at load so `workspace:check` fails on a reference
 * that resolves to nothing.
 * @param agents
 * @param skills
 * @param playbooks
 */
function assertNamedRefs(agents: LoadedAgent[], skills: LoadedPlaybook[], playbooks: LoadedPlaybook[]): void {
  const skillSlugs = new Set(skills.map(s => s.slug));
  const playbookSlugs = new Set(playbooks.map(p => p.slug));
  const problems: string[] = [];
  for (const agent of agents) {
    for (const s of agent.skills) {
      if (!skillSlugs.has(s)) {
        problems.push(`agent "${agent.slug}" names skill "${s}", which resolves to nothing`);
      }
    }
    for (const p of agent.playbooks) {
      if (!playbookSlugs.has(p)) {
        problems.push(`agent "${agent.slug}" names playbook "${p}", which resolves to nothing`);
      }
    }
  }
  for (const skill of skills) {
    for (const p of skill.playbooks) {
      if (!playbookSlugs.has(p)) {
        problems.push(`skill "${skill.slug}" attaches playbook "${p}", which resolves to nothing`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`unresolved references:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * The SHA-256 of a SKILL.md body — the same digest `contentSha` is — or null
 * when the file is missing or has no frontmatter. What an override's twin is
 * compared by: the body, never the frontmatter, so a reworded description is
 * not drift.
 * @param file - Absolute path of a SKILL.md.
 */
export function skillBodySha(file: string): string | null {
  if (!existsSync(file)) {
    return null;
  }
  try {
    const fm = parseFrontmatter(readFileSync(file, 'utf8'), file);
    return createHash('sha256').update(fm.body, 'utf8').digest('hex');
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string, file: string): { data: unknown; body: string } {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = raw.match(fmRegex);
  if (!match) {
    throw new Error(`playbook ${file} is missing YAML frontmatter (expected leading ---...---)`);
  }
  const [, yamlText, body] = match;
  let data: unknown;
  try {
    data = parseYaml(yamlText ?? '');
  } catch (err) {
    throw new Error(`playbook ${file}: invalid YAML frontmatter — ${(err as Error).message}`);
  }
  return { data, body: (body ?? '').trim() };
}

function resolvePromptField(sourceFile: string, promptFile: string | undefined, inline: string | undefined, filesTracked: string[]): string {
  if (promptFile) {
    const abs = resolve(dirname(sourceFile), promptFile);
    const content = readWorkspaceTextFile(abs);
    filesTracked.push(abs);
    return content.trim();
  }
  return (inline ?? '').trim();
}

function walkDir(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    const out: string[] = [];
    for (const e of entries) {
      const full = join(dir, e);
      const st = statSync(full);
      if (st.isDirectory()) {
        out.push(...walkDir(full));
      } else {
        out.push(full);
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Every object type reads its records by a code (FE-294, `libs/codes.ts`), and
 * a code names one type in a workspace: two types declaring the same code, or
 * one taking a core noun's (RUN, ACT…), is refused here with both named. A
 * type that declares none gets one derived from its slug, widened past any
 * clash. Returns slug → code, which the applier stores on each type row.
 * @param objectTypes - Every object type the workspace loads, plugins' included.
 */
function assertTypeCodes(objectTypes: ReadonlyArray<{ slug: string; code?: string }>): Map<string, string> {
  const { codes, problems } = assignTypeCodes(objectTypes);
  if (problems.length > 0) {
    throw new Error(`object type codes clash:\n  - ${problems.join('\n  - ')}`);
  }
  return codes;
}

function assertUniqueSlugs<T extends { slug: string }>(items: T[], kind: string): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    seen.set(item.slug, (seen.get(item.slug) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  if (dups.length > 0) {
    throw new Error(`duplicate ${kind} slugs: ${dups.join(', ')}`);
  }
}

function assertUniqueNames<T extends { name: string }>(items: T[], kind: string): void {
  const seen = new Map<string, number>();
  for (const item of items) {
    seen.set(item.name, (seen.get(item.name) ?? 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
  if (dups.length > 0) {
    throw new Error(`duplicate ${kind} names: ${dups.join(', ')}`);
  }
}

export class WorkspaceValidationError extends Error {
  constructor(public readonly file: string, public readonly kind: string, public readonly issues: string[]) {
    super(`${kind} validation failed at ${file}:\n  - ${issues.join('\n  - ')}`);
    this.name = 'WorkspaceValidationError';
  }
}
