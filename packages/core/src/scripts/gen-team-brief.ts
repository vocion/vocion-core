/** Generate a team brief (or rollup) for real via the lead agent, then verify
 *  the briefing row landed with the right team stamp.
 *    --team founder-gtm | --rollup */
import process from 'node:process';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { briefingSchema, teamSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';

const ORG = 'proj-revenue-f8429a692aab3703f82a4f15169b8662';

async function main(): Promise<void> {
  const rollup = process.argv.includes('--rollup');
  const teamArg = process.argv[process.argv.indexOf('--team') + 1];
  let runner: string;
  let instruction: string;
  if (rollup) {
    runner = 'revenue-director';
    instruction = 'Assemble and publish the WORKSPACE ROLLUP brief NOW: read each team\'s latest brief (get_briefing with team:"founder-gtm", team:"revops", team:"deal-desk", team:"marketing"), synthesize the cross-team picture (top priorities, risks, asks), and publish via publish_briefing with rollup:true. Do not ask for permission.';
  } else {
    const [team] = await db.select({ lead: teamSchema.leadAgentSlug }).from(teamSchema).where(and(eq(teamSchema.orgId, ORG), eq(teamSchema.slug, teamArg!))).limit(1);
    runner = team!.lead!;
    instruction = 'Assemble and publish your team\'s daily brief NOW. Ground it in the tracker, your missions, and fresh sources. Structure it as a scannable document (sections, priority-ranked actions). Publish via publish_briefing when done — do not ask for permission.';
  }
  console.warn(`running ${runner}…`);
  await runAgentDeep({ orgId: ORG, agentSlug: runner, message: instruction, userId: 'gen-team-brief' });
  const [row] = await db
    .select({ id: briefingSchema.id, title: briefingSchema.title, teamSlug: briefingSchema.teamSlug, agentSlug: briefingSchema.agentSlug, createdAt: briefingSchema.createdAt })
    .from(briefingSchema)
    .where(and(eq(briefingSchema.orgId, ORG), rollup ? isNull(briefingSchema.teamSlug) : eq(briefingSchema.teamSlug, teamArg!)))
    .orderBy(desc(briefingSchema.createdAt))
    .limit(1);
  const fresh = row && (Date.now() - row.createdAt.getTime()) < 10 * 60_000;
  console.warn(`\n===== BRIEF GEN PROOF =====`);
  console.warn(`published: ${fresh ? 'YES ✓' : 'NO ✗'} ${row ? `#${row.id} "${row.title}" team=${row.teamSlug ?? 'ROLLUP'} by=${row.agentSlug}` : '(none)'}`);
  process.exit(fresh ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
