/**
 * file_feedback — turn what someone just told you into work and into a rule.
 *
 * The manifesto's test for any interaction includes *did this interaction
 * teach the system something* (`docs/MANIFESTO.md` §9, "Improvement must be
 * visible"). A person who replies to an agent with "you should have had the
 * thread context here" has written a requirement. Read once and answered
 * politely, it teaches nothing; filed, it becomes a proposed rule a human can
 * adopt AND a recommendation in that workspace's Needs-you inbox that a human
 * can start.
 *
 * EVERY interaction, when appropriate — which is what the classifier decides
 * (`services/chat/feedbackSignal.ts`), so the model is asked only when the
 * heuristic is genuinely unsure.
 *
 * Nothing here executes work. Approving *Plan and start* in the inbox does,
 * where the person's identity is known — decision 025, unchanged.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fileFeedback } from '@/services/chat/feedbackToWork';

export function fileFeedbackTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const thread = ctx.pageContext?.thread;
      const author = args.saidBy?.trim()
        || thread?.posters?.[0]?.name
        || 'someone in the thread';
      try {
        const filed = await fileFeedback({
          orgId: ctx.orgId,
          feedback: args.feedback,
          author,
          ...(thread ? { thread } : {}),
          permalink: args.sourceUrl ?? null,
          agentSlug: ctx.agentSlug ?? null,
          createdBy: ctx.userId ?? null,
        });
        if (!filed.ask) {
          return `Recorded as a proposed rule (candidate ${filed.candidateId}) for a person to adopt or reject. No recommendation was filed: this workspace has no team whose mission is building, so there is nobody here to plan it. Say that plainly rather than implying work has started.`;
        }
        return [
          `Filed. Proposed rule recorded (candidate ${filed.candidateId}), and a recommendation is waiting for a person in the Needs-you inbox: "${filed.ask.title}" — options Plan and start (recommended), Add to backlog, Decline.`,
          filed.inboxUrl ? `Link: ${filed.inboxUrl}` : '',
          `Tell them exactly this in your reply, with the link, and that approving "Plan and start" is what begins the work. Do not start it yourself from here.`,
        ].filter(Boolean).join('\n');
      } catch (error) {
        return `Could not file that feedback: ${error instanceof Error ? error.message : 'unknown error'}. Answer the person anyway, and say it was not recorded.`;
      }
    },
    {
      name: 'file_feedback',
      description: 'Record feedback or an instruction about the product — a request, a complaint, a "you should have…" — so it teaches the system instead of being read once. Writes a proposed rule for a person to adopt, and, when this workspace has a team that builds, files a recommendation in the Needs-you inbox with Plan and start / Add to backlog / Decline. Approving it is what starts the work; this tool starts nothing. Call it whenever someone tells you what the product should do differently, then say in your reply what you filed and link it.',
      schema: z.object({
        feedback: z.string().min(3).describe('What the person said, VERBATIM. Do not paraphrase — a human edits the rule from these words.'),
        saidBy: z.string().optional().describe('Who said it, as a name if you know one.'),
        sourceUrl: z.string().optional().describe('Permalink back to where it was said, e.g. the Slack message link, when you have one.'),
      }),
    },
  );
}
