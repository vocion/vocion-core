/**
 * record_live_check — QA records what it saw of a release on the live product,
 * one entry per acceptance line of every shipped request: seen, not seen, or
 * not observable (a CI run, an image's contents, a pre-merge guarantee), the
 * seen and not-seen ones citing evidence this run's browser captured
 * (`browser_*` ids). Granted-only (`harness.grantTools: [record_live_check]`).
 * The mechanism is `services/factory/liveCheck.ts`; the decisions
 * `libs/factory/liveCheck.ts`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RecordedLineSchema } from '@/libs/factory/liveCheck';

/** The grant, and the tool's name. */
export const RECORD_LIVE_CHECK = 'record_live_check';

const inputSchema = z.object({
  release_id: z.number().int().positive().describe('The release checked (the event\'s releaseId).'),
  lines: z.array(RecordedLineSchema).min(1).max(80).describe(
    'One entry per acceptance line of every request the release shipped, including the lines QA left to the live check: '
    + '{request_id (when the release shipped more than one request), line (its number), result: seen | not_seen | not_observable, '
    + 'evidence: the ids this run\'s browser tools returned that show it (snapshot, screenshot, response, action ids) — required for seen and not_seen, '
    + 'why: one sentence on what the evidence shows, or why production cannot show it, '
    + 'cause (on not_observable): proven_before_merge when QA\'s verdict proved it and production has nothing to show (a CI run, a migration), not_a_live_behaviour when the line is not something a running product shows, '
    + 'environment_cannot_show when the QA account or its data cannot reach the feature (no team, no plan, no record to act on) — that one makes the release read not checked with the fix named, never seen}.',
  ),
});

export function recordLiveCheckTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!(ctx.harnessConfig.grantTools ?? []).includes(RECORD_LIVE_CHECK)) {
    return [];
  }
  return [tool(
    async (args) => {
      const { browserSessionEvidence, browserSessionKey } = await import('@/services/factory/liveBrowser');
      const { recordLiveCheck } = await import('@/services/factory/liveCheck');
      const session = browserSessionEvidence(browserSessionKey({ orgId: ctx.orgId, missionRunId: ctx.missionRunId ?? null, conversationId: ctx.conversationId ?? null }));
      const out = await recordLiveCheck(ctx.orgId, { releaseId: args.release_id, lines: args.lines }, {
        // A session that opened another release holds no evidence for this one.
        session: session.releaseId === null || session.releaseId === args.release_id ? session.evidence : new Map(),
        problems: session.releaseId === args.release_id ? session.problems : [],
        missionRunId: ctx.missionRunId ?? null,
      });
      // A refusal opens "Not recorded" so the run's required-tool pass counts it as not done
      // (`isRefusal`) and the agent fixes the lines in the same run.
      if (out.refused) {
        return `Not recorded: nothing was written on release #${args.release_id}. ${out.refused}`;
      }
      return JSON.stringify({ written: out.written, state: out.verdict.state, line: out.verdict.line, attempt: out.attempt, next: 'Written on the release and each feature. Report it in one line and stop.' });
    },
    {
      name: RECORD_LIVE_CHECK,
      description: 'Record what you saw of a shipped release on the live product: every acceptance line of every request it shipped (numbered as browser_open lists them), '
        + 'seen or not_seen citing the ids of what this run\'s browser captured, or not_observable with why production cannot show it (it then reads "proven before merge by QA\'s verdict" when the verdict proved it). '
        + 'Refused, writing nothing, when a line is missing, unknown or doubled, or cites an id this run did not capture; the refusal lists the lines. '
        + 'Writes the release\'s liveState, liveSummary, liveEvidence and announcement image, and each feature\'s liveCheck with what it saw of each line.',
      schema: inputSchema,
    },
  )];
}
