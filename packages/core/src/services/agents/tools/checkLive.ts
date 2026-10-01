/**
 * check_live — QA checks a release on the live product, as the product's QA
 * account, and the release and its features say what QA saw. Granted-only
 * (`harness.grantTools: [check_live]`). The mechanism is
 * `services/factory/liveCheck.ts`; the decisions `libs/factory/liveCheck.ts`.
 *
 * QA writes the flows: what to prepare on production (setup), what to look
 * at for each acceptance line (check), and how to remove what it made
 * (cleanup). `explore: true` runs them and reports what each page said,
 * writing nothing — the way to learn a live page before checking it.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { LIVE_ATTEMPTS, LIVE_LIMITS, LIVE_STEP_VERBS, LiveFlowSchema } from '@/libs/factory/liveCheck';

const inputSchema = z.object({
  release_id: z.number().int().positive().describe('The release to check (the event\'s releaseId).'),
  flows: z.array(LiveFlowSchema).min(1).max(LIVE_LIMITS.flows).describe(
    'The live flows, run setup → check → cleanup. Each: name; phase (setup | check | cleanup, default check); '
    + 'request_id and criterion (the acceptance line a check flow proves, in the request\'s words); signed_in '
    + '(default true: as the product\'s QA account; false: a visitor with no session); surface (an environment '
    + 'surface, default the one with the QA sign-in); path (a path on it, or {{name}} an earlier step remembered); '
    + 'viewports (desktop | phone); steps, each exactly one of '
    + `${LIVE_STEP_VERBS.join(', ')} — click/wait_for take visible text or a selector; fill {selector, value}; `
    + 'upload {selector, megabytes, name} uploads a real one-page PDF; goto opens a path or {{name}}; remember '
    + '{name, from: url|href|text|value, selector?} keeps a value for later steps as {{name}}; pause seconds; '
    + 'shoot "<what it shows>" takes the picture that proves the criterion.',
  ),
  explore: z.boolean().optional().describe('Run the flows and report what each page showed, writing nothing on the release. Cleanup still runs.'),
});

export function checkLiveTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!(ctx.harnessConfig.grantTools ?? []).includes('check_live')) {
    return [];
  }
  return [tool(
    async (args) => {
      const { runLiveCheck } = await import('@/services/factory/liveCheck');
      const out = await runLiveCheck(ctx.orgId, { releaseId: args.release_id, flows: args.flows, explore: args.explore }, {
        author: { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null },
        provenance: { agentSlug: ctx.agentSlug ?? null, missionRunId: ctx.missionRunId ?? null },
      });
      const next = out.explore
        ? 'Nothing was written. Use what each page showed to write the flows, then run check_live without explore.'
        : out.verdict.state === 'seen'
          ? 'Written on the release and each feature. Report it in one line; do not describe the pictures.'
          : (out.attempt ?? 0) < LIVE_ATTEMPTS
              ? `Attempt ${out.attempt} of ${LIVE_ATTEMPTS}. Read what each page showed (pageText) and the first failure, change the flows (the selector, the state setup prepares, the path), and call check_live once more.`
              : `That was the last attempt: the release and each feature now say "${out.verdict.line}". Report that in one line and stop.`;
      return JSON.stringify({ ...out, next });
    },
    {
      name: 'check_live',
      description: 'Check a shipped release on the live product as the product\'s QA account (its stored sign-in; the password never leaves the server). '
        + 'Runs your setup flows (prepare the state the change needs on production, e.g. upload a test record and open its link once as a visitor), '
        + 'your check flows (one per acceptance line, with a shoot), then your cleanup flows (remove what setup made; always run). '
        + 'Writes liveEvidence, liveSummary, liveState and the announcement image on the release, a live-screenshot per shot, and on each feature its '
        + 'liveCheck and its Live pictures. Only the product\'s own addresses can be opened.',
      schema: inputSchema,
    },
  )];
}
