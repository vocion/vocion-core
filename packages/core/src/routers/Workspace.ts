import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { ORPCError, os } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { fromRepoRoot, getRepoRoot } from '@/libs/repo-root';
import { applyWorkspace, getCurrentWorkspaceSha, getWorkspacePath, invalidateCurrentContextShaCache, loadWorkspace } from '@/libs/workspace';
import { projectSchema } from '@/models/Schema';
import { invalidateChipCache } from '@/services/chat/synthesis';
import { guardAuth, guardRole } from './AuthGuards';

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

function requireWorkspacePath(): string {
  const p = getWorkspacePath();
  if (!p) {
    throw new ORPCError('NOT_FOUND', { message: 'no workspace configured — WORKSPACE_PATH is not set' });
  }
  return p;
}

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
    const workspacePath = requireWorkspacePath();
    const base = fromRepoRoot(workspacePath);

    if (!existsSync(base)) {
      throw new ORPCError('NOT_FOUND', { message: `Context path not found: ${workspacePath}` });
    }

    // Agents are single-dir-less (files at workspace/<org>/agents/<slug>.yaml + <slug>.system-prompt.md)
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
      return { files, contextPath: workspacePath, editInGitPath: `${workspacePath}/agents/${dirName}.yaml` };
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

    return { files, contextPath: workspacePath, editInGitPath: `${workspacePath}/${kindDir(kind)}/${dirName}` };
  });

const WriteInput = z.object({
  path: z.string().min(1).describe('repo-relative path under WORKSPACE_PATH, e.g. workspace/<org>/skills/discovery-summary/prompt.md'),
  content: z.string(),
});

const WriteOutput = z.object({
  path: z.string(),
  bytesWritten: z.number(),
  applied: z.object({
    versionId: z.number().nullable(),
    sha: z.string().nullable(),
  }),
});

const ALLOWED_EXTS = new Set(['.yaml', '.yml', '.md', '.js', '.mjs', '.json']);

export const writeFile = os
  .input(WriteInput)
  .output(WriteOutput)
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    const repoRoot = getRepoRoot();
    const workspacePath = requireWorkspacePath();
    const contextBase = fromRepoRoot(workspacePath);
    const absTarget = fromRepoRoot(input.path);

    // Containment guard: target must be inside the configured WORKSPACE_PATH.
    // Prevents path traversal (../../etc/passwd) and cross-tenant writes.
    const relFromContext = relative(contextBase, absTarget);
    if (relFromContext.startsWith('..') || relFromContext.startsWith('/')) {
      throw new ORPCError('FORBIDDEN', { message: `path escapes WORKSPACE_PATH: ${input.path}` });
    }

    // Extension allowlist — no arbitrary file creation.
    const ext = absTarget.slice(absTarget.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      throw new ORPCError('VALIDATION_FAILED', { message: `extension not allowed: ${ext}. Allowed: ${[...ALLOWED_EXTS].join(', ')}` });
    }

    // Write (mkdir -p first in case the folder is new)
    mkdirSync(dirname(absTarget), { recursive: true });
    writeFileSync(absTarget, input.content, 'utf-8');

    // Apply to DB so the dashboard reflects the change immediately.
    let applied: { versionId: number | null; sha: string | null } = { versionId: null, sha: null };
    try {
      const loaded = loadWorkspace(workspacePath);
      const result = await applyWorkspace(loaded, { orgId });
      applied = { versionId: result.versionId, sha: loaded.sha };
    } catch (err) {
      // Write succeeded; apply failed. Return the write but surface the error.
      throw new ORPCError('APPLY_FAILED', { message: err instanceof Error ? err.message : String(err) });
    }

    return {
      path: relative(repoRoot, absTarget),
      bytesWritten: Buffer.byteLength(input.content, 'utf-8'),
      applied,
    };
  });

/**
 * Resolve the workspace directory for a project. Multi-workspace installs
 * map project slugs to folders via VOCION_WORKSPACE_MAP
 * ("<projectSlug>:<path>,<projectSlug>:<path>"); single-workspace installs
 * fall back to WORKSPACE_PATH. Returns null when the project has no
 * workspace folder on this box (drift check silently skips), or when
 * neither the map nor WORKSPACE_PATH is configured.
 * @param projectId
 */
async function workspacePathForProject(projectId: string): Promise<string | null> {
  const [proj] = await db
    .select({ slug: projectSchema.slug })
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId))
    .limit(1);
  const map = process.env.VOCION_WORKSPACE_MAP ?? '';
  if (proj && map) {
    for (const pair of map.split(',')) {
      const idx = pair.indexOf(':');
      if (idx > 0 && pair.slice(0, idx).trim() === proj.slug) {
        return pair.slice(idx + 1).trim();
      }
    }
    // Map configured but this project isn't in it — no workspace here.
    return null;
  }
  return getWorkspacePath();
}

/**
 * Drift check — compare the workspace FILES' sha against the last APPLIED
 * sha for the caller's active project. Backs the "workspace changed —
 * apply?" banner shown on dashboard load.
 */
export const driftStatus = os.handler(async () => {
  const { orgId, projectId } = await guardAuth();
  const path = await workspacePathForProject(projectId!);
  if (!path || !existsSync(fromRepoRoot(path))) {
    return { available: false as const };
  }
  try {
    const loaded = loadWorkspace(path);
    const appliedSha = await getCurrentWorkspaceSha(orgId!);
    return {
      available: true as const,
      path,
      currentSha: loaded.sha,
      appliedSha,
      drifted: appliedSha !== null && appliedSha !== loaded.sha,
      neverApplied: appliedSha === null,
    };
  } catch {
    // Unparseable workspace — the check is informational, never fatal.
    return { available: false as const };
  }
});

/**
 * Apply the active project's workspace directory to the DB — the button on
 * the drift banner. Admin-gated: an apply rewrites agents/skills/missions
 * for the whole project.
 */
export const applyNow = os.handler(async () => {
  const { orgId, projectId } = await guardRole('org:admin');
  const path = await workspacePathForProject(projectId!);
  if (!path || !existsSync(fromRepoRoot(path))) {
    throw new ORPCError('NOT_FOUND', { message: 'no workspace directory for this project on this host' });
  }
  const loaded = loadWorkspace(path);
  const result = await applyWorkspace(loaded, { orgId: orgId!, appliedBy: 'ui-drift-banner' });
  invalidateCurrentContextShaCache();
  // An apply rewrites the missions/skills chips are synthesized from —
  // regenerate on the next page load instead of waiting out the TTL.
  invalidateChipCache(orgId!);
  return { sha: loaded.sha, counts: result.counts, errors: result.errors };
});
