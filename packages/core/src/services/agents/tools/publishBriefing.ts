/**
 * publish_briefing — the team's deliverable lands where humans start their
 * day. A briefing check ends by publishing its two-minute read here;
 * Workspace → Briefings renders them newest-first.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { briefingSchema } from '@/models/Schema';

export function publishBriefingTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { title, content } = args as { title: string; content: string };
      const [row] = await db
        .insert(briefingSchema)
        .values({
          orgId: ctx.orgId,
          title: title.slice(0, 200),
          content,
          publishedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : (ctx.userId ?? null),
        })
        .returning({ id: briefingSchema.id });
      return `Briefing #${row!.id} published — it's live under Workspace → Briefings.`;
    },
    {
      name: 'publish_briefing',
      description: 'Publish a briefing (markdown) to the Briefings page — where the team starts its day. Use for the daily revenue briefing and any other recurring read; the FULL briefing goes in content, not a summary of it.',
      schema: z.object({
        title: z.string().min(1).describe('e.g. "Revenue Briefing — Friday, July 3"'),
        content: z.string().min(1).describe('The complete briefing, markdown.'),
      }),
    },
  );
}
