/**
 * seo_draft_strategy — a client's SEO strategy as a goal a person owns.
 *
 * Code composes the draft from what the client's project holds (its SEO
 * profile, latest audit, batches, prompts and keywords): the goal's title
 * from the client's first goal, 3–7 milestones each linked to the record
 * whose own status completes it, and the strategy document on the project.
 * The goal itself is the existing Decision card (`goal.create`): the person
 * approves it, edits it on the card, or declines. The Strategy page's row
 * (`seo_strategy`) follows it (`services/seo/strategy.ts`).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * The tool.
 * @param ctx - The turn.
 */
export function seoDraftStrategyTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      if (!ctx.userId) {
        return 'A strategy goal belongs to a person, and this run has none behind it. Ask the person to draft it from chat.';
      }
      const [{ getDataRoom }, strategy, { listProjectAudits }, { listProjectPrompts }, { listProjectKeywords }, goal, { goalCreateAction, GOAL_CREATE_ACTION_ID }, { renderMarkdownArtifact }, { anchorArtifact, updateArtifact }] = await Promise.all([
        import('@/services/DataRoomService'),
        import('@/services/seo/strategy'),
        import('@/services/seo/audits'),
        import('@/services/seo/prompts'),
        import('@/services/seo/keywords'),
        import('@/libs/objectives/goal'),
        import('@/libs/actions/goal-create'),
        import('./renderArtifacts'),
        import('@/services/ArtifactService'),
      ]);
      const room = await getDataRoom(ctx.orgId, args.project_id);
      if (!room) {
        return `No project #${args.project_id} in this workspace.`;
      }
      const horizon = goal.parseHorizon(args.horizon);
      if (!horizon) {
        return `"${args.horizon}" is not a horizon: give a date (2027-03-31) or a quarter (2027-Q1).`;
      }
      const latest = (await listProjectAudits(ctx.orgId, room.id))[0];
      const batches = await strategy.projectRecords(ctx.orgId, room.id, 'seo_batch');
      const pages = await strategy.projectRecords(ctx.orgId, room.id, 'seo_page');
      const prompts = (await listProjectPrompts(ctx.orgId, room.id)).filter(p => p.meta.status !== 'dropped');
      const keywords = await listProjectKeywords(ctx.orgId, room.id).catch(() => []);
      const inputs = {
        client: room.title,
        profile: room.meta.seoProfile,
        topic: args.topic,
        horizonText: goal.horizonLabel(horizon),
        audit: latest ? { id: latest.id, title: latest.title, highCount: latest.meta.highCount, openCount: latest.meta.openCount, checkedAt: latest.meta.checkedAt, reportArtifactId: latest.meta.reportArtifactId, nextSteps: latest.meta.nextSteps } : null,
        batches: batches.filter(b => (b.meta.plan as { state?: string } | undefined)?.state !== 'discarded').map((b) => {
          const own = pages.filter(p => p.meta.batchId === b.id && p.meta.status !== 'rejected');
          return { id: b.id, title: b.title, total: own.length, published: own.filter(p => p.meta.status === 'published').length };
        }),
        prompts: prompts.map(p => ({ id: p.id, prompt: p.meta.prompt, group: p.meta.group, visibility: p.meta.visibility })),
        keywords: { total: keywords.length, ideas: keywords.filter(k => k.meta.status === 'idea').length, ranking: keywords.filter(k => k.meta.status === 'ranking').length },
      };
      const title = (args.title?.trim() || strategy.strategyTitle(inputs)).slice(0, 200);
      const milestones = args.milestones?.length
        ? args.milestones.map(m => ({ label: m.label, ...(m.record_id ? { link: { kind: 'record' as const, id: String(m.record_id) } } : {}) }))
        : strategy.strategyMilestones(inputs);
      // The strategy document: one per project, a new version each draft.
      const md = strategy.renderStrategyDoc(inputs, { title, milestones, projectId: room.id, date: new Date().toISOString().slice(0, 10) });
      const held = await strategy.getStrategy(ctx.orgId, room.id);
      let documentArtifactId = held?.meta.documentArtifactId ?? null;
      if (documentArtifactId) {
        const updated = await updateArtifact({ orgId: ctx.orgId, id: documentArtifactId, contentMarkdown: md, author: { kind: 'agent', id: ctx.agentSlug ?? 'seo-strategist' }, changeSummary: `Strategy drafted ${new Date().toISOString().slice(0, 10)}` }).catch(() => null);
        if (!updated) {
          documentArtifactId = null;
        }
      }
      if (!documentArtifactId) {
        const made = await renderMarkdownArtifact(ctx, `SEO strategy · ${room.title}`, md, 'seo/strategy');
        documentArtifactId = made.artifactId;
        if (documentArtifactId) {
          await anchorArtifact({ orgId: ctx.orgId, id: documentArtifactId, record: { type: 'object', id: String(room.id), role: 'seo-strategy' } }).catch(() => null);
        }
      }
      const input = {
        title,
        horizon: args.horizon,
        measure: { kind: 'milestones' as const, milestones },
        links: [{ kind: 'room' as const, id: String(room.id), label: room.title }, ...(documentArtifactId ? [{ kind: 'artifact' as const, id: String(documentArtifactId), label: `SEO strategy · ${room.title}` }] : [])],
        weekly_review: true,
        reason: args.reason ?? `The client's SEO strategy, measured by the work that completes it.`,
      };
      const parsed = goalCreateAction.inputSchema.safeParse(input);
      if (!parsed.success) {
        return `Draft not shown — ${parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}. Pass 3 to 7 milestones.`;
      }
      const problem = await goalCreateAction.precheck!({ orgId: ctx.orgId, invokedBy: ctx.userId, origin: { userId: ctx.userId } } as never, parsed.data);
      if (problem) {
        return `Draft not shown — ${problem}`;
      }
      await strategy.upsertStrategy(ctx.orgId, { id: room.id, title: room.title }, {
        goalTitle: title,
        horizon: goal.horizonLabel(horizon),
        goalStatus: 'drafted',
        progressLine: `Waiting on the goal card: ${milestones.length} milestones`,
        milestones: milestones.map(m => ({ label: m.label, done: false, ...(m.link ? { href: `/dashboard/objects/${m.link.id}` } : {}) })),
        ...(documentArtifactId ? { documentArtifactId } : {}),
        ...(held?.meta.goalId && held.meta.goalTitle !== title ? { goalId: undefined } : {}),
      }, ctx.userId);
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: GOAL_CREATE_ACTION_ID,
          input: parsed.data,
          label: `Set the strategy goal: ${title}`,
          rationale: parsed.data.reason ?? '',
          confidence: 0.8,
          agentSlug: ctx.agentSlug,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'Each milestone is linked to the work that completes it; edit the wording or the horizon first if you like.',
        },
      });
      return [
        `Put the strategy goal "${title}" in front of the person as a card: ${milestones.length} milestones, ${milestones.filter(m => m.link).length} linked to the work that completes them. Your turn ends there; do not paste it as text.`,
        documentArtifactId ? `The strategy document is on the project: /dashboard/artifacts/${documentArtifactId}.` : null,
      ].filter(Boolean).join('\n');
    },
    {
      name: 'seo_draft_strategy',
      description: 'Draft a client\'s SEO strategy as a GOAL the person owns ("<Client> named in AI answers for <topic> in Q1 2027"), with 3–7 milestones each linked to the record that completes it: the latest audit\'s high findings fixed, a batch live, a prompt the client is named for. Writes the strategy document on the project (profile, what comes first, the latest audit, keywords, prompts, batches) and files the goal as a card to approve or edit. Leave milestones out to have them composed from the project; pass record_id on a milestone to link your own.',
      schema: z.object({
        project_id: z.number().int().positive(),
        horizon: z.string().min(2).max(20).describe('A date (2027-03-31) or a quarter (2027-Q1).'),
        topic: z.string().max(120).optional().describe('What the client wants to be found for, in the buyer\'s words.'),
        title: z.string().max(200).optional().describe('Only when the person worded the goal.'),
        milestones: z.array(z.object({ label: z.string().min(2).max(160), record_id: z.number().int().positive().optional() })).min(3).max(7).optional(),
        reason: z.string().max(300).optional(),
      }),
    },
  );
}
