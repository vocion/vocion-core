import { describe, expect, it } from 'vitest';
import { composePullText, parsePullUrl } from './githubPullRead';

describe('a pull request URL', () => {
  it('is read in every spelling a reviewer uses, and nothing else is', () => {
    expect(parsePullUrl('https://github.com/Acme/northwind-core/pull/35')).toEqual({ owner: 'Acme', repo: 'northwind-core', number: 35 });
    expect(parsePullUrl('https://github.com/Acme/northwind-core/pull/35.diff')?.number).toBe(35);
    expect(parsePullUrl('https://github.com/Acme/northwind-core/pull/35/files')?.number).toBe(35);
    expect(parsePullUrl('https://github.com/Acme/northwind-core/issues/35')).toBeNull();
    expect(parsePullUrl('https://example.test/pull/35')).toBeNull();
  });
});

describe('composePullText', () => {
  it('keeps the whole read under the runtime\'s eviction line: the body whole, the diff in what room is left', () => {
    const body = `## Evidence\n${'- **shot** (desktop, after): https://agents.example/dashboard/artifacts/1\n'.repeat(250)}`;
    const text = composePullText('https://github.com/acme/app/pull/9', 9, { title: 't', body }, 'd'.repeat(90_000));

    expect(text.length).toBeLessThan(80_000);
    expect(text).toContain(body);
    expect(text).toMatch(/Diff truncated at \d+ of 90000 characters, to keep this read whole/);
  });
});
