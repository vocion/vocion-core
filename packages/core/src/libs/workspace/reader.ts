import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { pluginRoots, PLUGINS_REL } from './plugins';

/**
 * Read the files that back a primitive instance from the tenant context
 * directory. Used by the `/dashboard/<primitive>/<slug>` drilldown pages
 * and the oRPC `context.readPrimitive` route.
 *
 * Returns whatever files exist for the kind/slug — one or many. Callers
 * don't need to know whether a skill is `skill.yaml` + `prompt.md` or a
 * workflow is a single `workflow.yaml`.
 *
 * Provenance (ticket 007): when a base pack ships a same-slug default, its
 * file(s) are appended as read-only `layer: 'core'` entries so the drilldown
 * shows both what you inherited and what you changed. A workspace override sits
 * on top (`layer: 'workspace'`, editable); a purely inherited default shows the
 * core layer alone.
 */

export type PrimitiveKind = 'skill' | 'workflow' | 'object' | 'agent' | 'source' | 'mission' | 'automation' | 'team';

/** Which layer a drilldown file comes from — the workspace, or the core base pack underneath it. */
export type FileLayer = 'workspace' | 'core';

export type PrimitiveFile = {
  /** Path relative to the context dir, e.g. `skills/discovery-summary/prompt.md` */
  path: string;
  /** Full repo-relative path used by the writeFile oRPC route, e.g. `workspace/<org>/skills/discovery-summary/prompt.md`. Absent for read-only core-pack files. */
  fullPath?: string;
  content: string;
  language: 'yaml' | 'markdown' | 'javascript';
  /** Provenance: `workspace` (editable) or `core` (the inherited base default, read-only). */
  layer: FileLayer;
};

export type PrimitiveFilesResult = {
  files: PrimitiveFile[];
  /** The folder an edit writes to; empty when the files are shown read-only (no folder of the project's on this host). */
  contextPath: string;
  editInGitPath: string;
};

/** Base pack shipped inside the runtime — the `core` layer under a workspace. */
const BASE_PACK_REL = 'packages/core/templates/base';

export function getWorkspacePath(): string | null {
  return process.env.WORKSPACE_PATH ?? null;
}

/**
 * A core base-pack agent, read straight from the shipped pack files — the
 * roster of "what comes with core," independent of any workspace. Used to
 * surface core agents a workspace hasn't activated (ticket 007 follow-up:
 * greyed "not activated" cards on the Agents page). The shape mirrors the
 * display fields the Agents grid reads off an applied agent row.
 */
export type CorePackAgent = {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  eyebrow: string | null;
  /** Parent lead slug (`parent:` in YAML); null for a lead. */
  parentSlug: string | null;
  skillCount: number;
};

/**
 * Read the core base pack's agent roster from the runtime's shipped files
 * (`packages/core/templates/base/agents/*.yaml`). Pure filesystem read, no DB
 * and no workspace — the pack is fixed at build time. Returns [] if the pack
 * dir is absent. Callers cross-reference these slugs against the applied
 * agents to find what a workspace ships-with-core but hasn't activated.
 */
