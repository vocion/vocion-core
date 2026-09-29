import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: { maximumAttempts: 1 },
});

/**
 * Deployment-wide sweep: retry image artifacts whose copy into the artifact
 * store failed, while their links are still valid. Scheduled hourly by
 * ArtifactImageSweepScheduleService. Not retried by Temporal — the next
 * hour is the retry.
 */
export async function artifactImageSweepWorkflow() {
  return acts.sweepArtifactImagesActivity();
}
