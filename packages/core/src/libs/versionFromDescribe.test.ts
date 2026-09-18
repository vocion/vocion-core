import { describe, expect, it } from 'vitest';
import { versionFromDescribe } from '../../scripts/versionFromDescribe.mjs';

describe('versionFromDescribe', () => {
  it('a build on a release commit IS that release', () => {
    expect(versionFromDescribe('v2.109.2-0-g04ac54ea', '0.1.0')).toEqual({ version: '2.109.2', tag: 'v2.109.2', ahead: 0 });
    expect(versionFromDescribe('v2.109.2', '0.1.0')).toEqual({ version: '2.109.2', tag: 'v2.109.2', ahead: 0 });
  });

  it('a hotfix past a release says how far past, and never claims the release', () => {
    expect(versionFromDescribe('v2.109.1-2-gf4b693e3', '0.1.0')).toEqual({ version: '2.109.1+2', tag: 'v2.109.1', ahead: 2 });
  });

  it('falls back to the package version only when there is no tag to read', () => {
    expect(versionFromDescribe(null, '0.1.0')).toEqual({ version: '0.1.0', tag: null, ahead: 0 });
    expect(versionFromDescribe('  ', '0.1.0').version).toBe('0.1.0');
  });
});
