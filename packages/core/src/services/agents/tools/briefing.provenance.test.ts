/**
 * A published brief records the mission run whose turn published it, so a
 * stale brief can name its own automation's failure and no one else's
 * (`libs/chat/appFront.ts` `failedRunAfter`). PGlite mock.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { agentSchema, briefingSchema, teamSchema } = await import('@/models/Schema');
const { publishBriefingTool } = await import('./briefing');
const { eq } = await import('drizzle-orm');

const ORG = 'proj_brief_provenance';

async function cleanDb() {
  for (const table of [briefingSchema, agentSchema, teamSchema]) {
    await db.delete(table);
  }
}

beforeEach(async () => {
  await cleanDb();
  await db.insert(teamSchema).values({ orgId: ORG, slug: 'pipeline', name: 'Pipeline', leadAgentSlug: 'pipeline-lead' });
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'pipeline-lead', name: 'Pipeline Lead', systemPrompt: 'You lead the pipeline.', teamSlug: 'pipeline' });
});

afterAll(cleanDb);

describe('publish_briefing provenance', () => {
  it('stamps the mission run that published the brief', async () => {
    const out = await publishBriefingTool({ orgId: ORG, agentSlug: 'pipeline-lead', missionRunId: 41, timeZone: 'UTC' } as never).invoke({ title: 'Pipeline Briefing', summary: 'Northwind asked for a revised scope.' });

    expect(String(out)).toMatch(/published for team pipeline/);

    const [row] = await db.select({ missionRunId: briefingSchema.missionRunId, teamSlug: briefingSchema.teamSlug }).from(briefingSchema).where(eq(briefingSchema.orgId, ORG));

    expect(row).toEqual({ missionRunId: 41, teamSlug: 'pipeline' });
  });

  it('leaves it empty for a brief published outside a mission run', async () => {
    await publishBriefingTool({ orgId: ORG, agentSlug: 'pipeline-lead', timeZone: 'UTC' } as never).invoke({ title: 'Pipeline Briefing', summary: 'Northwind asked for a revised scope.' });
    const [row] = await db.select({ missionRunId: briefingSchema.missionRunId }).from(briefingSchema).where(eq(briefingSchema.orgId, ORG));

    expect(row?.missionRunId).toBeNull();
  });
});
