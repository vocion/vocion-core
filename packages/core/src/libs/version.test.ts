/**
 * The build stamp exists because "is my fix deployed?" was answered by hand on
 * 2026-09-17 — SSH to the box, read a submodule pin out of a deploy repo — and
 * got the wrong answer twice, which sent two fixes chasing a bug that had
 * already been fixed but not shipped.
 */
import { describe, expect, it } from 'vitest';
import { buildInfo, versionLabel } from './version';

describe('buildInfo', () => {
  it('always returns a complete stamp, so nothing has to null-check it', () => {
    const info = buildInfo();

    for (const key of ['version', 'commit', 'shortCommit', 'subject', 'branch', 'builtAt'] as const) {
      expect(typeof info[key]).toBe('string');
      expect(info[key].length).toBeGreaterThan(0);
    }
  });
});

describe('versionLabel', () => {
  it('reads as a version and a commit', () => {
    expect(versionLabel({ ...buildInfo(), version: '0.1.0', shortCommit: '56ad0e91' })).toBe('v0.1.0 · 56ad0e91');
  });

  it('says "dev build" rather than inventing a version from source', () => {
    // An unbuilt checkout must not claim to be a release. Naming a commit it
    // cannot verify is the failure this whole stamp exists to prevent.
    expect(versionLabel({ ...buildInfo(), version: 'dev' })).toBe('dev build');
  });
});
