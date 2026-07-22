/**
 * Briefing tools — let an agent GROUND answers in the latest daily brief and
 * REGENERATE it inline when it's stale.
 *
 * - get_briefing: read the latest published briefing + a freshness signal, so
 *   "what should I do" can emerge from the brief (not just the tracker).
 * - refresh_briefing: if the latest brief isn't from today, kick off the
 *   daily-revenue-briefing mission (the same pass its automation fires) in the
 *   background and return immediately — never blocks the chat turn on a full
 *   mission run.
 *
 * There is no expiry column on `briefing`; "stale" = the latest brief was not
 * published today (server-local midnight boundary).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { briefingSchema } from '@/models/Schema';

// Which mission regenerates the brief is workspace-specific — configurable so
// core carries no Metacto-specific slug. Defaults to the common name; other
// workspaces override via env, and refresh_briefing degrades gracefully when
// no such mission exists.
const BRIEFING_MISSION = process.env.VOCION_BRIEFING_MISSION ?? 'daily-revenue-briefing';

async function latestBriefing(orgId: string) {
  const [row] = await db
    .select({ id: briefingSchema.id, title: briefingSchema.title, content: briefingSchema.content, createdAt: briefingSchema.createdAt })
    .from(briefingSchema)
    .where(eq(briefingSchema.orgId, orgId))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(1);
  return row ?? null;
}

function isFromToday(d: Date): boolean {
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function getBriefingTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const brief = await latestBriefing(ctx.orgId);
      if (!brief) {
        return 'No briefing has been published yet. Call refresh_briefing to generate today\'s.';
      }
      const when = brief.createdAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const fresh = isFromToday(brief.createdAt);
      const status = fresh ? `current (published today, ${when})` : `STALE — last published ${when}, not today; consider refresh_briefing`;
      return `Latest briefing — "${brief.title}" — ${status}\n\n${brief.content}`;
    },
    {
      name: 'get_briefing',
      description: 'Read the latest published daily briefing (title, freshness, full markdown). Use it to ground "what should I do"-style answers in the brief\'s emergent priorities — not only the tracker. Tells you if the brief is stale (not from today).',
      schema: z.object({}),
    },
  );
}

export function refreshBriefingTool(ctx: RuntimeContext) {
  return tool(
    async () => {
      const brief = await latestBriefing(ctx.orgId);
      if (brief && isFromToday(brief.createdAt)) {
        return `Today's briefing ("${brief.title}") is already current — no refresh needed.`;
      }
      const { getMission, startMission, scheduledCheckBrief } = await import('@/services/MissionService');
      const template = await getMission(ctx.orgId, BRIEFING_MISSION);
      if (!template) {
        return `No "${BRIEFING_MISSION}" mission is configured for this workspace, so I can't regenerate the brief.`;
      }
      // Fire-and-forget: startMission runs the full mission in-process (blocks
      // until done). We must NOT await it inside a chat turn — kick it off and
      // return; the fresh brief lands under Briefings when the run completes.
      void startMission({
        orgId: ctx.orgId,
        missionSlug: BRIEFING_MISSION,
        brief: scheduledCheckBrief(template),
        title: `Check: ${template.name}`,
        mode: 'check',
        invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : (ctx.userId ?? 'agent'),
      }).catch((err: unknown) => console.error(`refresh_briefing mission failed: ${String(err)}`));
      return 'Generating a fresh briefing now (the revenue lead is assembling it) — it\'ll appear under Workspace → Briefings in a minute or two. Tell the user it\'s regenerating; don\'t wait on it.';
    },
    {
      name: 'refresh_briefing',
      description: 'Regenerate the daily briefing IF it is stale (not from today). Kicks off the briefing mission in the background and returns immediately — never blocks. No-op with a note if today\'s brief already exists.',
      schema: z.object({}),
    },
  );
}
