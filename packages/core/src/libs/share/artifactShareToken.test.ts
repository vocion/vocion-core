import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactSharePath, signArtifactShare, signShareMedia, verifyArtifactShare, verifyShareMedia } from './artifactShareToken';

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
    // A dot sends the path past the proxy's locale rewrite, to a bare 404.
    expect(token).not.toContain('.');
  });

  it('still reads a token minted with the old dot separator', () => {
    const token = signArtifactShare({ artifactId: 227, orgId: 'proj-1' });

    expect(verifyArtifactShare(token.replace('~', '.'))).toEqual({ artifactId: 227, orgId: 'proj-1', v: 1 });
  });

  it('binds a media signature to one link and one file', () => {
    const sig = signShareMedia({ shareId: 5, artifactId: 9 });

    expect(verifyShareMedia(sig, { shareId: 5, artifactId: 9 })).toBe(true);
    expect(verifyShareMedia(sig, { shareId: 5, artifactId: 10 })).toBe(false);
    expect(verifyShareMedia(sig, { shareId: 6, artifactId: 9 })).toBe(false);
    expect(verifyShareMedia('AAAA', { shareId: 5, artifactId: 9 })).toBe(false);
  });

  it('refuses a tampered body, a wrong signature, junk, and a token from another secret', () => {
    const token = signArtifactShare({ artifactId: 227, orgId: 'proj-1' });
    const [body, sig] = token.split('~') as [string, string];
    const other = signArtifactShare({ artifactId: 228, orgId: 'proj-1' }).split('~')[0]!;

    expect(verifyArtifactShare(`${other}~${sig}`)).toBeNull();
    expect(verifyArtifactShare(`${body}~AAAA`)).toBeNull();
    expect(verifyArtifactShare('nonsense')).toBeNull();

    process.env.AUTH_SECRET = 'rotated';

    expect(verifyArtifactShare(token)).toBeNull();
  });
});
