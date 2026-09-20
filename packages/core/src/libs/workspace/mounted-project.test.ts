import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyNewerThanFolder, folderChangedAt, isDeployManaged, judgeMountedFolder, readManifestOrgId } from './mounted-project';

// A deployment hosts several projects on one mounted folder. Before the
// drift banner, its Apply button or the sidebar treats that folder as "this
// project's workspace", this is the question they ask — answered from what
// the applier recorded, never guessed.

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function folder(manifest: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'mounted-'));
  dirs.push(dir);
  if (manifest !== null) {
    writeFileSync(join(dir, 'workspace.yaml'), manifest);
  }
  return dir;
}

const applied = (over: Partial<{ sha: string; sourcePath: string | null; projectId: string | null; appliedBy: string | null }>) =>
  ({ sha: 'abc', sourcePath: null, projectId: null, appliedAt: new Date('2026-09-20T10:00:00Z'), appliedBy: 'cli', ...over });

describe('judgeMountedFolder', () => {
  it('a folder the map names for the project is the project\'s, whatever was recorded', () => {
    expect(judgeMountedFolder({ projectId: 'p1', folder: { path: '/ws/a', manifestOrgId: 'other', explicit: true }, applied: applied({ sourcePath: '/ws/b' }) })).toEqual({ own: true });
  });

  it('a recorded project that is not this one settles it', () => {
    const v = judgeMountedFolder({ projectId: 'p1', folder: { path: '/ws/a', manifestOrgId: 'p1' }, applied: applied({ projectId: 'p2', sourcePath: '/ws/a' }) });

    expect(v.own).toBe(false);
    expect(!v.own && v.reason).toContain('p2');
  });

  it('the recorded source folder decides: same folder is ours, another is not', () => {
    const dir = folder('version: 1\norgId: placeholder\nname: A\n');

    expect(judgeMountedFolder({ projectId: 'p1', folder: { path: dir, manifestOrgId: 'placeholder' }, applied: applied({ sourcePath: dir }) })).toEqual({ own: true });
    // Same folder, another spelling — trailing slash, unresolved segments.
    expect(judgeMountedFolder({ projectId: 'p1', folder: { path: `${dir}/`, manifestOrgId: 'placeholder' }, applied: applied({ sourcePath: join(dir, '.', 'x', '..') }) })).toEqual({ own: true });

    const v = judgeMountedFolder({ projectId: 'p1', folder: { path: dir, manifestOrgId: 'p1' }, applied: applied({ sourcePath: '/somewhere/else' }) });

    expect(v.own).toBe(false);
    expect(!v.own && v.reason).toContain('/somewhere/else');
  });

  it('with nothing recorded, only a manifest orgId that IS this project counts', () => {
    expect(judgeMountedFolder({ projectId: 'p1', folder: { path: '/ws/a', manifestOrgId: 'p1' }, applied: null })).toEqual({ own: true });
    expect(judgeMountedFolder({ projectId: 'p1', folder: { path: '/ws/a', manifestOrgId: 'p1' }, applied: applied({ sourcePath: null }) })).toEqual({ own: true });

    // A placeholder orgId is not a match, and "not a match" is the answer.
    const v = judgeMountedFolder({ projectId: 'p1', folder: { path: '/ws/a', manifestOrgId: 'proj_placeholder' }, applied: null });

    expect(v.own).toBe(false);
    expect(!v.own && v.reason).toContain('proj_placeholder');
    expect(judgeMountedFolder({ projectId: 'p1', folder: { path: '/ws/a', manifestOrgId: null }, applied: null }).own).toBe(false);
  });
});

describe('readManifestOrgId', () => {
  it('reads orgId, and is null for a missing or broken manifest', () => {
    expect(readManifestOrgId(folder('version: 1\norgId: proj_x\nname: X\n'))).toBe('proj_x');
    expect(readManifestOrgId(folder(null))).toBeNull();
    expect(readManifestOrgId(folder('version: [1\n'))).toBeNull();
    expect(readManifestOrgId(folder('version: 1\nname: X\n'))).toBeNull();
  });
});

describe('isDeployManaged', () => {
  it('a read-only folder or a pipeline\'s signature means git applies this project', () => {
    expect(isDeployManaged({ writable: false, appliedBy: 'cli' })).toBe(true);
    expect(isDeployManaged({ writable: true, appliedBy: 'deploy' })).toBe(true);
    expect(isDeployManaged({ writable: true, appliedBy: 'github-actions:main' })).toBe(true);
    expect(isDeployManaged({ writable: true, appliedBy: 'ci' })).toBe(true);
    expect(isDeployManaged({ writable: true, appliedBy: 'ui-drift-banner' })).toBe(false);
    expect(isDeployManaged({ writable: true, appliedBy: 'user:usr_1' })).toBe(false);
    expect(isDeployManaged({ writable: true, appliedBy: null })).toBe(false);
  });
});

describe('a deploy in flight', () => {
  it('is an applied version newer than the folder; an undated folder is never in flight', () => {
    const at = new Date('2026-09-20T10:00:00Z');

    expect(applyNewerThanFolder(at, new Date('2026-09-20T09:00:00Z'))).toBe(true);
    expect(applyNewerThanFolder(at, new Date('2026-09-20T11:00:00Z'))).toBe(false);
    expect(applyNewerThanFolder(at, null)).toBe(false);
  });

  it('dates a plain folder by its manifest, and refuses to date a dirty tree', () => {
    const dir = folder('version: 1\norgId: p\nname: P\n');
    const dated = folderChangedAt(dir, 'abc123');

    expect(dated).toBeInstanceOf(Date);
    expect(Math.abs(dated!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(folderChangedAt(dir, 'abc123-dirty-deadbeef')).toBeNull();
    expect(folderChangedAt(folder(null), 'abc123')).toBeNull();
  });
});