export function listCorePackAgents(): CorePackAgent[] {
  const dir = fromRepoRoot(BASE_PACK_REL, 'agents');
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter(n => n.endsWith('.yaml') || n.endsWith('.yml'))
    .map((name) => {
      const raw = (parseYaml(readFileSync(join(dir, name), 'utf8')) ?? {}) as Record<string, unknown>;
      const slug = typeof raw.slug === 'string' ? raw.slug : name.replace(/\.ya?ml$/, '');
      const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
      return {
        slug,
        name: str(raw.name) ?? slug,
        description: str(raw.description),
        icon: str(raw.icon),
        accent: str(raw.accent),
        eyebrow: str(raw.eyebrow),
        parentSlug: str(raw.parent),
        skillCount: Array.isArray(raw.skills) ? raw.skills.length : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read one workspace file, refusing if it points outside the folder that
 * owns it.
 *
 * The slug guard at the entry point stops a path from being *written* to
 * climb out. It says nothing about a symlink already sitting in the
 * workspace: a tenant's workspace is a git checkout, git carries symlinks,
 * and `readFileSync` follows them without complaint. Resolving both sides
 * is the only way to see where the read actually lands.
 *
 * Returns null when the file is missing or refused, so a caller drops it
 * from the layer rather than failing the whole page.
 * @param base - Folder the file must stay inside.
 * @param filePath - The file to read.
 */
function readContainedFile(base: string, filePath: string): string | null {
  try {
    const realBase = realpathSync(base);
    const realPath = realpathSync(filePath);
    const relativeToBase = relative(realBase, realPath);
    if (relativeToBase.startsWith(`..${sep}`) || relativeToBase === '..' || relativeToBase.startsWith(sep)) {
      return null;
    }
    return readFileSync(realPath, 'utf-8');
  } catch {
    // Missing, unreadable, or a broken link — the caller treats it the same
    // way it already treats a file that isn't there.
    return null;
  }
}

/**
 * What a workspace primitive slug is allowed to look like.
 *
 * Deliberately narrow: no dots, no slashes, nothing that can walk up a
 * directory. Shared with the oRPC router so both entry points agree on
 * which slugs exist.
 */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][\w-]*$/i;

function slugToDirname(slug: string): string {
  return slug.replace(/_/g, '-');
}

function kindDir(kind: PrimitiveKind): string {
  switch (kind) {
    case 'skill': return 'skills';
    case 'workflow': return 'workflows';
    case 'object': return 'objects';
    case 'source': return 'sources';
    case 'agent': return 'agents';
    case 'mission': return 'missions';
    case 'automation': return 'automations';
    case 'team': return 'teams';
  }
}

function detectLanguage(fileName: string): 'yaml' | 'markdown' | 'javascript' {
  if (fileName.endsWith('.md')) {
    return 'markdown';
  }
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs')) {
    return 'javascript';
  }
  return 'yaml';
}

type WorkspaceLayer = { files: PrimitiveFile[]; editInGitPath: string };

/**
 * What the workspace layer is read through: the folder on disk, or the
 * project's stored copy of it (`services/workspace/WorkspaceFileService.ts`).
 * Paths are inside the workspace, `/`-separated — the same either way, so
 * one layout rule serves both.
 */
export type WorkspaceTree = {
  /** Whether a file sits at this path. */
  hasFile: (path: string) => boolean;
  /** Whether a folder sits at this path. */
  hasDir: (path: string) => boolean;
  /** A file's text, or null when it is missing or refused. */
  read: (path: string) => string | null;
  /** Names directly inside a folder. */
  list: (path: string) => string[];
};

/**
 * The folder on disk as a {@link WorkspaceTree}. Every read goes through
 * {@link readContainedFile}, so a symlink out of the file's folder is refused.
 * @param base - The workspace folder, absolute.
 */
function folderTree(base: string): WorkspaceTree {
  const abs = (path: string) => join(base, ...path.split('/'));
  return {
    hasFile: path => existsSync(abs(path)),
    hasDir: path => existsSync(abs(path)),
    read: path => readContainedFile(dirname(abs(path)), abs(path)),
    list: path => readdirSync(abs(path)),
  };
}

/**
 * A project's stored files as a {@link WorkspaceTree}.
 * @param files - Path → text, as stored.
 */
export function storedTree(files: ReadonlyMap<string, string>): WorkspaceTree {
  return {
    hasFile: path => files.has(path),
    hasDir: path => [...files.keys()].some(p => p.startsWith(`${path}/`)),
    read: path => files.get(path) ?? null,
    list: path => [...files.keys()].filter(p => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/')).map(p => p.slice(path.length + 1)),
  };
}

/**
 * The workspace layer — the tenant's own files for this kind/slug, exactly as
 * before ticket 007 but tagged `layer: 'workspace'`.
 * @param kind - primitive kind
 * @param slug - primitive slug
 * @param tree - where the files are read from
 * @param contextPath - the folder an edit writes to (WORKSPACE_PATH), or null
 * when this host has no folder of the project's to write — the files are then
 * shown read-only and named by their path in the workspace repo.
 */
function readWorkspaceLayer(kind: PrimitiveKind, slug: string, tree: WorkspaceTree, contextPath: string | null): WorkspaceLayer | null {
  const dirName = slugToDirname(slug);
  const at = (rel: string) => (contextPath ? `${contextPath}/${rel}` : rel);
  const file = (rel: string, name: string, content: string): PrimitiveFile => ({
    path: rel,
    ...(contextPath ? { fullPath: `${contextPath}/${rel}` } : {}),
    content,
    language: detectLanguage(name),
    layer: 'workspace' as const,
  });

  // Missions, automations + teams live as single flat YAML files.
  if (kind === 'mission' || kind === 'automation' || kind === 'team') {
    const name = `${dirName}.yaml`;
    const rel = `${kindDir(kind)}/${name}`;
    if (!tree.hasFile(rel)) {
      return null;
    }
    const content = tree.read(rel);
    if (content === null) {
      // Refused or unreadable. Showing an empty editor would look like an
      // empty file rather than one we declined to open.
      return null;
    }
    return { files: [file(rel, name, content)], editInGitPath: at(rel) };
  }

  // Agents live as flat files: agents/<slug>.yaml + agents/<slug>.system-prompt.md
  if (kind === 'agent') {
    const files = [`${dirName}.yaml`, `${dirName}.system-prompt.md`]
      .filter(name => tree.hasFile(`agents/${name}`))
      .map((name) => {
        const content = tree.read(`agents/${name}`);
        return content === null ? null : file(`agents/${name}`, name, content);
      })
      .filter(f => f !== null);
    if (files.length === 0) {
      return null;
    }
    return { files, editInGitPath: at(`agents/${dirName}.yaml`) };
  }

  // Everything else lives in a directory with multiple files.
  const dir = `${kindDir(kind)}/${dirName}`;
  if (!tree.hasDir(dir)) {
    return null;
  }
  const files = sortResourceFiles(tree.list(dir)).map((n) => {
    const content = tree.read(`${dir}/${n}`);
    return content === null ? null : file(`${dir}/${n}`, n, content);
  }).filter(f => f !== null);
  if (files.length === 0) {
    return null;
  }
  return { files, editInGitPath: at(dir) };
}

/**
 * The core layer — the base pack's same-slug files, read-only (no `fullPath`).
 * Only the composable kinds can have a base default; the rest never do.
 * @param kind - primitive kind
 * @param slug - primitive slug
 */
function readCoreLayer(kind: PrimitiveKind, slug: string): PrimitiveFile[] {
  // The inherited layer is the base pack or an enabled plugin. Plugins are
  // read first because a plugin may shadow a base slug; the first layer that
  // has the file wins, which is the compose order the loader uses.
  for (const root of pluginRoots()) {
    const files = readLayerFiles(kind, slug, root, `${PLUGINS_REL}/${basename(root)}`);
    if (files.length > 0) {
      return files;
    }
  }
  return readLayerFiles(kind, slug, fromRepoRoot(BASE_PACK_REL), BASE_PACK_REL);
}

/**
 * One inherited layer's same-slug files for a primitive, read-only.
 * @param kind - primitive kind
 * @param slug - primitive slug
 * @param packRoot - absolute layer directory
 * @param relRoot - the layer directory relative to the repo root, for display
 */
function readLayerFiles(kind: PrimitiveKind, slug: string, packRoot: string, relRoot: string): PrimitiveFile[] {
  const dirName = slugToDirname(slug);
  if (!existsSync(packRoot)) {
    return [];
  }

  const toFile = (absDir: string, rel: string, name: string): PrimitiveFile | null => {
    const content = readContainedFile(absDir, join(absDir, name));
    return content === null
      ? null
      : {
          path: `${relRoot}/${rel}`,
          content,
          language: detectLanguage(name),
          layer: 'core' as const,
        };
  };

  if (kind === 'agent') {
    const agentDir = join(packRoot, 'agents');
    return [`${dirName}.yaml`, `${dirName}.system-prompt.md`]
      .filter(name => existsSync(join(agentDir, name)))
      .map(name => toFile(agentDir, `agents/${name}`, name))
      .filter(file => file !== null);
  }
  if (kind === 'mission') {
    const name = `${dirName}.yaml`;
    if (!existsSync(join(packRoot, 'missions', name))) {
      return [];
    }
    const file = toFile(join(packRoot, 'missions'), `missions/${name}`, name);
    return file === null ? [] : [file];
  }
  // Skills are SKILL.md folders under skills/ in the base pack; objects under objects/.
  const containerDir = kind === 'skill' ? 'skills' : kind === 'object' ? 'objects' : null;
  if (!containerDir) {
    return [];
  }
  const dir = join(packRoot, containerDir, dirName);
  if (!existsSync(dir)) {
    return [];
  }
  return readDirFiles(dir).map(n => toFile(dir, `${containerDir}/${dirName}/${n}`, n)).filter(file => file !== null);
}

/**
 * List a directory's resource files (yaml first, then md/js), sorted.
 * @param dir
 */
function readDirFiles(dir: string): string[] {
  return sortResourceFiles(readdirSync(dir));
}

/**
 * The resource files among a folder's names (yaml first, then md/js), sorted.
 * @param entries - Names directly inside the folder.
 */
function sortResourceFiles(entries: string[]): string[] {
  const names = entries.filter(n => n.endsWith('.yaml') || n.endsWith('.md') || n.endsWith('.js') || n.endsWith('.mjs'));
  names.sort((a, b) => {
    const aIsYaml = a.endsWith('.yaml') ? 0 : 1;
    const bIsYaml = b.endsWith('.yaml') ? 0 : 1;
    if (aIsYaml !== bIsYaml) {
      return aIsYaml - bIsYaml;
    }
    return a.localeCompare(b);
  });
  return names;
}

/**
 * The files behind a primitive, read off the folder on `WORKSPACE_PATH` —
 * for a project whose workspace is not stored yet. A stored project reads
 * through `readPrimitiveFilesForOrg` (`services/workspace/WorkspaceFileService.ts`),
 * which ends in {@link primitiveFilesFrom} too.
 * @param kind - primitive kind
 * @param slug - primitive slug
 */
export function readPrimitiveFiles(kind: PrimitiveKind, slug: string): PrimitiveFilesResult | null {
  const contextPath = getWorkspacePath();
  if (!contextPath) {
    return null;
  }
  const base = fromRepoRoot(contextPath);
  return primitiveFilesFrom(kind, slug, existsSync(base) ? folderTree(base) : null, contextPath);
}

/**
 * The files behind a primitive: the workspace layer read through `tree`, with
 * the inherited core layer under it.
 * @param kind - primitive kind
 * @param slug - primitive slug
 * @param tree - the workspace's files, or null when there are none to read
 * @param contextPath - the folder an edit writes to, or null for read-only files
 */
export function primitiveFilesFrom(kind: PrimitiveKind, slug: string, tree: WorkspaceTree | null, contextPath: string | null): PrimitiveFilesResult | null {
  if (!WORKSPACE_SLUG_PATTERN.test(slug)) {
    // Every read below builds a path out of this slug, and the dashboard
    // drilldown pages hand it straight through from the URL. Refusing here
    // covers both layers at once — nothing downstream ever sees a slug that
    // can climb out of the workspace.
    return null;
  }

  const ws = tree ? readWorkspaceLayer(kind, slug, tree, contextPath) : null;
  const coreFiles = readCoreLayer(kind, slug);
  const files = [...(ws?.files ?? []), ...coreFiles];
  if (files.length === 0) {
    return null;
  }

  // Where a user edits/overrides: the workspace file if one exists, else the
  // conventional workspace path where an `extends: core` override would live.
  const conventional = `${kindDir(kind)}/${slugToDirname(slug)}`;
  const editInGitPath = ws?.editInGitPath ?? (contextPath ? `${contextPath}/${conventional}` : conventional);
  return { files, contextPath: contextPath ?? '', editInGitPath };
}

/**
 * The folder a primitive kind's files sit under, inside the workspace.
 * @param kind - primitive kind
 */
export function primitiveKindDir(kind: PrimitiveKind): string {
  return kindDir(kind);
}
