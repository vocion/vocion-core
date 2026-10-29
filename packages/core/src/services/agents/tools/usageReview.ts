/**
 * run_usage_review — the Workspace manager's daily read of how people used
 * the workspace: did each chat get the person where they wanted, what got in
 * the way, and what would fix it. The work is core's service
 * (`services/usageReview/UsageReviewService.ts`): facts in code, a judge for
 * Orgs that let the review read content, the day published as a briefing and
 * its fixes filed as proposals. The tool hands back the outcome and the link,
 * which is what the agent reports.
 *
 * Granted by name (`harness.grantTools: [run_usage_review]`), which the
 * workspace-manager plugin's agent carries.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const USAGE_REVIEW_TOOL = 'run_usage_review';

function runUsageReviewTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async () => {
      const [{ usageReview }, { briefingHref }] = await Promise.all([import('@/libs/usageReviewBridge'), import('@/services/briefings/links')]);
      const { runUsageReview } = await usageReview();
      const r = await runUsageReview(ctx.orgId);
      if (r.skipped) {
        const why = {
          no_activity: 'Nobody used this workspace in the last day, so there is nothing to review.',
          workspace_paused: 'This workspace is paused; the review waits until it is running again.',
          personal_workspace: 'A personal workspace is one person\'s own; it is not reviewed.',
          no_project: 'This workspace could not be found.',
        }[r.skipped];
        return JSON.stringify({ reviewed: false, why });
      }
      const rep = r.report!;
      return JSON.stringify({
        reviewed: true,
        report: r.briefingId ? briefingHref(r.briefingId) : null,
        readAs: rep.mode.mode === 'content' ? 'chat content and metadata' : 'metadata only',
        threads: rep.threads.read,
        approvals: rep.approvals,
        judged: rep.threads.judged,
        gotThere: rep.outcome.rate === null ? 'could not be read' : `${rep.outcome.rate}% of ${rep.outcome.readable} with a readable outcome`,
        askedAgain: rep.reasks.rate === null ? null : `${rep.reasks.rate}% of threads`,
        topFriction: rep.themes.slice(0, 3).map(t => `${t.label} (${t.count})`),
        fixesFiled: rep.fixes.filter(f => f.runId).map(f => f.headline),
        note: rep.judgeNote,
      });
    },
    {
      name: USAGE_REVIEW_TOOL,
      description: 'Run the daily usage review of this workspace: reads the last day\'s chat threads and decided approvals, judges whether each got the person where they wanted (only where the Org lets the review read content), publishes the report on Briefings and files the fixes it supports as proposals on Needs you. Takes no arguments; returns the outcome, the report\'s link and the fixes filed. Run it once per check.',
      schema: z.object({}),
    },
  );
}

/**
 * The tool, for an agent granted it by name.
 * @param ctx - The turn.
 */
export function usageReviewTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return (ctx.harnessConfig.grantTools ?? []).includes(USAGE_REVIEW_TOOL) ? [runUsageReviewTool(ctx)] : [];
}
