/**
 * Run one workspace's org review by hand — the same pass its weekly schedule
 * runs (`org.review`, `services/orgReview`). It files `org.change` proposals
 * on Needs you and runs the learning compaction when it is due; it changes
 * nothing about the team on its own. `--force` runs it in a workspace that
 * turned the review off.
 *
 * Usage, from packages/core:
 *   npm run org-review:run -- --org <projectId> [--force]
 */

import { orgReviewLine, runOrgReview } from '@/services/orgReview/OrgReviewService';

const i = process.argv.indexOf('--org');
const orgId = i >= 0 ? process.argv[i + 1] : undefined;
if (!orgId) {
  console.error('pass --org <projectId>');
  process.exit(1);
}

runOrgReview(orgId, { force: process.argv.includes('--force') })
  .then((result) => {
    console.warn(orgReviewLine(result));
    for (const filed of result.filed) {
      console.warn(`  filed ${filed.kind} ${filed.target} → action_run ${filed.runId} (${filed.outcome}, ${filed.status})`);
    }
    for (const skipped of result.notFiled) {
      console.warn(`  not filed ${skipped.kind} ${skipped.target}: ${skipped.why}`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
