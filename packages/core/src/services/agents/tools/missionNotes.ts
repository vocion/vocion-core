/**
 * update_mission_notes — the team's working memory across mission checks.
 *
 * A scheduled check ends by REWRITING the mission's notes: open threads
 * (with how many consecutive checks they've been open), commitments with
 * due dates, escalation state. The next check reads them in its brief —
 * which is how "Catalyst reply overdue — 3rd consecutive check" emerges
 * instead of every check rediscovering the world.
 *
 * Mission-scoped: only available in runs bound to a mission (ctx.missionSlug).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { missionSchema } from '@/models/Schema';

const MAX_NOTES_CHARS = 8000;

export function updateMissionNotesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { notes } = args as { notes: string };
      if (!ctx.missionSlug) {
        return 'Not running inside a mission check — update_mission_notes is unavailable here.';
      }
      const trimmed = notes.slice(0, MAX_NOTES_CHARS);
      const res = await db
        .update(missionSchema)
        .set({ workingNotes: trimmed })
        .where(and(eq(missionSchema.orgId, ctx.orgId), eq(missionSchema.slug, ctx.missionSlug)))
        .returning({ slug: missionSchema.slug });
      if (res.length === 0) {
        return `Mission "${ctx.missionSlug}" not found — notes not saved.`;
      }
      return `Working notes saved for "${ctx.missionSlug}" (${trimmed.length} chars). They will be in your next check's brief.`;
    },
    {
      name: 'update_mission_notes',
      description: 'REWRITE this mission\'s working notes (full replacement, not append) — your memory for the next scheduled check. Carry forward open threads with how many consecutive checks they\'ve been open, commitments with due dates, and drop resolved items. Keep under ~40 lines.',
      schema: z.object({
        notes: z.string().min(1).describe('The complete new working notes (replaces the previous notes).'),
      }),
    },
  );
}
