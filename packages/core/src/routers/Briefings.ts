import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { os } from '@orpc/server';
import { projectSchema, teamSchema } from '@/models/Schema';
import { guardAuth } from './AuthGuards';

/**
 * briefings.regenerate — rebuild a team's brief (or the workspace rollup) on
 * demand: fire-and-forget run of the owning lead agent with a publish
 * instruction. Returns immediately; the fresh brief lands on the page when
 * the run completes.
 */
export const regenerateRoute = os
  .input(z.object({ teamSlug: z.string().nullable() }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    let runner: string | null = null;
    let instruction: string;
    if (input.teamSlug) {
      const [team] = await db
        .select({ lead: teamSchema.leadAgentSlug })
        .from(teamSchema)
        .where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, input.teamSlug)))
        .limit(1);
      runner = team?.lead ?? null;
      instruction = 'Assemble and publish your team\'s daily brief NOW. Ground it in the tracker, your missions, and fresh sources (freshen gmail first if relevant). Structure it as a scannable document (sections, priority-ranked actions). Publish via publish_briefing when done — do not ask for permission.';
    } else {
      const [proj] = await db
        .select({ lead: projectSchema.leadAgentSlug })
        .from(projectSchema)
        .where(eq(projectSchema.id, orgId))
        .limit(1);
      runner = proj?.lead ?? null;
      instruction = 'Assemble and publish the WORKSPACE ROLLUP brief NOW: read each team\'s latest brief (get_briefing with team:"<slug>"), synthesize the cross-team picture (top priorities, risks, asks), and publish via publish_briefing with rollup:true. Do not ask for permission.';
    }
    if (!runner) {
      return { ok: false as const, error: 'no lead agent for this scope' };
    }
    const { runAgentDeep } = await import('@/services/AgentService');
    void runAgentDeep({ orgId, agentSlug: runner, message: instruction, userId: userId ?? 'regenerate-brief' })
      .catch((err: unknown) => console.error(`briefings.regenerate failed: ${String(err)}`));
    return { ok: true as const, runner };
  });
