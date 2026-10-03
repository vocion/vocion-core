/**
 * check_live — QA checks a release on the live product, as the product's QA
 * account, and the release and its features say what QA saw. Granted-only
 * (`harness.grantTools: [check_live]`). The mechanism is
 * `services/factory/liveCheck.ts`; the decisions `libs/factory/liveCheck.ts`.
 *
 * QA writes the flows: what to prepare on production (setup, only when a line
 * needs state), what to look at for each acceptance line (check, citing the
 * line by its number), and how to remove what it made (cleanup). The lines a
 * live product cannot show are named in `not_observable`; they read "proven
 * before merge by QA's verdict" when the verdict proved them. `explore: true`
 * runs the flows and reports what each page said, writing nothing — the way
 * to learn a live page, and the request's numbered lines, before checking.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { LIVE_ATTEMPTS, LIVE_LIMITS, LIVE_STEP_VERBS, LiveFlowSchema, NotObservableSchema } from '@/libs/factory/liveCheck';

// QA cites a line; the words are the record's (`resolveLines`), so a flow carries no criterion of its own.
const FlowInputSchema = LiveFlowSchema.omit({ criterion: true });

const inputSchema = z.object({
  release_id: z.number().int().positive().describe('The release to check (the event\'s releaseId).'),
  flows: z.array(FlowInputSchema).min(1).max(LIVE_LIMITS.flows).describe(
    'The live flows, run setup → check → cleanup. Each: name; phase (setup | check | cleanup, default check); '
    + 'request_id (the feature, when the release shipped more than one) and line: the number (1-based) of the request\'s acceptance line a check flow proves — '
    + 'the check writes the line\'s words from the record, and a number the request does not have is refused with its lines listed; signed_in '
    + '(default true: as the product\'s QA account; false: a visitor with no session); surface (an environment '
    + 'surface, default the one with the QA sign-in); path (a path on it, or {{name}} an earlier step remembered); '
    + 'viewports (desktop | phone); steps, each exactly one of '
    + `${LIVE_STEP_VERBS.join(', ')} — click/wait_for take visible text or a selector; fill {selector, value}; `
    + 'upload {selector, megabytes, name} uploads a real one-page PDF; goto opens a path or {{name}} ({{setupPage}} is the page the last finished setup flow ended on); remember '
    + '{name, from: url|href|text|value, selector?} keeps a value for later steps as {{name}}; pause seconds; '
    + 'expect_response {path, status, method?} passes when a response the page received during the flow (any host it called, e.g. its API) has that path (or ends with it) and status, '
    + 'and fails with what it answered instead ("GET /v1/documents returned 500") — the way to prove a line about an API: goto the page that calls it, expect_response, then shoot; '
    + 'shoot "<what it shows>" takes the picture that proves the line. Setup and cleanup are only for lines that need state made: a check flow may run alone.',
  ),
  not_observable: z.array(NotObservableSchema).max(40).optional().describe(
    'The acceptance lines the live product cannot show (a CI run, an image\'s contents, a pre-merge guarantee): {request_id?, line, why}. '
    + 'A line QA\'s pre-merge verdict proved reads "proven before merge by QA\'s verdict" on the release and the feature, and is not counted as unreached; '
    + 'one it did not prove stands unproven. Every line must be either cited by a check flow or named here: a recording call that leaves a line as neither is refused, listing it.',
  ),
  explore: z.boolean().optional().describe('Run the flows and report what each page showed, and each request\'s numbered acceptance lines, writing nothing on the release. Cleanup still runs.'),
});

/**
 * The move a visitor flow sent to sign-in needs, typed from the reason's kind:
 * the page needs a signed-in account, so the flow runs signed in, or opens a
 * page a visitor can (a share link setup remembered).
 * @param why - The verdict's typed reason.
 */
export function visitorHint(why: { kind?: string; flow?: string | null } | null | undefined): string {
  return why?.kind === 'visitor_sent_to_sign_in'
    ? `${why.flow ? `"${why.flow}"` : 'A flow'} ran signed out (signed_in: false) and its page needs sign-in: run it signed in, or open a page a visitor can open (a share link setup remembered). `
    : '';
}

export function checkLiveTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!(ctx.harnessConfig.grantTools ?? []).includes('check_live')) {
    return [];
  }
  return [tool(
    async (args) => {
      const { runLiveCheck } = await import('@/services/factory/liveCheck');
      const out = await runLiveCheck(ctx.orgId, { releaseId: args.release_id, flows: args.flows, explore: args.explore, notObservable: args.not_observable }, {
        author: { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null },
        provenance: { agentSlug: ctx.agentSlug ?? null, missionRunId: ctx.missionRunId ?? null },
      });
      // A refusal opens "Not recorded" so the run's required-tool pass counts it as not done
      // (`isRefusal`) and the agent fixes the flows in the same run.
      if (out.refused) {
        return `Not recorded: nothing ran and nothing was written on release #${args.release_id}. ${out.refused}`;
      }
      const next = out.explore
        ? 'Nothing was written. Use what each page showed and the numbered acceptance lines to write the flows (a check flow per line production can show, citing it by line; the rest in not_observable), then run check_live without explore.'
        : out.verdict.state === 'seen'
          ? 'Written on the release and each feature. Report it in one line; do not describe the pictures.'
          : (out.attempt ?? 0) < LIVE_ATTEMPTS
              ? `Attempt ${out.attempt} of ${LIVE_ATTEMPTS}. ${visitorHint(out.verdict.why)}Read what each page showed (pageText) and the first failure, change the flows (the selector, the state setup prepares, the path, the lines cited), and call check_live once more.`
              : `That was the last attempt: the release and each feature now say "${out.verdict.line}". Report that in one line and stop.`;
      return JSON.stringify({ ...out, next });
    },
    {
      name: 'check_live',
      description: 'Check a shipped release on the live product as the product\'s QA account (its stored sign-in; the password never leaves the server). '
        + 'Each check flow cites one acceptance line of the release\'s request by its number (line: n); the check writes the line\'s words from the record and refuses a number the request does not have, listing its lines. '
        + 'After the acceptance lines come, numbered on, the lines QA\'s verdict left to the live check (marked leftToLive, "QA left this to the live check", often a plan risk): check them like any other line. '
        + 'Lines the live product cannot show go in not_observable and read as proven before merge when QA\'s verdict proved them; the live state counts only the lines production can show. '
        + 'Runs your setup flows (only when a line needs state made on production), your check flows (one per line, with a shoot, and expect_response for a line about an API), then your cleanup flows (remove what setup made; always run). '
        + 'Writes liveEvidence, liveSummary, liveState and the announcement image on the release, a live-screenshot per shot, and on each feature its '
        + 'liveCheck and its Live pictures. Every answer lists each request\'s acceptance lines, numbered. Only the product\'s own addresses can be opened.',
      schema: inputSchema,
    },
  )];
}
