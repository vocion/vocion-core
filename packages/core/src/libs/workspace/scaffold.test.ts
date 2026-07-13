import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { loadWorkspace } from './loader';
import { PRIMITIVE_DIRS, scaffoldWorkspace } from './scaffold';
import { WorkspaceManifestSchema } from './schemas';

function scratchDest(): { parent: string; dest: string } {
  const parent = mkdtempSync(join(tmpdir(), 'cc-scaffold-'));
  return { parent, dest: join(parent, 'acme-revenue') };
}

describe('scaffoldWorkspace', () => {
  it('creates the manifest, README, and every primitive directory', () => {
    const { parent, dest } = scratchDest();
    try {
      scaffoldWorkspace({ name: 'acme-revenue', dest });

      expect(existsSync(join(dest, 'workspace.yaml'))).toBe(true);
      expect(existsSync(join(dest, 'README.md'))).toBe(true);

      for (const dir of PRIMITIVE_DIRS) {
        // .gitkeep so the empty dirs survive a git checkout
        expect(existsSync(join(dest, dir, '.gitkeep'))).toBe(true);
      }
    } finally {
      rmSync(parent, { recursive: true });
    }
  });

  it('writes a manifest that validates against WorkspaceManifestSchema', () => {
    const { parent, dest } = scratchDest();
    try {
      scaffoldWorkspace({ name: 'acme-revenue', dest });

      const raw = parseYaml(readFileSync(join(dest, 'workspace.yaml'), 'utf-8')) as unknown;
      const manifest = WorkspaceManifestSchema.parse(raw);

      expect(manifest.version).toBe(1);
      expect(manifest.name).toBe('acme-revenue');
      // dashes become underscores in the orgId placeholder (DB slug convention)
      expect(manifest.orgId).toBe('proj_acme_revenue');
    } finally {
      rmSync(parent, { recursive: true });
    }
  });

  it('produces a workspace loadWorkspace accepts as-is, with zero resources', () => {
    const { parent, dest } = scratchDest();
    try {
      scaffoldWorkspace({ name: 'acme-revenue', dest });

      const loaded = loadWorkspace(dest);

      expect(loaded.manifest.name).toBe('acme-revenue');
      expect(loaded.agents).toHaveLength(0);
      expect(loaded.skills).toHaveLength(0);
      expect(loaded.workflows).toHaveLength(0);
      expect(loaded.playbooks).toHaveLength(0);
      expect(loaded.sources).toHaveLength(0);
    } finally {
      rmSync(parent, { recursive: true });
    }
  });

  it('refuses to overwrite an existing destination', () => {
    const { parent, dest } = scratchDest();
    try {
      scaffoldWorkspace({ name: 'acme-revenue', dest });
      // second run must not touch the existing workspace
      writeFileSync(join(dest, 'agents', 'keep-me.yaml'), 'slug: keep_me\n');

      expect(() => scaffoldWorkspace({ name: 'acme-revenue', dest }))
        .toThrow(/refusing to overwrite/);
      expect(existsSync(join(dest, 'agents', 'keep-me.yaml'))).toBe(true);
    } finally {
      rmSync(parent, { recursive: true });
    }
  });

  it('rejects names that are not lowercase slug-shaped', () => {
    const { parent, dest } = scratchDest();
    try {
      for (const bad of ['Bad_Name!', 'UPPER', '9starts-with-digit', '-leading-dash', 'has space']) {
        expect(() => scaffoldWorkspace({ name: bad, dest })).toThrow(/invalid name/);
      }

      // nothing was created by the rejected calls
      expect(existsSync(dest)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true });
    }
  });

  it('bakes the applyPath into the README apply instructions', () => {
    const { parent, dest } = scratchDest();
    try {
      scaffoldWorkspace({ name: 'acme-revenue', dest, applyPath: '../workspace/acme-revenue' });

      const readme = readFileSync(join(dest, 'README.md'), 'utf-8');

      expect(readme).toContain('npm run workspace:apply -- ../workspace/acme-revenue --project <id|slug>');
      expect(readme).toContain('WORKSPACE_PATH=../workspace/acme-revenue');
    } finally {
      rmSync(parent, { recursive: true });
    }
  });
});
