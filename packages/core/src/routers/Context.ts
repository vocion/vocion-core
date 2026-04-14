import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { fromRepoRoot } from '@/libs/repo-root';
import { guardAuth } from './AuthGuards';

/**
 * Read files that back a primitive instance from the tenant's context
 * directory. Returns whatever files exist for the kind/slug — callers
 * don't need to know whether a skill is one file or two.
 *
 * Scope: read only. Writes go through the existing MCP `context_write_*`
 * tools today; a write-enabled oRPC route lands with the CodeMirror
 * editor in a follow-up.
 */

const PrimitiveKind = z.enum(['skill', 'workflow', 'object', 'agent', 'source']);

const ReadInput = z.object({
  kind: PrimitiveKind,
  slug: z.string().min(1),
});

const FileEntry = z.object({
  path: z.string(),
  content: z.string(),
  language: z.enum(['yaml', 'markdown']),
});

const ReadOutput = z.object({
  files: z.array(FileEntry),
  contextPath: z.string(),
  editInGitPath: z.string(),
});

const CONTEXT_PATH = process.env.CONTEXT_PATH ?? 'context/metacto';

function slugToDirname(slug: string): string {
  return slug.replace(/_/g, '-');
}

function kindDir(kind: z.infer<typeof PrimitiveKind>): string {
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

export const readPrimitive = os
  .input(ReadInput)
  .output(ReadOutput)
  .handler(async ({ input }) => {
    await guardAuth();
    const { kind, slug } = input;
    const dirName = slugToDirname(slug);
    const base = fromRepoRoot(CONTEXT_PATH);

    if (!existsSync(base)) {
      throw new ORPCError('NOT_FOUND', { message: `Context path not found: ${CONTEXT_PATH}` });
    }

    // Agents are single-dir-less (files at context/<org>/agents/<slug>.yaml + <slug>.system-prompt.md)
    if (kind === 'agent') {
      const agentDir = join(base, 'agents');
      const candidates = [
        { name: `${dirName}.yaml`, optional: false },
        { name: `${dirName}.system-prompt.md`, optional: true },
      ];
      const files = candidates
        .filter(c => existsSync(join(agentDir, c.name)))
        .map(c => ({
          path: `agents/${c.name}`,
          content: readFileSync(join(agentDir, c.name), 'utf-8'),
          language: detectLanguage(c.name),
        }));
      if (files.length === 0) {
        throw new ORPCError('NOT_FOUND', { message: `No files found for agent "${slug}"` });
      }
      return { files, contextPath: CONTEXT_PATH, editInGitPath: `${CONTEXT_PATH}/agents/${dirName}.yaml` };
    }

    // Skill/Workflow/Object/Source: directory with multiple files
    const dir = join(base, kindDir(kind), dirName);
    if (!existsSync(dir)) {
      throw new ORPCError('NOT_FOUND', { message: `No directory found for ${kind} "${slug}" at ${kindDir(kind)}/${dirName}` });
    }

    const fileNames = readdirSync(dir).filter(n => n.endsWith('.yaml') || n.endsWith('.md'));
    if (fileNames.length === 0) {
      throw new ORPCError('NOT_FOUND', { message: `No YAML or markdown files in ${dir}` });
    }

    // Sort: .yaml first, then .md, alphabetical within
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

    return { files, contextPath: CONTEXT_PATH, editInGitPath: `${CONTEXT_PATH}/${kindDir(kind)}/${dirName}` };
  });
