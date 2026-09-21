import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactSharePath, signArtifactShare, verifyArtifactShare } from './artifactShareToken';

const prev = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret';
});

afterEach(() => {
  process.env.AUTH_SECRET = prev;
});

describe('artifact share token', () => {
  it('round-trips the artifact and its workspace', () => {
    const token = signArtifactShare({ artifactId: 227, orgId: 'proj-1' });

    expect(verifyArtifactShare(token)).toEqual({ artifactId: 227, orgId: 'proj-1', v: 1 });
    expect(artifactSharePath(token)).toBe(`/share/a/${token}`);
    expect(token).not.toMatch(/[+/=]/);
  });

  it('refuses a tampered body, a wrong signature, junk, and a token from another secret', () => {
    const token = signArtifactShare({ artifactId: 227, orgId: 'proj-1' });
    const [body, sig] = token.split('.') as [string, string];
    const other = signArtifactShare({ artifactId: 228, orgId: 'proj-1' }).split('.')[0]!;

    expect(verifyArtifactShare(`${other}.${sig}`)).toBeNull();
    expect(verifyArtifactShare(`${body}.AAAA`)).toBeNull();
    expect(verifyArtifactShare('nonsense')).toBeNull();

    process.env.AUTH_SECRET = 'rotated';

    expect(verifyArtifactShare(token)).toBeNull();
  });
});
