import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

/**
 * Read the files that back a primitive instance from the tenant context
 * directory. Used by the `/dashboard/<primitive>/<slug>` drilldown pages
 * and the oRPC `context.readPrimitive` route.
 *
 * Returns whatever files exist for the kind/slug — one or many. Callers
 * don't need to know whether a skill is `skill.yaml` + `prompt.md` or a
 * workflow is a single `workflow.yaml`.
 */

export type PrimitiveKind = 'skill' | 'workflow' | 'object' | 'agent' | 'source';

export type PrimitiveFile = {
  path: string;
  content: string;
  language: 'yaml' | 'markdown';
};

export type PrimitiveFilesResult = {
  files: PrimitiveFile[];
  contextPath: string;
  editInGitPath: string;
};

export function getContextPath(): string {
  return process.env.CONTEXT_PATH ?? 'context/metacto';
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
  }
}

function detectLanguage(fileName: string): 'yaml' | 'markdown' {
  return fileName.endsWith('.md') ? 'markdown' : 'yaml';
}

export function readPrimitiveFiles(kind: PrimitiveKind, slug: string): PrimitiveFilesResult | null {
  const dirName = slugToDirname(slug);
  const contextPath = getContextPath();
  const base = resolve(process.cwd(), contextPath);

  if (!existsSync(base)) {
    return null;
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
        content: readFileSync(join(agentDir, name), 'utf-8'),
        language: detectLanguage(name),
      }));
    if (files.length === 0) {
      return null;
    }
    return { files, contextPath, editInGitPath: `${contextPath}/agents/${dirName}.yaml` };
  }

  // Everything else lives in a directory with multiple files
  const dir = join(base, kindDir(kind), dirName);
  if (!existsSync(dir)) {
    return null;
  }

  const fileNames = readdirSync(dir).filter(n => n.endsWith('.yaml') || n.endsWith('.md'));
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
    path: `${kindDir(kind)}/${dirName}/${n}`,
    content: readFileSync(join(dir, n), 'utf-8'),
    language: detectLanguage(n),
  }));

  return { files, contextPath, editInGitPath: `${contextPath}/${kindDir(kind)}/${dirName}` };
}
