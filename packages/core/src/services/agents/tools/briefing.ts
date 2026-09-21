/**
 * Briefing tools — team-scoped.
 *
 * Every brief belongs to a TEAM (published by its lead); the workspace lead's
 * brief is the cross-team ROLLUP (team_slug NULL). Tools:
 * - publish_briefing: stamps the caller's agent + team.
 * - get_briefing: the caller's TEAM brief by default (arg `team` to read
 *   another team's, `rollup` for the workspace rollup) + freshness signal.
 * - refresh_briefing: refreshes the caller's team brief IN THE BACKGROUND by
 *   running the team's lead agent with a publish instruction (generic — works
 *   for every team, no per-team mission required). Rollup refresh runs the
 *   workspace lead over the latest team briefs. Never blocks the turn.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { formatDateTime } from '@/libs/time/zone';
import { agentSchema, briefingSchema, teamSchema } from '@/models/Schema';
import { PublishBriefingInputSchema } from '@/services/briefings/agentInput';
import { renderedSections } from '@/services/briefings/document';
import { TEAM_BRIEF_INSTRUCTION, WORKSPACE_BRIEF_INSTRUCTION } from '@/services/briefings/instructions';
import { newestBriefing, publishBriefingDocument } from '@/services/briefings/store';
import { BriefingContractError } from '@/services/briefings/validate';
import { isFromToday, renderBriefingForAgent } from './briefingCitation';

async function callerTeam(ctx: RuntimeContext): Promise<{ teamSlug: string | null; leadSlug: string | null }> {
  if (!ctx.agentSlug) {
    return { teamSlug: null, leadSlug: null };
  }
  const [row] = await db
    .select({ teamSlug: agentSchema.teamSlug })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, ctx.orgId), eq(agentSchema.slug, ctx.agentSlug)))
    .limit(1);
  const teamSlug = row?.teamSlug ?? null;
  if (!teamSlug) {
    return { teamSlug: null, leadSlug: null };
  }
  const [team] = await db
    .select({ lead: teamSchema.leadAgentSlug })
    .from(teamSchema)
    .where(and(eq(teamSchema.orgId, ctx.orgId), eq(teamSchema.slug, teamSlug)))
    .limit(1);
  return { teamSlug, leadSlug: team?.lead ?? null };
}

async function latestBriefing(orgId: string, teamSlug: string | null) {
  const [row] = await db
    .select({ id: briefingSchema.id, title: briefingSchema.title, content: briefingSchema.content, createdAt: briefingSchema.createdAt, teamSlug: briefingSchema.teamSlug })
    .from(briefingSchema)
    .where(and(eq(briefingSchema.orgId, orgId), teamSlug === null ? isNull(briefingSchema.teamSlug) : eq(briefingSchema.teamSlug, teamSlug)))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(1);
  return row ?? null;
}

export function publishBriefingTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      // The publisher dates the briefing (`publishBriefingDocument`); the
      // model only names it, and whatever date it wrote is stripped there.
      const input = PublishBriefingInputSchema.parse(args);
      const { teamSlug } = await callerTeam(ctx);
      const scope = input.rollup ? null : teamSlug;
      try {
        const { id, doc, dropped, replaced } = await publishBriefingDocument(ctx.orgId, input, {
          teamSlug: scope,
          agentSlug: ctx.agentSlug ?? null,
          userId: ctx.userId ?? null,
          // The workspace's (or the person's) day names the brief, not the server's.
          timeZone: ctx.timeZone,
        });
        const sections = renderedSections(doc).join(', ');
        const notes = dropped.length > 0 ? `\nThe contract trimmed some of it: ${dropped.map(d => d.message).join('; ')}.` : '';
        // A republish minutes after the first replaced it — say so, so the
        // agent does not report two briefings when there is one.
        const verb = replaced ? 'updated (it replaced the version you published a moment ago)' : 'published';
        return `Briefing #${id} ${verb}${scope === null ? ' (workspace)' : ` for team ${scope}`} — /dashboard/briefings/${id}.\nSections rendered: ${sections}.${notes}`;
      } catch (err) {
        if (err instanceof BriefingContractError) {
          return `NOT published — the briefing contract refused it:\n${err.issues.map(i => `- ${i.section}: ${i.message}`).join('\n')}\nFix those and call publish_briefing again.`;
        }
        throw err;
      }
    },
    {
      name: 'publish_briefing',
      description: [
        'Publish the briefing to the Briefings page, scoped to YOUR team automatically (rollup:true for the cross-team workspace brief).',
        'You supply observations and judgement ONLY. The product decides the rest and will overrule you:',
        'section presence and order, which metrics survive, every delta (computed against the previous brief by key),',
        'the on-track verdict (never green without a verified or observed measure with a target),',
        'and the critical path, where every item must carry BOTH the date it falls on and the evidence it rests on;',
        'anything not dated today, or citing nothing, is dropped. A time of day is not a date, so never copy an item forward',
        'from a previous briefing, and never put a meeting on the clock unless you can name the calendar event it comes from,',
        'which decisions are shown and how many (at most 3 unless you mark a genuine incident), and the history.',
        'Do not write a section that says nothing happened — omit it and it will not render.',
        'Never put agent names, job names, tool names, run ids, token counts, connector field names or table names in any narrative field:',
        'they belong in agentActivity, and the publisher will pull them out and footnote them if you do.',
      ].join(' '),
      schema: PublishBriefingInputSchema,
    },
  );
}

export function getBriefingTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const requested = (args as { team?: string }).team?.trim();
      let scope: string | null;
      let label: string;
      if (requested === 'rollup') {
        scope = null;
        label = 'workspace rollup';
      } else if (requested) {
        scope = requested;
        label = `team ${requested}`;
      } else {
        const { teamSlug } = await callerTeam(ctx);
        scope = teamSlug;
        label = teamSlug ? `your team (${teamSlug})` : 'workspace rollup';
      }
      let brief = await latestBriefing(ctx.orgId, scope);
      if (!brief && scope !== null) {
        brief = await latestBriefing(ctx.orgId, null);
        label = 'workspace rollup (no team brief yet)';
      }
      if (!brief) {
        return `No ${label} briefing published yet. Call refresh_briefing to generate one.`;
      }
      // A stale brief in this scope must not hide a fresh one next door.
      const newest = await newestBriefing(ctx.orgId);
      const newer = newest && newest.id !== brief.id && newest.createdAt > brief.createdAt ? newest : null;
      const note = newer
        ? `\n\nNOTE: a NEWER briefing exists — #${newer.id} "${newer.title}" (${newer.teamSlug ? `team ${newer.teamSlug}` : 'workspace rollup'}, published ${formatDateTime(newer.createdAt, ctx.timeZone ?? 'UTC')}). Read it with get_briefing team:"${newer.teamSlug ?? 'rollup'}" before treating the one above as the current picture.`
        : '';
      return renderBriefingForAgent(ctx, brief, label) + note;
    },
    {
      name: 'get_briefing',
      description: 'Read the latest briefing for YOUR team (default), another team (team:"revops"), or the workspace rollup (team:"rollup"). Tells you if it is stale. Use it to ground "what should I do" answers in the team\'s emergent priorities.',
      schema: z.object({ team: z.string().optional().describe('Team slug, "rollup", or omit for your own team.') }),
    },
  );
}

export function refreshBriefingTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const { teamSlug, leadSlug } = await callerTeam(ctx);
      const scope = teamSlug ?? null;
      const brief = await latestBriefing(ctx.orgId, scope);
      if (brief && isFromToday(brief.createdAt, new Date(), ctx.timeZone)) {
        return `Today's ${teamSlug ? `${teamSlug} ` : 'rollup '}briefing ("${brief.title}") is already current — no refresh needed.`;
      }
      const runner = leadSlug ?? ctx.agentSlug;
      if (!runner) {
        return 'No team lead resolved for this agent — cannot regenerate.';
      }
      const instruction = teamSlug ? TEAM_BRIEF_INSTRUCTION : WORKSPACE_BRIEF_INSTRUCTION;
      const { runAgentDeep } = await import('@/services/AgentService');
      void runAgentDeep({ orgId: ctx.orgId, agentSlug: runner, message: instruction, userId: ctx.userId ?? 'refresh-briefing' })
        .catch((err: unknown) => console.error(`refresh_briefing run failed: ${String(err)}`));
      return `Refreshing the ${teamSlug ?? 'rollup'} briefing in the background (${runner} is assembling it) — it'll appear under Briefings in a minute or two. Tell the user it's refreshing; don't wait on it.`;
    },
    {
      name: 'refresh_briefing',
      description: 'Regenerate YOUR team\'s briefing IF stale (not from today) by running the team lead in the background. Returns immediately — never blocks. No-op with a note when today\'s brief exists.',
      schema: z.object({}),
    },
  );
}
