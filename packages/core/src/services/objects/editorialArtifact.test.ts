import { beforeEach, describe, expect, it, vi } from 'vitest';

const getArtifact = vi.hoisted(() => vi.fn());
vi.mock('@/services/ArtifactService', () => ({ getArtifact, toPayload: (row: unknown) => row }));
const { editorialArtifact } = await import('./editorialArtifact');

beforeEach(() => getArtifact.mockReset());

describe('editorial document audience', () => {
  it('reads only the URL workspace and never falls back to another workspace', async () => {
    getArtifact.mockResolvedValue(null);

    expect(await editorialArtifact('workspace-a', 'member-of-both', 42)).toBeNull();
    expect(getArtifact).toHaveBeenCalledExactlyOnceWith({ orgId: 'workspace-a', id: 42 });
  });

  it('does not expose a private draft to another workspace member', async () => {
    getArtifact.mockResolvedValue({ id: 42, title: 'Private draft', shareAudience: 'me', shareOwnerId: 'owner' });

    expect(await editorialArtifact('workspace-a', 'other-member', 42)).toBeNull();
  });

  it('opens the owner’s draft and rejects invalid document references before fetching', async () => {
    const row = { id: 42, title: 'Draft', shareAudience: 'me', shareOwnerId: 'owner' };
    getArtifact.mockResolvedValue(row);

    expect(await editorialArtifact('workspace-a', 'owner', 42)).toEqual(row);

    getArtifact.mockClear();

    expect(await editorialArtifact('workspace-a', 'owner', -1)).toBeNull();
    expect(getArtifact).not.toHaveBeenCalled();
  });
});
