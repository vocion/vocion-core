import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fromRepoRoot } from '@/libs/repo-root';

/**
 * Read the files that back a primitive instance from the tenant context
 * directory. Used by the `/dashboard/<primitive>/<slug>` drilldown pages
 * and the oRPC `context.readPrimitive` route.
 *
 * Returns whatever files exist for the kind/slug — one or many. Callers
 * don't need to know whether a skill is `skill.yaml` + `prompt.md` or a
 * workflow is a single `workflow.yaml`.
 */

export type PrimitiveKind = 'skill' | 'workflow' | 'object' | 'agent' | 'source' | 'mission' | 'automation';

export type PrimitiveFile = {
  /** Path relative to the context dir, e.g. `skills/discovery-summary/prompt.md` */
  path: string;
  /** Full repo-relative path used by the writeFile oRPC route, e.g. `workspace/metacto/skills/discovery-summary/prompt.md` */
  fullPath: string;
  content: string;
  language: 'yaml' | 'markdown' | 'javascript';
};

export type PrimitiveFilesResult = {
  files: PrimitiveFile[];
  contextPath: string;
  editInGitPath: string;
};

export function getWorkspacePath(): string {
  return process.env.WORKSPACE_PATH ?? 'workspace/metacto';
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

export function readPrimitiveFiles(kind: PrimitiveKind, slug: string): PrimitiveFilesResult | null {
  const dirName = slugToDirname(slug);
  const contextPath = getWorkspacePath();
  const base = fromRepoRoot(contextPath);

  if (!existsSync(base)) {
    return null;
  }

  // Missions + automations live as single flat YAML files.
  if (kind === 'mission' || kind === 'automation') {
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
      }],
      contextPath,
      editInGitPath: `${contextPath}/${rel}`,
    };
  }

  // Agents live as flat files: agents/<slug>.yaml + agents/<slug>.system-prompt.md
  if (kind === 'agent') {
    const agentDir = join(base, 'agents');
    const candidates = [
      `${dirName}.yaml`,
      `${dirName}.system-prompt.md`,
    ];
    const files = candidates
      .filter(name => existsSync(join(agentDir, name)))
      .map(name => ({
        path: `agents/${name}`,
        fullPath: `${contextPath}/agents/${name}`,
        content: readFileSync(join(agentDir, name), 'utf-8'),
        language: detectLanguage(name),
      }));
    if (files.length === 0) {
      return null;
    }
    return { files, contextPath, editInGitPath: `${contextPath}/agents/${dirName}.yaml` };
  }

  // Everything else lives in a directory with multiple files.
  // Skills were renamed to operations/ in v0.2 workspaces — try both.
  const dirsToTry = kind === 'skill' ? [kindDir(kind), 'operations'] : [kindDir(kind)];
  const foundDirName = dirsToTry.find(d => existsSync(join(base, d, dirName)));
  if (!foundDirName) {
    return null;
  }
  const dir = join(base, foundDirName, dirName);

  const fileNames = readdirSync(dir).filter(n => n.endsWith('.yaml') || n.endsWith('.md') || n.endsWith('.js') || n.endsWith('.mjs'));
  if (fileNames.length === 0) {
    return null;
  }

  fileNames.sort((a, b) => {
    const aIsYaml = a.endsWith('.yaml') ? 0 : 1;
    const bIsYaml = b.endsWith('.yaml') ? 0 : 1;
    if (aIsYaml !== bIsYaml) {
      return aIsYaml - bIsYaml;
    }
    return a.localeCompare(b);
  });

  const files = fileNames.map(n => ({
    path: `${foundDirName}/${dirName}/${n}`,
    fullPath: `${contextPath}/${foundDirName}/${dirName}/${n}`,
    content: readFileSync(join(dir, n), 'utf-8'),
    language: detectLanguage(n),
  }));

  return { files, contextPath, editInGitPath: `${contextPath}/${foundDirName}/${dirName}` };
}
