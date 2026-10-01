/**
 * The repo family's seam: the provider is chosen from the URL's host or from
 * the source that lists the repository, and the allowed-path test is the one
 * a reviewer holds a diff against.
 */
import { describe, expect, it, vi } from 'vitest';

const tokenForRepo = vi.fn(async (_orgId: string, repo: string) => (repo === 'Acme/northwind-core' ? 'ghs_token' : null));
vi.mock('@/services/agents/tools/githubPullRead', () => ({ tokenForRepo, parsePullUrl: () => null }));
vi.mock('@/services/factory/githubChecks', () => ({ call: vi.fn(), cancelWorkflowRuns: vi.fn(), ghFor: vi.fn(), parseRunUrl: () => null }));

const { allowedPathMatcher, hostOf, pathsInDiff, pathsOutsideAllowed, repoProviderFor } = await import('./provider');

describe('repoProviderFor', () => {
  it('a github.com URL is GitHub\'s, whatever repository it names', async () => {
    const provider = await repoProviderFor('org_1', 'https://github.com/Someone/else/pull/3');

    expect(provider.kind).toBe('github');
    expect(tokenForRepo).not.toHaveBeenCalled();
  });

  it('a bare owner/name is GitHub\'s when an enabled github source lists it, and refused by name when none does', async () => {
    await expect(repoProviderFor('org_1', 'Acme/northwind-core')).resolves.toMatchObject({ kind: 'github' });
    await expect(repoProviderFor('org_1', 'Acme/unlisted')).rejects.toThrow(/not a repository this workspace connected/);
  });

  it('another host is refused by its name, with what it would take', async () => {
    await expect(repoProviderFor('org_1', 'https://bitbucket.org/acme/api/pull-requests/4')).rejects.toThrow(/bitbucket\.org is not a code host this workspace connected.*Bitbucket/);
    expect(hostOf('https://www.github.com/a/b')).toBe('github.com');
    expect(hostOf('Acme/api')).toBeNull();
  });
});

describe('allowed paths', () => {
  it('a plain path covers itself and everything under it; globs stay inside a segment unless doubled', () => {
    expect(allowedPathMatcher('packages/core/src')('packages/core/src/a/b.ts')).toBe(true);
    expect(allowedPathMatcher('packages/core/src')('packages/core/srcfoo/b.ts')).toBe(false);
    expect(allowedPathMatcher('src/*.ts')('src/a.ts')).toBe(true);
    expect(allowedPathMatcher('src/*.ts')('src/a/b.ts')).toBe(false);
    expect(allowedPathMatcher('src/**/*.ts')('src/a/b/c.ts')).toBe(true);
    expect(allowedPathMatcher('src/**/*.ts')('src/c.ts')).toBe(true);
    expect(allowedPathMatcher('docs/**')('docs/x/y.md')).toBe(true);
    expect(allowedPathMatcher('a?.md')('ab.md')).toBe(true);
  });

  it('names the files outside the contract, and nothing when the contract bounded nothing', () => {
    const diff = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@\ndiff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n@@\ndiff --git a/old.txt b/old.txt\n--- a/old.txt\n+++ /dev/null\n';
    const files = pathsInDiff(diff);

    expect(files).toEqual(['src/a.ts', '.github/workflows/ci.yml', 'old.txt']);
    expect(pathsOutsideAllowed(files, ['src/**'])).toEqual(['.github/workflows/ci.yml', 'old.txt']);
    expect(pathsOutsideAllowed(files, [])).toEqual([]);
    expect(pathsOutsideAllowed(files, null)).toEqual([]);
  });
});
