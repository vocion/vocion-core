import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';

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
 * The workspace layer — the tenant's own files for this kind/slug, exactly as
 * before ticket 007 but tagged `layer: 'workspace'`.
 * @param kind - primitive kind
 * @param slug - primitive slug
 * @param contextPath - the workspace path (WORKSPACE_PATH)
 */
function readWorkspaceLayer(kind: PrimitiveKind, slug: string, contextPath: string): WorkspaceLayer | null {
  const dirName = slugToDirname(slug);
  const base = fromRepoRoot(contextPath);
  if (!existsSync(base)) {
    return null;
  }

  // Missions, automations + teams live as single flat YAML files.
  if (kind === 'mission' || kind === 'automation' || kind === 'team') {
    const dir = join(base, kindDir(kind));
    const name = `${dirName}.yaml`;
    if (!existsSync(join(dir, name))) {
      return null;
    }
    const rel = `${kindDir(kind)}/${name}`;
    return {
      files: [{
        path: rel,
        fullPath: `${contextPath}/${rel}`,
        content: readFileSync(join(dir, name), 'utf-8'),
        language: 'yaml' as const,
        layer: 'workspace' as const,
      }],
      editInGitPath: `${contextPath}/${rel}`,
    };
  }

  // Agents live as flat files: agents/<slug>.yaml + agents/<slug>.system-prompt.md
  if (kind === 'agent') {
    const agentDir = join(base, 'agents');
    const candidates = [`${dirName}.yaml`, `${dirName}.system-prompt.md`];
    const files = candidates
      .filter(name => existsSync(join(agentDir, name)))
      .map(name => ({
        path: `agents/${name}`,
        fullPath: `${contextPath}/agents/${name}`,
        content: readFileSync(join(agentDir, name), 'utf-8'),
        language: detectLanguage(name),
        layer: 'workspace' as const,
      }));
    if (files.length === 0) {
      return null;
    }
    return { files, editInGitPath: `${contextPath}/agents/${dirName}.yaml` };
  }

  // Everything else lives in a directory with multiple files.
  const dirsToTry = [kindDir(kind)];
  const foundDirName = dirsToTry.find(d => existsSync(join(base, d, dirName)));
  if (!foundDirName) {
    return null;
  }
  const dir = join(base, foundDirName, dirName);
  const files = readDirFiles(dir).map(n => ({
    path: `${foundDirName}/${dirName}/${n}`,
    fullPath: `${contextPath}/${foundDirName}/${dirName}/${n}`,
    content: readFileSync(join(dir, n), 'utf-8'),
    language: detectLanguage(n),
    layer: 'workspace' as const,
  }));
  if (files.length === 0) {
    return null;
  }
  return { files, editInGitPath: `${contextPath}/${foundDirName}/${dirName}` };
}

/**
 * The core layer — the base pack's same-slug files, read-only (no `fullPath`).
 * Only the composable kinds can have a base default; the rest never do.
 * @param kind - primitive kind
 * @param slug - primitive slug
 */
function readCoreLayer(kind: PrimitiveKind, slug: string): PrimitiveFile[] {
  const dirName = slugToDirname(slug);
  const packRoot = fromRepoRoot(BASE_PACK_REL);
  if (!existsSync(packRoot)) {
    return [];
  }

  const toFile = (absDir: string, rel: string, name: string): PrimitiveFile => ({
    path: `${BASE_PACK_REL}/${rel}`,
    content: readFileSync(join(absDir, name), 'utf-8'),
    language: detectLanguage(name),
    layer: 'core' as const,
  });

  if (kind === 'agent') {
    const agentDir = join(packRoot, 'agents');
    return [`${dirName}.yaml`, `${dirName}.system-prompt.md`]
      .filter(name => existsSync(join(agentDir, name)))
      .map(name => toFile(agentDir, `agents/${name}`, name));
  }
  if (kind === 'mission') {
    const name = `${dirName}.yaml`;
    return existsSync(join(packRoot, 'missions', name))
      ? [toFile(join(packRoot, 'missions'), `missions/${name}`, name)]
      : [];
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
  return readDirFiles(dir).map(n => toFile(dir, `${containerDir}/${dirName}/${n}`, n));
}

/**
 * List a directory's resource files (yaml first, then md/js), sorted.
 * @param dir
 */
function readDirFiles(dir: string): string[] {
  const names = readdirSync(dir).filter(n => n.endsWith('.yaml') || n.endsWith('.md') || n.endsWith('.js') || n.endsWith('.mjs'));
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

export function readPrimitiveFiles(kind: PrimitiveKind, slug: string): PrimitiveFilesResult | null {
  const contextPath = getWorkspacePath();
  if (!contextPath) {
    return null;
  }

  const ws = readWorkspaceLayer(kind, slug, contextPath);
  const coreFiles = readCoreLayer(kind, slug);
  const files = [...(ws?.files ?? []), ...coreFiles];
  if (files.length === 0) {
    return null;
  }

  // Where a user edits/overrides: the workspace file if one exists, else the
  // conventional workspace path where an `extends: core` override would live.
  const editInGitPath = ws?.editInGitPath ?? `${contextPath}/${kindDir(kind)}/${slugToDirname(slug)}`;
  return { files, contextPath, editInGitPath };
}
