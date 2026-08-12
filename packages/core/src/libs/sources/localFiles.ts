/**
 * Local files connector — ingest a directory of plain-text / markdown
 * files as documents. Zero auth.
 *
 * Use cases:
 *   - Demos that ship sample data (e.g. support-reply ships 8 ticket
 *     markdown files; the demo's `sources/zendesk.yaml` declares
 *     `kind: local-files` so the data arrives via the same pipeline a
 *     real Zendesk OAuth connector would use).
 *   - One-shot imports of a corpus dump (legal contracts, RFC docs)
 *     before a real upstream is wired.
 *   - Air-gapped deployments where the upstream is a filesystem mount.
 *
 * Config:
 *   - `directory: string` — path to walk, relative to `WORKSPACE_PATH`
 *     (or absolute). Defaults to the configured directory; recursion
 *     is allowed.
 *   - `glob?: string` — filename pattern (default `*.md` + `*.txt`).
 *
 * Frontmatter on `.md` files (YAML at the very top, fenced by `---`)
 * is parsed and merged into the document's `metadata`. The frontmatter
 * `id` field (if present) becomes the `externalId`; otherwise the path
 * relative to `directory` is used.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const localFilesConfigSchema = z.object({
  directory: z.string().min(1).describe('directory to walk, relative to WORKSPACE_PATH or absolute'),
  extensions: z.array(z.string()).default(['.md', '.txt']).describe('file extensions to ingest (default: .md, .txt)'),
});

export const localFilesConnector: SourceConnector<typeof localFilesConfigSchema> = {
  slug: 'local-files',
  name: 'Local files',
  description: 'Ingest a directory of markdown / plain-text files from the filesystem. Useful for demos, fixtures, and one-shot corpus imports.',
  icon: 'FolderOpen',
  authKind: 'none',
  configSchema: localFilesConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = localFilesConfigSchema.parse(ctx.config);
    const baseDir = path.isAbsolute(cfg.directory)
      ? cfg.directory
      : path.resolve(process.env.WORKSPACE_PATH ?? process.cwd(), cfg.directory);

    let baseStat;
    try {
      baseStat = await stat(baseDir);
    } catch (err) {
      ctx.onProgress?.({ kind: 'error', uri: baseDir, message: `directory not accessible: ${(err as Error).message}` });
      return;
    }
    if (!baseStat.isDirectory()) {
      ctx.onProgress?.({ kind: 'error', uri: baseDir, message: 'not a directory' });
      return;
    }

    for await (const filePath of walk(baseDir, cfg.extensions)) {
      const relPath = path.relative(baseDir, filePath);
      try {
        const raw = await readFile(filePath, 'utf8');
        const fileStat = await stat(filePath);
        const { frontmatter, body } = parseFrontmatter(raw);
        if (!body.trim()) {
          ctx.onProgress?.({ kind: 'skipped', uri: relPath, message: 'empty body' });
          continue;
        }
        const externalId = typeof frontmatter?.id === 'string' ? frontmatter.id : relPath;
        const title = (typeof frontmatter?.title === 'string' && frontmatter.title)
          || (typeof frontmatter?.subject === 'string' && frontmatter.subject)
          || path.basename(filePath, path.extname(filePath));
        ctx.onProgress?.({ kind: 'fetched', uri: relPath });
        yield {
          externalId,
          uri: `file://${filePath}`,
          title,
          content: body,
          lastModifiedAt: fileStat.mtime,
          metadata: { ...frontmatter, sourcePath: relPath },
        };
      } catch (err) {
        ctx.onProgress?.({ kind: 'error', uri: relPath, message: (err as Error).message });
      }
    }
  },
};

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

async function* walk(dir: string, extensions: string[]): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, extensions);
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown> | null; body: string } {
  // Match a YAML frontmatter block at the very top, fenced by --- lines.
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: null, body: raw };
  }
  try {
    const parsed = parseYaml(match[1]!);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body: match[2] ?? '' };
    }
  } catch {
    /* malformed YAML — fall through to body-only */
  }
  return { frontmatter: null, body: raw };
}
