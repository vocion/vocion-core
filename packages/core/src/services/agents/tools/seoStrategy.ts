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
import { randomUUID } from 'node:crypto';
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
      const [{ getDataRoom }, strategy, { listProjectAudits }, { listProjectPrompts }, { listProjectKeywords }, goal, { goalCreateAction, GOAL_CREATE_ACTION_ID }, { renderMarkdownArtifact }, { anchorArtifact }] = await Promise.all([
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
        audit: latest ? { id: latest.id, title: latest.title, highCount: latest.meta.highCount, openCount: latest.meta.openCount, checkedAt: latest.meta.checkedAt, reportArtifactId: latest.meta.reportArtifactId, nextSteps: Array.isArray(latest.meta.nextSteps) ? latest.meta.nextSteps : [] } : null,
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
      if (held?.meta.goalId) {
        const { getGoal } = await import('@/services/objectives/GoalService');
        const approved = await getGoal(ctx.orgId, held.meta.goalId);
        if (approved && approved.ownerUserId !== ctx.userId) {
          return 'Only the approved strategy owner can propose its replacement.';
        }
      }
      const draftToken = randomUUID();
      let documentArtifactId: number | null = null;
      {
        const made = await renderMarkdownArtifact(ctx, `SEO strategy · ${room.title}`, md, 'seo/strategy');
        documentArtifactId = made.artifactId;
        if (documentArtifactId) {
          await anchorArtifact({ orgId: ctx.orgId, id: documentArtifactId, record: { type: 'object', id: String(room.id), role: 'seo-strategy' } }).catch(() => null);
        }
      }
      const input = {
        title,
        seo_strategy: { projectId: room.id, token: draftToken, ...(held?.meta.goalId ? { replacesGoalId: held.meta.goalId } : {}) },
        horizon: args.horizon,
        measure: { kind: 'milestones' as const, milestones },
        links: [{ kind: 'room' as const, id: String(room.id), label: room.title }, ...(documentArtifactId ? [{ kind: 'artifact' as const, id: String(documentArtifactId), label: `SEO strategy · ${room.title}` }] : [])],
        weekly_review: true,
        reason: held?.meta.goalId ? 'Replace the active SEO strategy; the previous strategy goal will be paused and its history retained.' : args.reason ?? `The client's SEO strategy, measured by the work that completes it.`,
      };
      const parsed = goalCreateAction.inputSchema.safeParse(input);
      if (!parsed.success) {
        return `Draft not shown — ${parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}. Pass 3 to 7 milestones.`;
      }
      await strategy.upsertStrategy(ctx.orgId, { id: room.id, title: room.title }, {
        ...(!held?.meta.goalId
          ? {
              goalTitle: title,
              horizon: goal.horizonLabel(horizon),
              goalStatus: 'drafted',
              progressLine: `Waiting on the goal card: ${milestones.length} milestones`,
              milestones: milestones.map(m => ({ label: m.label, done: false, ...(m.link ? { href: `/dashboard/objects/${m.link.id}` } : {}) })),
              ...(documentArtifactId ? { documentArtifactId } : {}),
            }
          : {}),
        pendingDraft: { token: draftToken, createdBy: ctx.userId, title, horizon: args.horizon, ...(documentArtifactId ? { documentArtifactId } : {}), createdAt: new Date().toISOString() },
      }, `agent:${ctx.agentSlug ?? 'seo-strategist'}`, held?.meta.goalId ?? null);
      const problem = await goalCreateAction.precheck!({ orgId: ctx.orgId, invokedBy: ctx.userId, origin: { userId: ctx.userId } } as never, parsed.data);
      if (problem) {
        return `Draft not shown — ${problem}`;
      }
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

/**
 * Read the client's executable roadmap before starting or linking work.
 * @param ctx
 */
export function seoReadRoadmapTool(ctx: RuntimeContext) {
  return tool(async ({ project_id }) => {
    if (!ctx.userId) {
      return 'A signed-in person is required.';
    }
    const { readSeoRoadmap } = await import('@/services/seo/roadmap');
    return JSON.stringify(await readSeoRoadmap(ctx.orgId, project_id, ctx.userId));
  }, { name: 'seo_read_roadmap', description: 'Read a client SEO roadmap, initiative IDs, dependencies, linked work, and separately measured outcomes. Read before starting roadmap work. No changes.', schema: z.object({ project_id: z.number().int().positive() }) });
}

/**
 * Attach existing, approved-path execution records without approving or running them.
 * @param ctx
 */
export function seoLinkRoadmapWorkTool(ctx: RuntimeContext) {
  return tool(async ({ project_id, initiative_id, record_ids, task_ids, expected_revision }) => {
    if (!ctx.userId) {
      return 'A signed-in strategy owner is required.';
    }
    if (record_ids.length + task_ids.length === 0) {
      return 'Link at least one actual execution record or task.';
    }
    const { readSeoRoadmap, updateSeoRoadmap } = await import('@/services/seo/roadmap');
    const state = await readSeoRoadmap(ctx.orgId, project_id, ctx.userId);
    const initiative = state.roadmap.initiatives.find(i => i.id === initiative_id);
    if (!initiative) {
      return 'Initiative not found. Read the current roadmap first.';
    }
    if (state.roadmap.revision !== expected_revision) {
      return 'The roadmap changed. Read it again before linking work.';
    }
    initiative.recordIds = [...new Set([...initiative.recordIds, ...record_ids])];
    initiative.taskIds = [...new Set([...initiative.taskIds, ...task_ids])];
    initiative.status = 'in_progress';
    try {
      const result = await updateSeoRoadmap(ctx.orgId, project_id, ctx.userId, expected_revision, state.roadmap);
      return JSON.stringify({ revision: result.roadmap.revision, initiative: result.roadmap.initiatives.find(i => i.id === initiative_id) });
    } catch (err) {
      return `Work not linked: ${(err as Error).message}`;
    }
  }, { name: 'seo_link_roadmap_work', description: 'Attach actual existing execution records to a stable roadmap initiative after creating normal SEO work. Requires the strategy owner, current revision, and records belonging to this client. Does not approve, publish, or run work.', schema: z.object({ project_id: z.number().int().positive(), initiative_id: z.string().min(1), record_ids: z.array(z.number().int().positive()).max(50).default([]), task_ids: z.array(z.number().int().positive()).max(50).default([]), expected_revision: z.number().int().nonnegative() }) });
}
