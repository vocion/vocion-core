import { describe, expect, it } from 'vitest';
import { canOpenArtifact } from './audience';

const member = { userId: 'u1', isMember: true, hasToken: false };
const other = { userId: 'u2', isMember: true, hasToken: false };
const stranger = { userId: null, isMember: false, hasToken: false };
const linkHolder = { userId: null, isMember: false, hasToken: true };

describe('canOpenArtifact', () => {
  it('workspace: members only — the default every artifact had before sharing existed', () => {
    expect(canOpenArtifact({ audience: 'workspace', ownerId: null }, member)).toBe(true);
    expect(canOpenArtifact({ audience: 'workspace', ownerId: null }, stranger)).toBe(false);
    expect(canOpenArtifact({ audience: 'workspace', ownerId: null }, linkHolder)).toBe(false);
  });

  it('me: the person who chose it, and nobody else in the workspace', () => {
    expect(canOpenArtifact({ audience: 'me', ownerId: 'u1' }, member)).toBe(true);
    expect(canOpenArtifact({ audience: 'me', ownerId: 'u1' }, other)).toBe(false);
    expect(canOpenArtifact({ audience: 'me', ownerId: null }, member)).toBe(false);
  });

  it('anyone: the link opens it; members still do without one', () => {
    expect(canOpenArtifact({ audience: 'anyone', ownerId: null }, linkHolder)).toBe(true);
    expect(canOpenArtifact({ audience: 'anyone', ownerId: null }, member)).toBe(true);
    expect(canOpenArtifact({ audience: 'anyone', ownerId: null }, stranger)).toBe(false);
  });
});
