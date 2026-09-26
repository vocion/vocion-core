import { describe, expect, it } from 'vitest';
import { parsePullUrl } from './githubPullRead';

describe('a pull request URL', () => {
  it('is read in every spelling a reviewer uses, and nothing else is', () => {
    expect(parsePullUrl('https://github.com/Acme/northwind-core/pull/35')).toEqual({ owner: 'Acme', repo: 'northwind-core', number: 35 });
    expect(parsePullUrl('https://github.com/Acme/northwind-core/pull/35.diff')?.number).toBe(35);
    expect(parsePullUrl('https://github.com/Acme/northwind-core/pull/35/files')?.number).toBe(35);
    expect(parsePullUrl('https://github.com/Acme/northwind-core/issues/35')).toBeNull();
    expect(parsePullUrl('https://example.test/pull/35')).toBeNull();
  });
});
