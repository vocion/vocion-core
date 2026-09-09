/**
 * Tests for `scripts/check-config-integrity.mjs`, the malware guard CI runs
 * first.
 *
 * Nothing covered it until now, and it ended with an `ENOENT` stack trace
 * instead of a verdict whenever a dangling symlink sat anywhere in the tree —
 * which is what a developer's gitignored `.env.local` pointing at another
 * checkout looks like. These cases pin that behaviour, and the payload case
 * proves the tolerance did not blind the guard.
 *
 * The script is driven as a child process, the way CI invokes it, rather than
 * imported: it takes the directory to scan as its one optional argument, so a
 * throwaway tree can stand in for the repository.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { fromRepoRoot } from '../libs/repo-root';

const SCRIPT_PATH = fromRepoRoot('scripts/check-config-integrity.mjs');

/** A throwaway directory to scan; the caller removes it. */
function buildTree(): string {
  return mkdtempSync(join(tmpdir(), 'vocion-integrity-'));
}

/**
 * Run the guard over one directory and return what a caller would see.
 * @param root - Directory to scan.
 */
function runGuardOver(root: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, root], { encoding: 'utf8' });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

describe('check-config-integrity', () => {
  it('passes over a clean tree', () => {
    const root = buildTree();
    try {
      writeFileSync(join(root, 'postcss.config.mjs'), 'export default {};\n');

      const { status, output } = runGuardOver(root);

      expect(status).toBe(0);
      expect(output).toContain('Config integrity check passed.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still catches a payload hidden past trailing whitespace', () => {
    const root = buildTree();
    try {
      // The June 2026 incident's shape: a long line in a build config.
      writeFileSync(
        join(root, 'postcss.config.mjs'),
        `export default config;${' '.repeat(20_000)}/* payload */\n`,
      );

      const { status, output } = runGuardOver(root);

      expect(status).toBe(1);
      expect(output).toContain('Config integrity check FAILED');
      expect(output).toContain('postcss.config.mjs:1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('notes a dangling symlink and keeps going', () => {
    const root = buildTree();
    try {
      symlinkSync(join(root, 'nothing-here'), join(root, '.env.local'));
      writeFileSync(join(root, 'kept.config.mjs'), 'export default {};\n');

      const { status, output } = runGuardOver(root);

      // Previously an ENOENT stack trace and no verdict at all.
      expect(status).toBe(0);
      expect(output).toContain('skipped .env.local');
      expect(output).toContain('not an error');
      expect(output).toContain('Config integrity check passed.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('still scans a file reached through a live symlink', () => {
    const root = buildTree();
    try {
      mkdirSync(join(root, 'real'));
      writeFileSync(
        join(root, 'real', 'vite.config.mjs'),
        `export default config;${' '.repeat(20_000)}/* payload */\n`,
      );
      symlinkSync(join(root, 'real'), join(root, 'linked'));

      const { status, output } = runGuardOver(root);

      // Regression guard: tolerating a broken link must not skip live ones.
      expect(status).toBe(1);
      expect(output).toContain('linked/vite.config.mjs:1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on a path it cannot read for any reason other than a missing target', () => {
    const root = buildTree();
    try {
      // A symlink loop answers ELOOP, not ENOENT. A path the guard cannot
      // inspect is the opposite of a reason to pass.
      symlinkSync(join(root, 'loop-b'), join(root, 'loop-a'));
      symlinkSync(join(root, 'loop-a'), join(root, 'loop-b'));

      const { status, output } = runGuardOver(root);

      expect(status).toBe(1);
      expect(output).toContain('ELOOP');
      expect(output).toContain('cannot vouch for a file it cannot stat');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves the directories it is told to skip alone', () => {
    const root = buildTree();
    try {
      mkdirSync(join(root, 'node_modules'));
      writeFileSync(
        join(root, 'node_modules', 'next.config.mjs'),
        `export default config;${' '.repeat(20_000)}/* payload */\n`,
      );

      const { status } = runGuardOver(root);

      expect(status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes over this repository, which is what CI runs', () => {
    const { status, output } = runGuardOver(fromRepoRoot('.'));

    expect(status).toBe(0);
    expect(output).toContain('Config integrity check passed.');
  });
});
