/**
 * A workspace as one file, both ways: the zip an export downloads, and the zip
 * an import reads — which a stranger may have made, so the limits and the
 * paths are checked before anything is inflated or written.
 */
import { Buffer } from 'node:buffer';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ARCHIVE_LIMITS, readWorkspaceArchive, WorkspaceArchiveError, zipWorkspace } from './archive';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function zip(entries: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? Buffer.from(v) : v])));
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof WorkspaceArchiveError ? error.code : `not an archive error: ${String(error)}`;
  }
}

describe('zipWorkspace → readWorkspaceArchive', () => {
  it('round-trips text and binary files under one folder', () => {
    const files = [
      { path: 'workspace.yaml', content: 'version: 1\norgId: proj_northwind\nname: Northwind\n', encoding: 'utf8' as const },
      { path: 'skills/write-brief/SKILL.md', content: '---\nslug: write-brief\n---\nPull {{env.NORTHWIND_API_URL}}.\n', encoding: 'utf8' as const },
      { path: 'brand/mark.png', content: PNG.toString('base64'), encoding: 'base64' as const },
    ];
    const bytes = zipWorkspace(files, 'northwind-workspace');

    expect(readWorkspaceArchive(bytes)).toEqual([...files].sort((a, b) => a.path.localeCompare(b.path)));
  });
});

describe('readWorkspaceArchive', () => {
  it('finds the workspace at the top of the zip or inside one folder, and drops what sits outside it', () => {
    expect(readWorkspaceArchive(zip({ 'workspace.yaml': 'version: 1', 'agents/a.yaml': 'slug: a' })).map(f => f.path)).toEqual(['agents/a.yaml', 'workspace.yaml']);
    expect(readWorkspaceArchive(zip({ 'acme/workspace.yaml': 'version: 1', 'acme/agents/a.yaml': 'slug: a', 'notes.txt': 'beside it' })).map(f => f.path)).toEqual(['agents/a.yaml', 'workspace.yaml']);
  });

  it('takes the shallowest manifest, so a template folder inside the workspace is just files', () => {
    const files = readWorkspaceArchive(zip({ 'ws/workspace.yaml': 'version: 1', 'ws/examples/other/workspace.yaml': 'version: 1' }));

    expect(files.map(f => f.path)).toEqual(['examples/other/workspace.yaml', 'workspace.yaml']);
  });

  it('skips dotted names and the folder macOS adds, as the loader would', () => {
    const files = readWorkspaceArchive(zip({ 'workspace.yaml': 'version: 1', '.git/config': 'x', 'agents/.DS_Store': 'x', '__MACOSX/workspace.yaml': 'x' }));

    expect(files.map(f => f.path)).toEqual(['workspace.yaml']);
  });

  it('refuses an upload with no manifest, or with two workspaces side by side', () => {
    expect(code(() => readWorkspaceArchive(zip({ 'agents/a.yaml': 'slug: a' })))).toBe('NO_MANIFEST');
    expect(code(() => readWorkspaceArchive(zip({ 'a/workspace.yaml': 'version: 1', 'b/workspace.yaml': 'version: 1' })))).toBe('NO_MANIFEST');
  });

  it('refuses a path that climbs out of the workspace or is absolute, before writing anything', () => {
    expect(code(() => readWorkspaceArchive(zip({ 'workspace.yaml': 'version: 1', '../outside.yaml': 'x' })))).toBe('BAD_PATH');
    expect(code(() => readWorkspaceArchive(zip({ 'workspace.yaml': 'version: 1', 'agents/../../outside.yaml': 'x' })))).toBe('BAD_PATH');
    expect(code(() => readWorkspaceArchive(zip({ 'workspace.yaml': 'version: 1', '/etc/passwd': 'x' })))).toBe('BAD_PATH');
  });

  it('refuses what is not a zip', () => {
    expect(code(() => readWorkspaceArchive(Buffer.from('version: 1\n')))).toBe('NOT_A_ZIP');
  });

  it('holds every limit: the upload, the files in it, one file, and all of them inflated', () => {
    const small = { ...ARCHIVE_LIMITS, maxArchiveBytes: 10_000, maxFiles: 3, maxFileBytes: 100, maxTotalBytes: 150 };

    expect(code(() => readWorkspaceArchive(new Uint8Array(10_001), small))).toBe('TOO_LARGE');
    expect(code(() => readWorkspaceArchive(zip({ 'workspace.yaml': 'v', 'a.md': 'a', 'b.md': 'b', 'c.md': 'c' }), small))).toBe('TOO_LARGE');
    // Compresses to almost nothing, unpacks past the per-file limit.
    expect(code(() => readWorkspaceArchive(zip({ 'workspace.yaml': 'v', 'big.md': 'x'.repeat(101) }), small))).toBe('TOO_LARGE');
    expect(code(() => readWorkspaceArchive(zip({ 'workspace.yaml': 'v', 'a.md': 'x'.repeat(80), 'b.md': 'x'.repeat(80) }), small))).toBe('TOO_LARGE');
    expect(readWorkspaceArchive(zip({ 'workspace.yaml': 'v', 'a.md': 'x'.repeat(80) }), small)).toHaveLength(2);
  });
});
