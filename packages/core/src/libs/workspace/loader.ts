import type { ZodType } from 'zod';
import type { ComposedEntry, FolderEntry, PackRaw, RawEntry } from './compose';
import type { Origin } from './merge';
import type { AgentManifest, AutomationManifest, EvalDatasetManifest, LearningStepManifest, MissionManifest, ObjectTypeManifest, PackManifest, PlaybookManifest, SourceManifest, TeamManifest, TrustManifest, WorkflowManifest, WorkspaceManifest } from './schemas';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isSurfaceId, SURFACE_IDS } from '@/features/navigation/surfaces';
import { fromRepoRoot } from '@/libs/repo-root';
import { composeKind, resolveActivation } from './compose';
import { assertAgentHierarchy } from './hierarchy';
import { EXTENDS_CORE } from './merge';
import { assertDoTargets, assertOwnership } from './ownership';
import {
  AgentManifestSchema,
  AutomationManifestSchema,
  EvalDatasetManifestSchema,
  LearningStepManifestSchema,
  MissionManifestSchema,
  ObjectTypeManifestSchema,
  PackManifestSchema,
  PlaybookManifestSchema,
  SourceManifestSchema,
  TeamManifestSchema,
  TrustManifestSchema,
  WorkflowManifestSchema,
  WorkspaceManifestSchema,
} from './schemas';
import { computeWorkspaceSha } from './sha';
import { assertTeams } from './teams';

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
export type LoadedObjectType = ObjectTypeManifest & { resolvedClassificationPrompt: string | null; sourceFile: string; origin: Origin };
export type LoadedWorkflow = WorkflowManifest & { sourceFile: string };
export type LoadedMission = MissionManifest & { sourceFile: string; origin: Origin };
export type LoadedAutomation = AutomationManifest & { sourceFile: string };

export type LoadedLearningStep = LearningStepManifest & { sourceFile: string };
export type LoadedEvalDataset = EvalDatasetManifest & { sourceFile: string };
export type LoadedSource = SourceManifest & { sourceFile: string };
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
  agents: LoadedAgent[];
  /** SKILL.md skill folders — the deepagents unit (kind: 'skill'). */
  skills: LoadedPlaybook[];
  objectTypes: LoadedObjectType[];
  workflows: LoadedWorkflow[];
  missions: LoadedMission[];
  automations: LoadedAutomation[];
  trust: TrustManifest | null;
  playbooks: LoadedPlaybook[];
  learningSteps: LoadedLearningStep[];
  evalDatasets: LoadedEvalDataset[];
  sources: LoadedSource[];
  teams: LoadedTeam[];
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
  const files: string[] = [];

  // Base-pack compose (ticket 007). With no pack, `activated` is null and every
  // composable kind reduces to "workspace files only, origin: workspace" — the
  // byte-for-byte-unchanged path. With a pack, base defaults the workspace
  // activated are merged in per-slug (see compose.ts).
  const packRaw = pack ? loadPackRaw(pack) : null;
  const activated = packRaw ? resolveActivation(packRaw, manifest.use, manifest.disable) : null;

  const agents = composeEntries('agent', join(abs, 'agents'), isYamlFile, packRaw?.agents, activated?.agents, files)
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
  const skills = composeFolders('skill', join(abs, 'skills'), pack, activated?.skills, packRaw?.skills, files);

  const objectTypes = composeEntries('object type', join(abs, 'objects'), isObjectFile, packRaw?.objectTypes, activated?.objectTypes, files)
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

  const missions = composeEntries('mission', join(abs, 'missions'), isYamlFile, packRaw?.missions, activated?.missions, files)
    .map((entry) => {
      const parsed = validateOrThrow(MissionManifestSchema, entry.raw, entry.sourceFile, 'mission');
      return { ...parsed, sourceFile: entry.sourceFile, origin: entry.origin };
    });

  const trustPath = ['trust.yaml', 'trust.yml'].map(n => join(abs, n)).find(existsSync) ?? null;
  const trust: TrustManifest | null = trustPath
    ? (() => {
        files.push(trustPath);
        return parseFile(trustPath, TrustManifestSchema, 'trust') as TrustManifest;
      })()
    : null;

  const automations = walkDir(join(abs, 'automations'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, AutomationManifestSchema, 'automation');
      return { ...parsed, sourceFile: file };
    });

  const playbooks = composeFolders('playbook', join(abs, 'playbooks'), pack, activated?.playbooks, packRaw?.playbooks, files);

  const learningSteps = walkDir(join(abs, 'learnings'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, LearningStepManifestSchema, 'learningStep');
      return { ...parsed, sourceFile: file };
    });

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
      return { ...parsed, sourceFile: file };
    });

  // Teams (F1): slug comes from the filename, so a team can't disagree
  // with its own path. teams/revenue-ops.yaml → slug "revenue-ops".
  const teams = walkDir(join(abs, 'teams'))
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((file) => {
      files.push(file);
      const parsed = parseFile(file, TeamManifestSchema, 'team');
      const slug = basename(file, extname(file));
      if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
        throw new WorkspaceValidationError(file, 'team', [`filename "${slug}" is not a valid team slug (lowercase, start with a letter, letters/numbers/dashes/underscores)`]);
      }
      return { ...parsed, slug, sourceFile: file };
    });

  // Surfaces name a core-registered route, never a URL — so an unknown id is
  // caught here at `workspace:check` instead of rendering a dead sidebar link.
  const unknownSurfaces = manifest.surfaces.filter(id => !isSurfaceId(id));
  if (unknownSurfaces.length > 0) {
    throw new WorkspaceValidationError(
      join(abs, 'workspace.yaml'),
      'workspace manifest',
      unknownSurfaces.map(id => `unknown surface "${id}" — this core registers: ${SURFACE_IDS.join(', ')}`),
    );
  }

  assertUniqueSlugs(agents, 'agent');
  assertAgentHierarchy(agents);
  assertUniqueSlugs(teams, 'team');
  assertTeams(agents, teams, manifest);
  assertUniqueSlugs(skills, 'skill');
  assertUniqueSlugs(objectTypes, 'object type');
  assertNamedRefs(agents, skills, playbooks);
  assertUniqueSlugs(workflows, 'workflow');
  assertUniqueSlugs(missions, 'mission');
  assertUniqueSlugs(automations, 'automation');
  assertUniqueSlugs(playbooks, 'playbook');
  assertUniqueNames(learningSteps, 'learning step');
  assertUniqueSlugs(evalDatasets, 'eval dataset');
  assertUniqueSlugs(sources, 'source');
  assertOwnership(agents, automations, workflows);
  assertDoTargets(automations, missions, workflows);

  // Provenance: fold the pinned base-pack version into the workspace sha so
  // `workspace_sha` still answers "exactly what ran" — a workspace on
  // core@1.0.0 and the same workspace on core@1.1.0 are distinguishable even
  // though not one workspace file changed. No pack → sha is unchanged.
  const baseSha = computeWorkspaceSha(abs, files);
  const sha = pack ? `${baseSha}+${pack.manifest.name}@${pack.manifest.version}` : baseSha;

  return {
    manifest,
    pack,
    agents,
    skills,
    objectTypes,
    workflows,
    missions,
    automations,
    trust,
    playbooks,
    learningSteps,
    evalDatasets,
    sources,
    teams,
    sha,
    sourcePath: abs,
    fileCount: files.length + 1,
  };
}

