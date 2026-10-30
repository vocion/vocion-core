import { canOpenArtifact } from '@/libs/share/audience';
import { getArtifact, toPayload } from '@/services/ArtifactService';

/**
 * Read an editorial document only within its workspace and declared audience.
 * @param orgId
 * @param userId
 * @param id
 */
export async function editorialArtifact(orgId: string, userId: string | null, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) {
    return null;
  }
  const artifact = await getArtifact({ orgId, id });
  return artifact && canOpenArtifact({ audience: artifact.shareAudience, ownerId: artifact.shareOwnerId ?? null }, { userId, isMember: true, hasToken: false }) ? toPayload(artifact) : null;
}
