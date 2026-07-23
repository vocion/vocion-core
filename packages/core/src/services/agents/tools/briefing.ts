/**
 * Briefing tools — team-scoped.
 *
 * Every brief belongs to a TEAM (published by its lead); the workspace lead's
 * brief is the cross-team ROLLUP (team_slug NULL). Tools:
 * - publish_briefing: stamps the caller's agent + team.
 * - get_briefing: the caller's TEAM brief by default (arg `team` to read
 *   another team's, `rollup` for the workspace rollup) + freshness signal.
 * - refresh_briefing: regenerates the caller's team brief IN THE BACKGROUND by
 *   running the team's lead agent with a publish instruction (generic — works
 *   for every team, no per-team mission required). Rollup refresh runs the
 *   workspace lead over the latest team briefs. Never blocks the turn.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { agentSchema, briefingSchema, teamSchema } from '@/models/Schema';

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

function isFromToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function publishBriefingTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { title, content, rollup } = args as { title: string; content: string; rollup?: boolean };
      const { teamSlug } = await callerTeam(ctx);
      const [row] = await db
        .insert(briefingSchema)
        .values({
          orgId: ctx.orgId,
          title: title.slice(0, 200),
          content,
          publishedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : (ctx.userId ?? null),
          agentSlug: ctx.agentSlug ?? null,
          teamSlug: rollup ? null : teamSlug,
        })
        .returning({ id: briefingSchema.id });
      return `Briefing #${row!.id} published${rollup ? ' (workspace rollup)' : teamSlug ? ` for team ${teamSlug}` : ''} — live under Workspace → Briefings.`;
    },
    {
      name: 'publish_briefing',
      description: 'Publish a briefing (markdown) to the Briefings page, scoped to YOUR team automatically. Set rollup:true only when publishing the cross-team workspace rollup (workspace lead). The FULL briefing goes in content.',
      schema: z.object({
        title: z.string().min(1).describe('e.g. "Founder GTM Brief — Thu, Jul 23"'),
        content: z.string().min(1).describe('The complete briefing, markdown.'),
        rollup: z.boolean().optional().describe('true = the workspace-wide rollup brief (workspace lead only).'),
      }),
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
      const when = brief.createdAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const status = isFromToday(brief.createdAt) ? `current (published today, ${when})` : `STALE — last published ${when}, not today; consider refresh_briefing`;
      return `Latest ${label} briefing — "${brief.title}" — ${status}\n\n${brief.content}\n\n---\nREMINDER (harness): the brief above is CONTEXT, not your answer. If you surface actionable/owed touches to the user, your workspace rules still apply — emit the required recommend_action card for EACH touch you name BEFORE writing your answer; never substitute a "want me to draft it?" question for a card.`;
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
      if (brief && isFromToday(brief.createdAt)) {
        return `Today's ${teamSlug ? `${teamSlug} ` : 'rollup '}briefing ("${brief.title}") is already current — no refresh needed.`;
      }
      const runner = leadSlug ?? ctx.agentSlug;
      if (!runner) {
        return 'No team lead resolved for this agent — cannot regenerate.';
      }
      const instruction = teamSlug
        ? `Assemble and publish your team's daily brief NOW. Ground it in the tracker, your missions, and fresh sources (freshen gmail first if relevant). Structure it as a scannable document (sections, priority-ranked actions). Publish via publish_briefing when done — do not ask for permission.`
        : `Assemble and publish the WORKSPACE ROLLUP brief NOW: read each team's latest brief (get_briefing with team:"<slug>"), synthesize the cross-team picture (top priorities, risks, asks), and publish via publish_briefing with rollup:true. Do not ask for permission.`;
      const { runAgentDeep } = await import('@/services/AgentService');
      void runAgentDeep({ orgId: ctx.orgId, agentSlug: runner, message: instruction, userId: ctx.userId ?? 'refresh-briefing' })
        .catch((err: unknown) => console.error(`refresh_briefing run failed: ${String(err)}`));
      return `Regenerating the ${teamSlug ?? 'rollup'} briefing in the background (${runner} is assembling it) — it'll appear under Briefings in a minute or two. Tell the user it's regenerating; don't wait on it.`;
    },
    {
      name: 'refresh_briefing',
      description: 'Regenerate YOUR team\'s briefing IF stale (not from today) by running the team lead in the background. Returns immediately — never blocks. No-op with a note when today\'s brief exists.',
      schema: z.object({}),
    },
  );
}