function loadManifest(abs: string): WorkspaceManifest {
  const candidates = ['workspace.yaml', 'workspace.yml'];
  for (const c of candidates) {
    const p = join(abs, c);
    try {
      const raw = readFileSync(p, 'utf8');
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
  const packFile = ['pack.yaml', 'pack.yml'].map(n => join(dir, n)).find(existsSync);
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
      const raw = (parseYaml(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>;
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
 */
function readPackFolders(root: string, dirName: 'skills' | 'playbooks'): Map<string, FolderEntry> {
  const map = new Map<string, FolderEntry>();
  for (const file of walkDir(join(root, dirName)).filter(f => basename(f) === 'SKILL.md')) {
    const fm = parseFrontmatter(readFileSync(file, 'utf8'), file);
    const data = fm.data as { slug?: unknown; playbooks?: unknown } | null;
    const slug = typeof data?.slug === 'string' ? data.slug : '';
    if (!slug) {
      throw new Error(`base pack ${dirName} SKILL.md has no slug: ${file}`);
    }
    if (map.has(slug)) {
      throw new Error(`duplicate base ${dirName} slug "${slug}" in the core pack`);
    }
    const playbooks = Array.isArray(data?.playbooks) ? data.playbooks.filter((p): p is string => typeof p === 'string') : [];
    map.set(slug, { slug, playbooks });
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
  pack: LoadedPack | null,
  activatedSlugs: Set<string> | undefined,
  packEntries: Map<string, FolderEntry> | undefined,
  files: string[],
): LoadedPlaybook[] {
  const packDir = pack ? join(pack.sourcePath, kind === 'skill' ? 'skills' : 'playbooks') : null;
  const out: LoadedPlaybook[] = [];
  const wsSlugs = new Set<string>();

  for (const file of walkDir(workspaceDir).filter(f => basename(f) === 'SKILL.md')) {
    files.push(file);
    const loaded = loadPlaybook(file, kind, files);
    wsSlugs.add(loaded.slug);
    const isOverride = !!activatedSlugs?.has(loaded.slug);
    if (isOverride && packDir) {
      // Merge base siblings by path — workspace files win, base fills gaps.
      const baseFolder = join(packDir, loaded.slug);
      const baseSiblings = walkDir(baseFolder)
        .filter(f => basename(f) !== 'SKILL.md' && !basename(f).startsWith('.'))
        .map(f => relative(baseFolder, f));
      const merged = new Set([...loaded.sourceFiles, ...baseSiblings]);
      out.push({ ...loaded, origin: 'override', sourceFiles: [...merged], resources: [...merged] });
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
    if (wsSlugs.has(slug) || !packDir) {
      continue;
    }
    const file = join(packDir, slug, 'SKILL.md');
    if (!existsSync(file)) {
      throw new Error(`base pack ${kind} "${slug}" is missing its SKILL.md at ${file}`);
    }
    // Base files are not sha-tracked; the pinned pack version covers them.
    out.push({ ...loadPlaybook(file, kind, []), origin: 'core' });
  }

  return out;
}

function readPackKind(
  root: string,
  dirName: string,
  matches: (f: string) => boolean,
  promptFields: Array<{ file: string; inline: string }>,
): Map<string, RawEntry> {
  const map = new Map<string, RawEntry>();
  for (const file of walkDir(join(root, dirName)).filter(matches)) {
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
      throw new Error(`base pack ${dirName} file has no slug: ${file}`);
    }
    if (map.has(slug)) {
      throw new Error(`duplicate base ${dirName} slug "${slug}" in the core pack`);
    }
    map.set(slug, { slug, raw, sourceFile: file });
  }
  return map;
}

function parseFile<T>(file: string, schema: ZodType<T>, kind: string): T {
  const raw = readFileSync(file, 'utf8');
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
 * @param file
 * @param kind
 * @param filesTracked
 */
function loadPlaybook(file: string, kind: 'skill' | 'playbook', filesTracked: string[]): LoadedPlaybook {
  const raw = readFileSync(file, 'utf8');
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
    const content = readFileSync(abs, 'utf8');
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
