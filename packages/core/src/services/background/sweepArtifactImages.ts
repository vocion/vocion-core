/**
 * Activity body for the artifact image sweep: retry the copies that failed
 * for a reason that may not hold now (`services/artifacts/imageIngest.ts`).
 * Dynamic import: the sweep pulls in the image decoder, which no other
 * activity needs at worker boot.
 */
export async function sweepArtifactImagesActivity(): Promise<{ retried: number; stored: number }> {
  const { sweepFailedImageIngests } = await import('@/services/artifacts/imageIngest');
  return sweepFailedImageIngests();
}
